import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { config } from '../config/env.js';

// Field size for ZK circuits (same as SDK)
export const FIELD_SIZE = new BN(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);

// Merkle tree depth (same as SDK)
export const MERKLE_TREE_DEPTH = 26;

// Fee recipient (same as SDK)
export const FEE_RECIPIENT = new PublicKey('AWexibGxNFKTa1b5R5MN4PJr9HWnWRwf8EW9g8cLx3dM');

// Transaction instruction discriminators (same as SDK)
export const TRANSACT_IX_DISCRIMINATOR = Buffer.from([217, 149, 130, 143, 221, 52, 252, 119]);
export const TRANSACT_SPL_IX_DISCRIMINATOR = Buffer.from([154, 66, 244, 204, 78, 225, 163, 151]);

// UTXO fetch batch size
export const FETCH_UTXOS_GROUP_SIZE = 20_000;

// Sign message for encryption key derivation
export const SIGN_MESSAGE = 'Privacy Money account sign in';

// Get program accounts (derived PDAs)
export function getProgramAccounts() {
  const programId = config.programId;

  const [treeAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from('merkle_tree')],
    programId
  );

  const [treeTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from('tree_token')],
    programId
  );

  const [globalConfigAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from('global_config')],
    programId
  );

  return { treeAccount, treeTokenAccount, globalConfigAccount };
}

// Get SPL tree account (different PDA for SPL tokens)
export function getSplTreeAccount(mintAddress: PublicKey) {
  const programId = config.programId;

  const [treeAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from('merkle_tree'), mintAddress.toBuffer()],
    programId
  );

  return treeAccount;
}

// Path to ZK circuit files
export function getCircuitBasePath(): string {
  return new URL('../../circuit2/transaction2', import.meta.url).pathname;
}
