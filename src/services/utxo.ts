import { Connection, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { WasmFactory } from '@lightprotocol/hasher.rs';
import { EncryptionService } from './encryption.js';
import { Utxo } from './models/utxo.js';
import { Keypair as UtxoKeypair } from './models/keypair.js';
import { fetchUtxoRange, fetchUtxoIndices } from './relayer.js';
import { config } from '../config/env.js';
import { logger } from '../middleware/logging.js';
import { FETCH_UTXOS_GROUP_SIZE } from '../utils/constants.js';

// @ts-ignore
import * as ffjavascript from 'ffjavascript';
const utils = ffjavascript.utils as any;
const { unstringifyBigInts, leInt2Buff } = utils;

/**
 * Fetch and decrypt all UTXOs for a user
 * Server needs the signature to derive encryption keys
 */
export async function getUtxos(params: {
  publicKey: PublicKey;
  connection: Connection;
  encryptionService: EncryptionService;
  tokenName?: string;
}): Promise<Utxo[]> {
  const { publicKey, connection, encryptionService, tokenName } = params;
  const lightWasm = await WasmFactory.getInstance();

  const validUtxos: Utxo[] = [];
  let offset = 0;

  while (true) {
    const end = offset + FETCH_UTXOS_GROUP_SIZE;
    logger.debug('Fetching UTXO range', { offset, end, tokenName });

    const data = await fetchUtxoRange(offset, end, tokenName);
    const encryptedOutputs = data.encrypted_outputs;

    if (encryptedOutputs.length === 0) {
      break;
    }

    // Decrypt UTXOs
    const decrypted = await decryptOutputs(encryptedOutputs, encryptionService, lightWasm);
    
    // Filter non-zero UTXOs
    const nonZeroUtxos = decrypted.filter(u => u.utxo && u.utxo.amount.gt(new BN(0)));

    if (nonZeroUtxos.length > 0) {
      // Check which are spent
      const utxosToCheck = nonZeroUtxos.map(u => u.utxo!);
      const spentFlags = await areUtxosSpent(connection, utxosToCheck);

      for (let i = 0; i < nonZeroUtxos.length; i++) {
        if (!spentFlags[i]) {
          validUtxos.push(nonZeroUtxos[i].utxo!);
        }
      }
    }

    if (!data.hasMore) {
      break;
    }

    offset += encryptedOutputs.length;
  }

  return validUtxos;
}

/**
 * Decrypt encrypted outputs
 */
async function decryptOutputs(
  encryptedOutputs: string[],
  encryptionService: EncryptionService,
  lightWasm: any
): Promise<{ utxo?: Utxo; encryptedOutput: string }[]> {
  const results: { utxo?: Utxo; encryptedOutput: string }[] = [];

  for (const encryptedOutput of encryptedOutputs) {
    if (!encryptedOutput) {
      continue;
    }

    try {
      const utxo = await encryptionService.decryptUtxo(encryptedOutput, lightWasm);
      results.push({ utxo, encryptedOutput });
    } catch {
      // Not our UTXO - skip
    }
  }

  // Update indices for successfully decrypted UTXOs
  if (results.length > 0) {
    const encryptedOutputsList = results.map(r => r.encryptedOutput);
    const { indices } = await fetchUtxoIndices(encryptedOutputsList);

    for (let i = 0; i < results.length; i++) {
      if (results[i].utxo && typeof indices[i] === 'number') {
        results[i].utxo!.index = indices[i];
      }
    }
  }

  return results;
}

/**
 * Check if UTXOs are spent (batch)
 */
export async function areUtxosSpent(connection: Connection, utxos: Utxo[]): Promise<boolean[]> {
  const programId = config.programId;
  const allPDAs: { utxoIndex: number; pda: PublicKey }[] = [];

  for (let i = 0; i < utxos.length; i++) {
    const utxo = utxos[i];
    const nullifier = await utxo.getNullifier();

    const nullifierBytes = Array.from(
      leInt2Buff(unstringifyBigInts(nullifier), 32)
    ).reverse() as number[];

    const [nullifier0PDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('nullifier0'), Buffer.from(nullifierBytes)],
      programId
    );
    const [nullifier1PDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('nullifier1'), Buffer.from(nullifierBytes)],
      programId
    );

    allPDAs.push({ utxoIndex: i, pda: nullifier0PDA });
    allPDAs.push({ utxoIndex: i, pda: nullifier1PDA });
  }

  const results = await connection.getMultipleAccountsInfo(allPDAs.map(x => x.pda));
  const spentFlags = new Array(utxos.length).fill(false);

  for (let i = 0; i < allPDAs.length; i++) {
    if (results[i] !== null) {
      spentFlags[allPDAs[i].utxoIndex] = true;
    }
  }

  return spentFlags;
}

/**
 * Calculate total balance from UTXOs
 */
export function getBalanceFromUtxos(utxos: Utxo[]): { lamports: number } {
  const totalBalance = utxos.reduce((sum, utxo) => sum.add(utxo.amount), new BN(0));
  return { lamports: totalBalance.toNumber() };
}
