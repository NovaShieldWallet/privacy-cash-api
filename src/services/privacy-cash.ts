import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import BN from 'bn.js';
import { WasmFactory } from '@lightprotocol/hasher.rs';
import { keccak256 } from '@ethersproject/keccak256';
import { config, TokenConfig } from '../config/env.js';
import { EncryptionService } from './encryption.js';
import { Utxo } from './models/utxo.js';
import { Keypair as UtxoKeypair } from './models/keypair.js';
import { createMerkleTree } from './merkle.js';
import { generateProof, parseProofToBytesArray, parseToBytesArray } from './proof.js';
import {
  queryTreeState,
  fetchMerkleProof,
  relayDeposit,
  submitWithdraw,
  getRelayerConfig,
  checkUtxoExists,
} from './relayer.js';
import {
  buildUnsignedDepositTransaction,
  buildUnsignedSplDepositTransaction,
  serializeTransaction,
  findNullifierPDAs,
  findCrossCheckNullifierPDAs,
  serializeProofAndExtData,
} from './transaction.js';
import { getUtxos, getBalanceFromUtxos } from './utxo.js';
import { FIELD_SIZE, FEE_RECIPIENT, getProgramAccounts, getSplTreeAccount } from '../utils/constants.js';
import { logger } from '../middleware/logging.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

/**
 * Main service for Privacy Cash operations
 * IMPORTANT: This service never handles private keys
 * All signing happens on the client (iOS)
 */
export class PrivacyCashService {
  private connection: Connection;

  constructor() {
    this.connection = new Connection(config.rpcUrl, 'confirmed');
  }

  /**
   * Prepare a deposit transaction (SOL)
   * Returns unsigned transaction for client to sign
   */
  async prepareDeposit(params: {
    publicKey: string;
    signature: string; // Client's signature for encryption key derivation
    lamports: number;
    referrer?: string;
  }): Promise<{
    unsignedTransaction: string;
    metadata: {
      amount: number;
      encryptedOutput1: string;
      encryptedOutput2: string;
    };
  }> {
    const { publicKey, signature, lamports, referrer } = params;
    const signer = new PublicKey(publicKey);

    // Derive encryption key from signature
    const encryptionService = new EncryptionService();
    encryptionService.deriveEncryptionKeyFromSignature(Buffer.from(signature, 'base64'));

    const lightWasm = await WasmFactory.getInstance();
    const tree = createMerkleTree(lightWasm);

    // Get tree state
    const { root, nextIndex } = await queryTreeState();

    // Get existing UTXOs
    const existingUtxos = await getUtxos({
      publicKey: signer,
      connection: this.connection,
      encryptionService,
    });

    // Build proof inputs
    const utxoPrivateKey = encryptionService.getUtxoPrivateKeyV2();
    const utxoKeypair = new UtxoKeypair(utxoPrivateKey, lightWasm);

    const feeAmount = 0; // Deposits have no fee
    let extAmount = lamports;
    let outputAmount: string;
    let inputs: Utxo[];
    let inputMerklePathIndices: number[];
    let inputMerklePathElements: string[][];

    if (existingUtxos.length === 0) {
      // Fresh deposit
      outputAmount = new BN(lamports).sub(new BN(feeAmount)).toString();
      const solMintShort = '11111111111111111111111111111112';
      inputs = [
        new Utxo({ lightWasm, keypair: utxoKeypair, mintAddress: solMintShort }),
        new Utxo({ lightWasm, keypair: utxoKeypair, mintAddress: solMintShort }),
      ];
      inputMerklePathIndices = [0, 0];
      inputMerklePathElements = [tree.getZeroPath(), tree.getZeroPath()];
    } else {
      // Consolidate with existing UTXOs
      const firstUtxo = existingUtxos[0];
      const secondUtxo = existingUtxos.length > 1
        ? existingUtxos[1]
        : new Utxo({ lightWasm, keypair: utxoKeypair, amount: '0', mintAddress: '11111111111111111111111111111112' });

      const totalExisting = firstUtxo.amount.add(secondUtxo.amount);
      outputAmount = totalExisting.add(new BN(lamports)).sub(new BN(feeAmount)).toString();

      inputs = [firstUtxo, secondUtxo];

      const firstProof = await fetchMerkleProof(await firstUtxo.getCommitment());
      inputMerklePathIndices = [firstUtxo.index, secondUtxo.amount.gt(new BN(0)) ? secondUtxo.index : 0];

      if (secondUtxo.amount.gt(new BN(0))) {
        const secondProof = await fetchMerkleProof(await secondUtxo.getCommitment());
        inputMerklePathElements = [firstProof.pathElements, secondProof.pathElements];
      } else {
        inputMerklePathElements = [firstProof.pathElements, tree.getZeroPath()];
      }
    }

    // Create outputs - use short mint format for SOL
    const solMintShort = '11111111111111111111111111111112';
    const outputs = [
      new Utxo({
        lightWasm,
        amount: outputAmount,
        keypair: utxoKeypair,
        index: nextIndex,
        mintAddress: solMintShort,
      }),
      new Utxo({
        lightWasm,
        amount: '0',
        keypair: utxoKeypair,
        index: nextIndex + 1,
        mintAddress: solMintShort,
      }),
    ];

    // Generate nullifiers and commitments
    const inputNullifiers = await Promise.all(inputs.map(x => x.getNullifier()));
    const outputCommitments = await Promise.all(outputs.map(x => x.getCommitment()));

    // Encrypt outputs
    const encryptedOutput1 = encryptionService.encryptUtxo(outputs[0]);
    const encryptedOutput2 = encryptionService.encryptUtxo(outputs[1]);

    // Calculate public amount for circuit
    const publicAmountForCircuit = new BN(extAmount)
      .sub(new BN(feeAmount))
      .add(FIELD_SIZE)
      .mod(FIELD_SIZE);

    // Build ext data
    const extData = {
      recipient: new PublicKey('AWexibGxNFKTa1b5R5MN4PJr9HWnWRwf8EW9g8cLx3dM'),
      extAmount: new BN(extAmount),
      encryptedOutput1,
      encryptedOutput2,
      fee: new BN(feeAmount),
      feeRecipient: FEE_RECIPIENT,
      mintAddress: inputs[0].mintAddress, // Already in short format
    };

    // Calculate ext data hash
    const extDataHash = this.getExtDataHash(extData);

    // Build proof input (SOL format - matches SDK deposit.ts)
    // Order: root, inputNullifier, outputCommitment, publicAmount, extDataHash, inAmount, inPrivateKey, inBlinding, inPathIndices, inPathElements, outAmount, outBlinding, outPubkey, mintAddress
    const proofInput = {
      root,
      inputNullifier: inputNullifiers,
      outputCommitment: outputCommitments,
      publicAmount: publicAmountForCircuit.toString(),
      extDataHash,
      inAmount: inputs.map(x => x.amount.toString(10)),
      inPrivateKey: inputs.map(x => x.keypair.privkey.toString()), // Convert BN to string for snarkjs
      inBlinding: inputs.map(x => x.blinding.toString(10)),
      inPathIndices: inputMerklePathIndices,
      inPathElements: inputMerklePathElements,
      outAmount: outputs.map(x => x.amount.toString(10)),
      outBlinding: outputs.map(x => x.blinding.toString(10)),
      outPubkey: outputs.map(x => x.keypair.pubkey.toString()),
      mintAddress: inputs[0].mintAddress, // SOL uses string directly: '11111111111111111111111111111112'
    };

    // Generate ZK proof
    logger.info('Generating ZK proof for deposit');
    const { proof, publicSignals } = await generateProof(proofInput);

    // Parse proof for transaction
    const proofInBytes = parseProofToBytesArray(proof);
    const inputsInBytes = parseToBytesArray(publicSignals);

    const proofToSubmit = {
      proofA: proofInBytes.proofA,
      proofB: proofInBytes.proofB.flat(),
      proofC: proofInBytes.proofC,
      root: inputsInBytes[0],
      publicAmount: inputsInBytes[1],
      extDataHash: inputsInBytes[2],
      inputNullifiers: [inputsInBytes[3], inputsInBytes[4]],
      outputCommitments: [inputsInBytes[5], inputsInBytes[6]],
    };

    // Build unsigned transaction
    const { transaction } = await buildUnsignedDepositTransaction({
      connection: this.connection,
      signer,
      proof: proofToSubmit,
      extData,
    });

    return {
      unsignedTransaction: serializeTransaction(transaction),
      metadata: {
        amount: lamports,
        encryptedOutput1: encryptedOutput1.toString('hex'),
        encryptedOutput2: encryptedOutput2.toString('hex'),
      },
    };
  }

  /**
   * Prepare a SPL token deposit
   */
  async prepareSplDeposit(params: {
    publicKey: string;
    signature: string;
    mintAddress: string;
    amount: number; // In token units (e.g., 1.5 USDC)
    referrer?: string;
  }): Promise<{
    unsignedTransaction: string;
    metadata: {
      amount: number;
      baseUnits: number;
      encryptedOutput1: string;
      encryptedOutput2: string;
    };
  }> {
    const { publicKey, signature, mintAddress, amount, referrer } = params;
    const signer = new PublicKey(publicKey);
    const mint = new PublicKey(mintAddress);

    // Get token config
    const tokenConfig = config.getTokenByMint(mint);
    if (!tokenConfig) {
      throw new Error(`Unsupported token: ${mintAddress}`);
    }

    const baseUnits = Math.floor(amount * tokenConfig.unitsPerToken);

    // Derive encryption key
    const encryptionService = new EncryptionService();
    encryptionService.deriveEncryptionKeyFromSignature(Buffer.from(signature, 'base64'));

    const lightWasm = await WasmFactory.getInstance();
    const tree = createMerkleTree(lightWasm);

    // Get tree state for this token
    const { root, nextIndex } = await queryTreeState(tokenConfig.name.toLowerCase());

    // Get existing UTXOs for this token
    const existingUtxos = await getUtxos({
      publicKey: signer,
      connection: this.connection,
      encryptionService,
      tokenName: tokenConfig.name.toLowerCase(),
    });

    // Build proof (similar to SOL but with SPL specifics)
    const utxoPrivateKey = encryptionService.getUtxoPrivateKeyV2();
    const utxoKeypair = new UtxoKeypair(utxoPrivateKey, lightWasm);

    const feeAmount = 0;
    let outputAmount: string;
    let inputs: Utxo[];
    let inputMerklePathIndices: number[];
    let inputMerklePathElements: string[][];

    if (existingUtxos.length === 0) {
      outputAmount = new BN(baseUnits).toString();
      inputs = [
        new Utxo({ lightWasm, keypair: utxoKeypair, mintAddress: mint.toBase58() }),
        new Utxo({ lightWasm, keypair: utxoKeypair, mintAddress: mint.toBase58() }),
      ];
      inputMerklePathIndices = [0, 0];
      inputMerklePathElements = [tree.getZeroPath(), tree.getZeroPath()];
    } else {
      const firstUtxo = existingUtxos[0];
      const secondUtxo = existingUtxos.length > 1
        ? existingUtxos[1]
        : new Utxo({ lightWasm, keypair: utxoKeypair, amount: '0', mintAddress: mint.toBase58() });

      const totalExisting = firstUtxo.amount.add(secondUtxo.amount);
      outputAmount = totalExisting.add(new BN(baseUnits)).toString();

      inputs = [firstUtxo, secondUtxo];

      const firstProof = await fetchMerkleProof(
        await firstUtxo.getCommitment(),
        tokenConfig.name.toLowerCase()
      );
      inputMerklePathIndices = [firstUtxo.index, secondUtxo.amount.gt(new BN(0)) ? secondUtxo.index : 0];

      if (secondUtxo.amount.gt(new BN(0))) {
        const secondProof = await fetchMerkleProof(
          await secondUtxo.getCommitment(),
          tokenConfig.name.toLowerCase()
        );
        inputMerklePathElements = [firstProof.pathElements, secondProof.pathElements];
      } else {
        inputMerklePathElements = [firstProof.pathElements, tree.getZeroPath()];
      }
    }

    const outputs = [
      new Utxo({
        lightWasm,
        amount: outputAmount,
        keypair: utxoKeypair,
        index: nextIndex,
        mintAddress: mint.toBase58(),
      }),
      new Utxo({
        lightWasm,
        amount: '0',
        keypair: utxoKeypair,
        index: nextIndex + 1,
        mintAddress: mint.toBase58(),
      }),
    ];

    const inputNullifiers = await Promise.all(inputs.map(x => x.getNullifier()));
    const outputCommitments = await Promise.all(outputs.map(x => x.getCommitment()));

    const encryptedOutput1 = encryptionService.encryptUtxo(outputs[0]);
    const encryptedOutput2 = encryptionService.encryptUtxo(outputs[1]);

    const publicAmountForCircuit = new BN(baseUnits).add(FIELD_SIZE).mod(FIELD_SIZE);

    const feeRecipientTokenAccount = getAssociatedTokenAddressSync(mint, FEE_RECIPIENT, true);

    const extData = {
      recipient: getAssociatedTokenAddressSync(
        mint,
        new PublicKey('AWexibGxNFKTa1b5R5MN4PJr9HWnWRwf8EW9g8cLx3dM'),
        true
      ),
      extAmount: new BN(baseUnits),
      encryptedOutput1,
      encryptedOutput2,
      fee: new BN(feeAmount),
      feeRecipient: feeRecipientTokenAccount,
      mintAddress: mint.toBase58(),
    };

    const extDataHash = this.getExtDataHash(extData);
    const mintAddressField = this.getMintAddressField(mint);

    const proofInput = {
      root,
      mintAddress: mintAddressField,
      publicAmount: publicAmountForCircuit.toString(),
      extDataHash,
      inAmount: inputs.map(x => x.amount.toString(10)),
      inPrivateKey: inputs.map(x => x.keypair.privkey.toString()),
      inBlinding: inputs.map(x => x.blinding.toString(10)),
      inPathIndices: inputMerklePathIndices,
      inPathElements: inputMerklePathElements,
      inputNullifier: inputNullifiers,
      outAmount: outputs.map(x => x.amount.toString(10)),
      outBlinding: outputs.map(x => x.blinding.toString(10)),
      outPubkey: outputs.map(x => x.keypair.pubkey.toString()),
      outputCommitment: outputCommitments,
    };

    logger.info('Generating ZK proof for SPL deposit');
    const { proof, publicSignals } = await generateProof(proofInput);

    const proofInBytes = parseProofToBytesArray(proof);
    const inputsInBytes = parseToBytesArray(publicSignals);

    const proofToSubmit = {
      proofA: proofInBytes.proofA,
      proofB: proofInBytes.proofB.flat(),
      proofC: proofInBytes.proofC,
      root: inputsInBytes[0],
      publicAmount: inputsInBytes[1],
      extDataHash: inputsInBytes[2],
      inputNullifiers: [inputsInBytes[3], inputsInBytes[4]],
      outputCommitments: [inputsInBytes[5], inputsInBytes[6]],
    };

    const { transaction } = await buildUnsignedSplDepositTransaction({
      connection: this.connection,
      signer,
      mintAddress: mint,
      proof: proofToSubmit,
      extData,
    });

    return {
      unsignedTransaction: serializeTransaction(transaction),
      metadata: {
        amount,
        baseUnits,
        encryptedOutput1: encryptedOutput1.toString('hex'),
        encryptedOutput2: encryptedOutput2.toString('hex'),
      },
    };
  }

  /**
   * Submit a signed deposit transaction
   */
  async submitDeposit(params: {
    signedTransaction: string;
    senderAddress: string;
    encryptedOutput1: string;
    referrer?: string;
    mintAddress?: string;
  }): Promise<{ signature: string; success: boolean }> {
    const { signedTransaction, senderAddress, encryptedOutput1, referrer, mintAddress } = params;

    // Relay to Privacy Cash relayer
    const result = await relayDeposit({
      signedTransaction,
      senderAddress,
      referrer,
      mintAddress,
    });

    // Wait for confirmation
    const tokenName = mintAddress ? config.getTokenByMint(mintAddress)?.name.toLowerCase() : undefined;
    let confirmed = false;
    let retries = 0;

    while (!confirmed && retries < 10) {
      await new Promise(r => setTimeout(r, 2000));
      confirmed = await checkUtxoExists(encryptedOutput1, tokenName);
      retries++;
    }

    if (!confirmed) {
      logger.warn('Transaction may not be confirmed yet');
    }

    return result;
  }

  /**
   * Get shielded balance for a user
   */
  async getBalance(params: {
    publicKey: string;
    signature: string;
    mintAddress?: string;
  }): Promise<{
    balance: number;
    token: string;
    decimals: number;
  }> {
    const { publicKey, signature, mintAddress } = params;
    const pubkey = new PublicKey(publicKey);

    const encryptionService = new EncryptionService();
    encryptionService.deriveEncryptionKeyFromSignature(Buffer.from(signature, 'base64'));

    let tokenConfig: TokenConfig | undefined;
    let tokenName: string | undefined;

    if (mintAddress) {
      tokenConfig = config.getTokenByMint(mintAddress);
      if (!tokenConfig) {
        throw new Error(`Unsupported token: ${mintAddress}`);
      }
      tokenName = tokenConfig.name.toLowerCase();
    } else {
      tokenConfig = config.getToken('sol')!;
    }

    const utxos = await getUtxos({
      publicKey: pubkey,
      connection: this.connection,
      encryptionService,
      tokenName,
    });

    const { lamports } = getBalanceFromUtxos(utxos);
    const balance = lamports / tokenConfig.unitsPerToken;

    return {
      balance,
      token: tokenConfig.name,
      decimals: tokenConfig.decimals,
    };
  }

  /**
   * Prepare a withdrawal (SOL)
   */
  async prepareWithdraw(params: {
    publicKey: string;
    signature: string;
    lamports: number;
    recipientAddress: string;
    referrer?: string;
  }): Promise<{
    withdrawParams: Record<string, any>;
    metadata: {
      amount: number;
      fee: number;
      recipient: string;
    };
  }> {
    const { publicKey, signature, lamports, recipientAddress, referrer } = params;
    const signer = new PublicKey(publicKey);
    const recipient = new PublicKey(recipientAddress);

    const encryptionService = new EncryptionService();
    encryptionService.deriveEncryptionKeyFromSignature(Buffer.from(signature, 'base64'));

    const lightWasm = await WasmFactory.getInstance();
    const tree = createMerkleTree(lightWasm);

    // Get fee config
    const relayerConfig = await getRelayerConfig();
    const feeInLamports = Math.floor(
      lamports * relayerConfig.withdraw_fee_rate + LAMPORTS_PER_SOL * relayerConfig.withdraw_rent_fee
    );
    const amountAfterFee = lamports - feeInLamports;

    if (amountAfterFee <= 0) {
      throw new Error('Amount too low after fees');
    }

    // Get tree state
    const { root, nextIndex } = await queryTreeState();

    // Get existing UTXOs
    const existingUtxos = await getUtxos({
      publicKey: signer,
      connection: this.connection,
      encryptionService,
    });

    if (existingUtxos.length === 0) {
      throw new Error('No balance available');
    }

    // Sort by amount descending
    existingUtxos.sort((a, b) => b.amount.cmp(a.amount));

    const utxoPrivateKey = encryptionService.deriveUtxoPrivateKey();
    const utxoKeypair = new UtxoKeypair(utxoPrivateKey, lightWasm);
    const utxoPrivateKeyV2 = encryptionService.getUtxoPrivateKeyV2();
    const utxoKeypairV2 = new UtxoKeypair(utxoPrivateKeyV2, lightWasm);

    const firstInput = existingUtxos[0];
    const secondInput = existingUtxos.length > 1
      ? existingUtxos[1]
      : new Utxo({ lightWasm, keypair: utxoKeypair, amount: '0' });

    const inputs = [firstInput, secondInput];
    const totalInputAmount = firstInput.amount.add(secondInput.amount);

    if (totalInputAmount.lt(new BN(lamports))) {
      throw new Error('Insufficient balance');
    }

    const changeAmount = totalInputAmount.sub(new BN(amountAfterFee)).sub(new BN(feeInLamports));

    // Get merkle proofs
    const inputMerkleProofs = await Promise.all(
      inputs.map(async (utxo) => {
        if (utxo.amount.eq(new BN(0))) {
          return { pathElements: tree.getZeroPath(), pathIndices: [] };
        }
        return fetchMerkleProof(await utxo.getCommitment());
      })
    );

    const inputMerklePathElements = inputMerkleProofs.map(p => p.pathElements);
    const inputMerklePathIndices = inputs.map(u => u.index || 0);

    const outputs = [
      new Utxo({
        lightWasm,
        amount: changeAmount.toString(),
        keypair: utxoKeypairV2,
        index: nextIndex,
      }),
      new Utxo({
        lightWasm,
        amount: '0',
        keypair: utxoKeypairV2,
        index: nextIndex + 1,
      }),
    ];

    const extAmount = -amountAfterFee;
    const publicAmountForCircuit = new BN(extAmount)
      .sub(new BN(feeInLamports))
      .add(FIELD_SIZE)
      .mod(FIELD_SIZE);

    const inputNullifiers = await Promise.all(inputs.map(x => x.getNullifier()));
    const outputCommitments = await Promise.all(outputs.map(x => x.getCommitment()));

    const encryptedOutput1 = encryptionService.encryptUtxo(outputs[0]);
    const encryptedOutput2 = encryptionService.encryptUtxo(outputs[1]);

    const extData = {
      recipient,
      extAmount: new BN(extAmount),
      encryptedOutput1,
      encryptedOutput2,
      fee: new BN(feeInLamports),
      feeRecipient: FEE_RECIPIENT,
      mintAddress: inputs[0].mintAddress,
    };

    const extDataHash = this.getExtDataHash(extData);

    const proofInput = {
      root,
      inputNullifier: inputNullifiers,
      outputCommitment: outputCommitments,
      publicAmount: publicAmountForCircuit.toString(),
      extDataHash,
      inAmount: inputs.map(x => x.amount.toString(10)),
      inPrivateKey: inputs.map(x => x.keypair.privkey.toString()),
      inBlinding: inputs.map(x => x.blinding.toString(10)),
      inPathIndices: inputMerklePathIndices,
      inPathElements: inputMerklePathElements,
      outAmount: outputs.map(x => x.amount.toString(10)),
      outBlinding: outputs.map(x => x.blinding.toString(10)),
      outPubkey: outputs.map(x => x.keypair.pubkey.toString()),
      mintAddress: inputs[0].mintAddress,
    };

    logger.info('Generating ZK proof for withdrawal');
    const { proof, publicSignals } = await generateProof(proofInput);

    const proofInBytes = parseProofToBytesArray(proof);
    const inputsInBytes = parseToBytesArray(publicSignals);

    const proofToSubmit = {
      proofA: proofInBytes.proofA,
      proofB: proofInBytes.proofB.flat(),
      proofC: proofInBytes.proofC,
      root: inputsInBytes[0],
      publicAmount: inputsInBytes[1],
      extDataHash: inputsInBytes[2],
      inputNullifiers: [inputsInBytes[3], inputsInBytes[4]],
      outputCommitments: [inputsInBytes[5], inputsInBytes[6]],
    };

    const { nullifier0PDA, nullifier1PDA } = findNullifierPDAs(proofToSubmit);
    const { nullifier2PDA, nullifier3PDA } = findCrossCheckNullifierPDAs(proofToSubmit);

    const serializedProof = serializeProofAndExtData(proofToSubmit, extData, false);

    const { treeAccount, treeTokenAccount, globalConfigAccount } = getProgramAccounts();

    return {
      withdrawParams: {
        serializedProof: serializedProof.toString('base64'),
        treeAccount: treeAccount.toBase58(),
        nullifier0PDA: nullifier0PDA.toBase58(),
        nullifier1PDA: nullifier1PDA.toBase58(),
        nullifier2PDA: nullifier2PDA.toBase58(),
        nullifier3PDA: nullifier3PDA.toBase58(),
        treeTokenAccount: treeTokenAccount.toBase58(),
        globalConfigAccount: globalConfigAccount.toBase58(),
        recipient: recipient.toBase58(),
        feeRecipientAccount: FEE_RECIPIENT.toBase58(),
        extAmount,
        encryptedOutput1: encryptedOutput1.toString('base64'),
        encryptedOutput2: encryptedOutput2.toString('base64'),
        fee: feeInLamports,
        lookupTableAddress: config.altAddress.toBase58(),
        senderAddress: publicKey,
        referralWalletAddress: referrer,
      },
      metadata: {
        amount: amountAfterFee,
        fee: feeInLamports,
        recipient: recipientAddress,
      },
    };
  }

  /**
   * Submit a withdrawal
   */
  async submitWithdraw(params: {
    withdrawParams: Record<string, any>;
    encryptedOutput1: string;
    tokenName?: string;
  }): Promise<{ signature: string; success: boolean }> {
    const { withdrawParams, encryptedOutput1, tokenName } = params;

    const result = await submitWithdraw(withdrawParams as any);

    // Wait for confirmation
    let confirmed = false;
    let retries = 0;

    while (!confirmed && retries < 10) {
      await new Promise(r => setTimeout(r, 2000));
      confirmed = await checkUtxoExists(encryptedOutput1, tokenName);
      retries++;
    }

    return result;
  }

  /**
   * Calculate ext data hash (matches SDK implementation)
   */
  private getExtDataHash(extData: {
    recipient: PublicKey;
    extAmount: BN;
    encryptedOutput1: Buffer;
    encryptedOutput2: Buffer;
    fee: BN;
    feeRecipient: PublicKey;
    mintAddress?: string;
  }): string {
    const data = Buffer.concat([
      extData.recipient.toBuffer(),
      Buffer.from(extData.extAmount.toTwos(64).toArray('le', 8)),
      extData.encryptedOutput1,
      extData.encryptedOutput2,
      Buffer.from(extData.fee.toArray('le', 8)),
      extData.feeRecipient.toBuffer(),
      // ExtData expects the mint address as bytes (32 bytes for PublicKey)
      // For SOL, use the system program address
      !extData.mintAddress || extData.mintAddress === '11111111111111111111111111111112'
        ? new PublicKey('So11111111111111111111111111111111111111112').toBuffer()
        : new PublicKey(extData.mintAddress).toBuffer(),
    ]);

    const hash = keccak256(data);
    const hashBN = new BN(hash.slice(2), 16);
    return hashBN.mod(FIELD_SIZE).toString();
  }

  /**
   * Get mint address field for circuit (matches SDK)
   */
  private getMintAddressField(mint: PublicKey): string {
    const mintStr = mint.toString();

    // Special case for SOL (system program)
    if (mintStr === '11111111111111111111111111111112') {
      return mintStr;
    }

    // For SPL tokens: use first 31 bytes (matches SDK)
    const mintBytes = mint.toBytes();
    return new BN(mintBytes.slice(0, 31), 'be').toString();
  }
}

// Singleton instance
export const privacyCashService = new PrivacyCashService();
