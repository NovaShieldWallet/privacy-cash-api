import { config } from '../config/env.js';
import { logger } from '../middleware/logging.js';

interface TreeState {
  root: string;
  nextIndex: number;
}

interface MerkleProof {
  pathElements: string[];
  pathIndices: number[];
}

interface RelayerConfig {
  withdraw_fee_rate: number;
  withdraw_rent_fee: number;
  deposit_fee_rate: number;
  usdc_withdraw_rent_fee: number;
  rent_fees: Record<string, number>;
}

let cachedConfig: RelayerConfig | null = null;

/**
 * Query the current merkle tree state from the relayer
 * Uses /merkle/root endpoint (matches SDK)
 */
export async function queryTreeState(tokenName?: string): Promise<TreeState> {
  let url = `${config.relayerUrl}/merkle/root`;
  if (tokenName) {
    url += `?token=${tokenName}`;
  }

  logger.debug('Querying tree state', { url, network: config.network });

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(`Failed to query tree state: ${response.status} - ${errorText.substring(0, 100)}`);
      logger.error('Failed to query tree state', { 
        url, 
        status: response.status, 
        errorText: errorText.substring(0, 200),
        network: config.network 
      });
      throw error;
    }

    const data = await response.json() as TreeState;
    logger.debug('Tree state received', { root: data.root, nextIndex: data.nextIndex });

    return data;
  } catch (error: any) {
    logger.error('Tree state query error', { url, error: error.message, stack: error.stack });
    throw error;
  }
}

/**
 * Fetch merkle proof for a commitment
 */
export async function fetchMerkleProof(commitment: string, tokenName?: string): Promise<MerkleProof> {
  // SDK uses /merkle/proof/{commitment}
  let url = `${config.relayerUrl}/merkle/proof/${commitment}`;
  if (tokenName) {
    url += `?token=${tokenName}`;
  }

  logger.debug('Fetching merkle proof', { commitment, url });

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Failed to fetch merkle proof', { 
        commitment, 
        url, 
        status: response.status, 
        errorText: errorText.substring(0, 200) 
      });
      throw new Error(`Failed to fetch merkle proof: ${response.status} - ${errorText.substring(0, 100)}`);
    }

    return response.json() as Promise<MerkleProof>;
  } catch (error: any) {
    logger.error('Merkle proof fetch error', { commitment, url, error: error.message, stack: error.stack });
    throw error;
  }
}

/**
 * Get relayer configuration (fee rates, etc.)
 */
export async function getRelayerConfig(): Promise<RelayerConfig> {
  if (cachedConfig) return cachedConfig;

  const url = `${config.relayerUrl}/config`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to get relayer config: ${response.status}`);
  }

  cachedConfig = await response.json() as RelayerConfig;
  return cachedConfig;
}

/**
 * Relay a signed deposit transaction
 */
export async function relayDeposit(params: {
  signedTransaction: string;
  senderAddress: string;
  referrer?: string;
  mintAddress?: string;
}): Promise<{ signature: string; success: boolean }> {
  const isSpl = !!params.mintAddress;
  const url = isSpl
    ? `${config.relayerUrl}/deposit/spl`
    : `${config.relayerUrl}/deposit`;

  logger.debug('Relaying deposit transaction');

  const body: Record<string, any> = {
    signedTransaction: params.signedTransaction,
    senderAddress: params.senderAddress,
  };

  if (params.referrer) {
    body.referralWalletAddress = params.referrer;
  }
  if (params.mintAddress) {
    body.mintAddress = params.mintAddress;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('Deposit relay failed', { 
      url, 
      status: response.status, 
      errorText: errorText.substring(0, 500),
      senderAddress: params.senderAddress,
      mintAddress: params.mintAddress
    });
    throw new Error(`Deposit relay failed: ${errorText}`);
  }

  const result = await response.json() as { signature: string; success: boolean };
  logger.info('Deposit relayed successfully', { signature: result.signature });
  return result;
}

/**
 * Submit a withdrawal request
 */
export async function submitWithdraw(params: {
  serializedProof: string;
  treeAccount: string;
  nullifier0PDA: string;
  nullifier1PDA: string;
  nullifier2PDA: string;
  nullifier3PDA: string;
  treeTokenAccount: string;
  globalConfigAccount: string;
  recipient: string;
  feeRecipientAccount: string;
  extAmount: number;
  encryptedOutput1: string;
  encryptedOutput2: string;
  fee: number;
  lookupTableAddress: string;
  senderAddress: string;
  referralWalletAddress?: string;
  // SPL specific
  treeAta?: string;
  recipientAta?: string;
  mintAddress?: string;
  feeRecipientTokenAccount?: string;
}): Promise<{ signature: string; success: boolean }> {
  const isSpl = !!params.mintAddress;
  const url = isSpl
    ? `${config.relayerUrl}/withdraw/spl`
    : `${config.relayerUrl}/withdraw`;

  logger.debug('Submitting withdrawal request');

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorData = await response.json() as { error?: string };
    logger.error('Withdrawal submission failed', { 
      url, 
      status: response.status, 
      error: errorData.error,
      recipient: params.recipient,
      mintAddress: params.mintAddress
    });
    throw new Error(errorData.error || `Withdraw failed: ${response.status}`);
  }

  const result = await response.json() as { signature: string; success: boolean };
  logger.info('Withdrawal submitted successfully', { signature: result.signature });
  return result;
}

/**
 * Fetch encrypted UTXOs for a range
 */
export async function fetchUtxoRange(start: number, end: number, tokenName?: string): Promise<{
  encrypted_outputs: string[];
  hasMore: boolean;
  total: number;
}> {
  const baseUrl = tokenName
    ? `${config.relayerUrl}/utxos/range?start=${start}&end=${end}&token=${tokenName}`
    : `${config.relayerUrl}/utxos/range?start=${start}&end=${end}`;

  const response = await fetch(baseUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch UTXOs: ${response.status}`);
  }

  return response.json() as Promise<{ encrypted_outputs: string[]; hasMore: boolean; total: number }>;
}

/**
 * Get UTXO indices for encrypted outputs
 */
export async function fetchUtxoIndices(encryptedOutputs: string[]): Promise<{ indices: number[] }> {
  const url = `${config.relayerUrl}/utxos/indices`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ encrypted_outputs: encryptedOutputs }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch UTXO indices: ${response.status}`);
  }

  return response.json() as Promise<{ indices: number[] }>;
}

/**
 * Check if a UTXO exists
 */
export async function checkUtxoExists(encryptedOutput: string, tokenName?: string): Promise<boolean> {
  const url = tokenName
    ? `${config.relayerUrl}/utxos/check/${encryptedOutput}?token=${tokenName}`
    : `${config.relayerUrl}/utxos/check/${encryptedOutput}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to check UTXO: ${response.status}`);
  }

  const data = await response.json() as { exists: boolean };
  return data.exists;
}
