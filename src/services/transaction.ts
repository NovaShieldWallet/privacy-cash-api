import {
  Connection,
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  ComputeBudgetProgram,
  VersionedTransaction,
  TransactionMessage,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import BN from 'bn.js';
import { config } from '../config/env.js';
import {
  getProgramAccounts,
  getSplTreeAccount,
  FEE_RECIPIENT,
  TRANSACT_IX_DISCRIMINATOR,
  TRANSACT_SPL_IX_DISCRIMINATOR,
} from '../utils/constants.js';
import { logger } from '../middleware/logging.js';

// @ts-ignore
import * as ffjavascript from 'ffjavascript';
const utils = ffjavascript.utils as any;
const { unstringifyBigInts, leInt2Buff } = utils;

interface ProofData {
  proofA: number[];
  proofB: number[];
  proofC: number[];
  root: number[];
  publicAmount: number[];
  extDataHash: number[];
  inputNullifiers: number[][];
  outputCommitments: number[][];
}

interface ExtData {
  recipient: PublicKey;
  extAmount: BN;
  encryptedOutput1: Buffer;
  encryptedOutput2: Buffer;
  fee: BN;
  feeRecipient: PublicKey;
  mintAddress?: string;
}

/**
 * Find nullifier PDAs for a proof
 */
export function findNullifierPDAs(proof: ProofData) {
  const programId = config.programId;

  const [nullifier0PDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('nullifier0'), Buffer.from(proof.inputNullifiers[0])],
    programId
  );
  const [nullifier1PDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('nullifier1'), Buffer.from(proof.inputNullifiers[1])],
    programId
  );

  return { nullifier0PDA, nullifier1PDA };
}

/**
 * Find cross-check nullifier PDAs
 * Must match SDK reference implementation exactly
 */
export function findCrossCheckNullifierPDAs(proof: ProofData) {
  const programId = config.programId;

  // nullifier2 uses nullifier0 seed with inputNullifiers[1]
  const [nullifier2PDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('nullifier0'), Buffer.from(proof.inputNullifiers[1])],
    programId
  );
  // nullifier3 uses nullifier1 seed with inputNullifiers[0]
  const [nullifier3PDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('nullifier1'), Buffer.from(proof.inputNullifiers[0])],
    programId
  );

  return { nullifier2PDA, nullifier3PDA };
}

/**
 * Serialize proof and ext data for on-chain submission
 */
export function serializeProofAndExtData(proof: ProofData, extData: ExtData, isSpl: boolean = false): Buffer {
  const discriminator = isSpl ? TRANSACT_SPL_IX_DISCRIMINATOR : TRANSACT_IX_DISCRIMINATOR;

  return Buffer.concat([
    discriminator,
    Buffer.from(proof.proofA),
    Buffer.from(proof.proofB),
    Buffer.from(proof.proofC),
    Buffer.from(proof.root),
    Buffer.from(proof.publicAmount),
    Buffer.from(proof.extDataHash),
    Buffer.from(proof.inputNullifiers[0]),
    Buffer.from(proof.inputNullifiers[1]),
    Buffer.from(proof.outputCommitments[0]),
    Buffer.from(proof.outputCommitments[1]),
    Buffer.from(new BN(extData.extAmount).toTwos(64).toArray('le', 8)),
    Buffer.from(new BN(extData.fee).toArray('le', 8)),
    Buffer.from(new BN(extData.encryptedOutput1.length).toArray('le', 4)),
    extData.encryptedOutput1,
    Buffer.from(new BN(extData.encryptedOutput2.length).toArray('le', 4)),
    extData.encryptedOutput2,
  ]);
}

/**
 * Build an unsigned SOL deposit transaction
 * The client will sign this locally
 * Includes fee transfer instruction if depositFee is provided
 */
export async function buildUnsignedDepositTransaction(params: {
  connection: Connection;
  signer: PublicKey;
  proof: ProofData;
  extData: ExtData;
  depositFee?: number; // Fee in lamports to charge on deposit
  feeRecipient?: PublicKey; // Wallet to receive the deposit fee
}): Promise<{ transaction: VersionedTransaction; serializedProof: Buffer }> {
  const { connection, signer, proof, extData, depositFee, feeRecipient } = params;

  const { treeAccount, treeTokenAccount, globalConfigAccount } = getProgramAccounts();
  const { nullifier0PDA, nullifier1PDA } = findNullifierPDAs(proof);
  const { nullifier2PDA, nullifier3PDA } = findCrossCheckNullifierPDAs(proof);

  const serializedProof = serializeProofAndExtData(proof, extData, false);

  // Placeholder recipient (not used for deposits)
  const recipientPlaceholder = new PublicKey('AWexibGxNFKTa1b5R5MN4PJr9HWnWRwf8EW9g8cLx3dM');

  const depositInstruction = new TransactionInstruction({
    keys: [
      { pubkey: treeAccount, isSigner: false, isWritable: true },
      { pubkey: nullifier0PDA, isSigner: false, isWritable: true },
      { pubkey: nullifier1PDA, isSigner: false, isWritable: true },
      { pubkey: nullifier2PDA, isSigner: false, isWritable: false },
      { pubkey: nullifier3PDA, isSigner: false, isWritable: false },
      { pubkey: treeTokenAccount, isSigner: false, isWritable: true },
      { pubkey: globalConfigAccount, isSigner: false, isWritable: false },
      { pubkey: recipientPlaceholder, isSigner: false, isWritable: true },
      { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: true },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: config.programId,
    data: serializedProof,
  });

  const computeUnits = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 });

  // Build instructions array
  const instructions = [computeUnits, depositInstruction];

  // Add fee transfer instruction if deposit fee is specified
  if (depositFee && depositFee > 0 && feeRecipient) {
    const feeTransferInstruction = SystemProgram.transfer({
      fromPubkey: signer,
      toPubkey: feeRecipient,
      lamports: depositFee,
    });
    instructions.push(feeTransferInstruction);
    logger.debug('Added deposit fee transfer', { 
      fee: depositFee, 
      recipient: feeRecipient.toBase58() 
    });
  }

  // Fetch ALT
  const lookupTableAccount = await connection.getAddressLookupTable(config.altAddress);
  if (!lookupTableAccount.value) {
    throw new Error(`ALT not found at ${config.altAddress.toBase58()}`);
  }

  const recentBlockhash = await connection.getLatestBlockhash();

  const messageV0 = new TransactionMessage({
    payerKey: signer,
    recentBlockhash: recentBlockhash.blockhash,
    instructions,
  }).compileToV0Message([lookupTableAccount.value]);

  const transaction = new VersionedTransaction(messageV0);

  return { transaction, serializedProof };
}

/**
 * Build an unsigned SPL deposit transaction
 */
export async function buildUnsignedSplDepositTransaction(params: {
  connection: Connection;
  signer: PublicKey;
  mintAddress: PublicKey;
  proof: ProofData;
  extData: ExtData;
}): Promise<{ transaction: VersionedTransaction; serializedProof: Buffer }> {
  const { connection, signer, mintAddress, proof, extData } = params;

  const { globalConfigAccount } = getProgramAccounts();
  const treeAccount = getSplTreeAccount(mintAddress);
  const { nullifier0PDA, nullifier1PDA } = findNullifierPDAs(proof);
  const { nullifier2PDA, nullifier3PDA } = findCrossCheckNullifierPDAs(proof);

  const serializedProof = serializeProofAndExtData(proof, extData, true);

  // Token accounts
  const recipientPlaceholder = new PublicKey('AWexibGxNFKTa1b5R5MN4PJr9HWnWRwf8EW9g8cLx3dM');
  const recipientAta = getAssociatedTokenAddressSync(mintAddress, recipientPlaceholder, true);
  const feeRecipientTokenAccount = getAssociatedTokenAddressSync(mintAddress, FEE_RECIPIENT, true);
  const signerTokenAccount = getAssociatedTokenAddressSync(mintAddress, signer);

  const [globalConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('global_config')],
    config.programId
  );
  const treeAta = getAssociatedTokenAddressSync(mintAddress, globalConfigPda, true);

  const depositInstruction = new TransactionInstruction({
    keys: [
      { pubkey: treeAccount, isSigner: false, isWritable: true },
      { pubkey: nullifier0PDA, isSigner: false, isWritable: true },
      { pubkey: nullifier1PDA, isSigner: false, isWritable: true },
      { pubkey: nullifier2PDA, isSigner: false, isWritable: false },
      { pubkey: nullifier3PDA, isSigner: false, isWritable: false },
      { pubkey: globalConfigAccount, isSigner: false, isWritable: false },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: mintAddress, isSigner: false, isWritable: false },
      { pubkey: signerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: recipientPlaceholder, isSigner: false, isWritable: true },
      { pubkey: recipientAta, isSigner: false, isWritable: true },
      { pubkey: treeAta, isSigner: false, isWritable: true },
      { pubkey: feeRecipientTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: config.programId,
    data: serializedProof,
  });

  const computeUnits = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 });

  const lookupTableAccount = await connection.getAddressLookupTable(config.altAddress);
  if (!lookupTableAccount.value) {
    throw new Error(`ALT not found at ${config.altAddress.toBase58()}`);
  }

  const recentBlockhash = await connection.getLatestBlockhash();

  const messageV0 = new TransactionMessage({
    payerKey: signer,
    recentBlockhash: recentBlockhash.blockhash,
    instructions: [computeUnits, depositInstruction],
  }).compileToV0Message([lookupTableAccount.value]);

  const transaction = new VersionedTransaction(messageV0);

  return { transaction, serializedProof };
}

/**
 * Serialize a transaction for sending to client
 */
export function serializeTransaction(tx: VersionedTransaction): string {
  return Buffer.from(tx.serialize()).toString('base64');
}

/**
 * Deserialize a transaction from client
 */
export function deserializeTransaction(serialized: string): VersionedTransaction {
  const buffer = Buffer.from(serialized, 'base64');
  return VersionedTransaction.deserialize(buffer);
}
