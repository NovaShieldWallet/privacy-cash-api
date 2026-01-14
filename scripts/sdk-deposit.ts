/**
 * Deposit SOL to Privacy Cash (mainnet)
 * Usage: npm run sdk:deposit [amount]
 * Example: npm run sdk:deposit 0.01
 */

import 'dotenv/config';
import { Keypair, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { PrivacyCash } from '../sdk-reference/src/index.js';

const AMOUNT = parseFloat(process.argv[2] || '0.01');

function getOwnerSecretArray(): number[] {
  const pk = process.env.TEST_PRIVATE_KEY;
  if (!pk) throw new Error('TEST_PRIVATE_KEY not set');
  return JSON.parse(pk);
}

function getTestKeypair(): Keypair {
  const keyArray = getOwnerSecretArray();
  return Keypair.fromSecretKey(Uint8Array.from(keyArray));
}

async function main() {
  console.log(`\n💰 Deposit ${AMOUNT} SOL to Privacy Cash (Mainnet)\n`);

  const keypair = getTestKeypair();
  const isMainnet = process.env.NODE_ENV === 'production';
  let rpcUrl = process.env.DEVNET_RPC_URL || 'https://api.devnet.solana.com';
  
  if (isMainnet) {
    rpcUrl = process.env.MAINNET_RPC_URL;
    if (!rpcUrl) throw new Error('MAINNET_RPC_URL required for mainnet');
  }
  
  if (!isMainnet) {
    console.log('⚠️  Privacy Cash only works on mainnet - this will fail at relayer\n');
  }

  console.log(`Wallet: ${keypair.publicKey.toBase58()}`);

  // Check balance
  const connection = new Connection(rpcUrl, 'confirmed');
  const balance = await connection.getBalance(keypair.publicKey);
  console.log(`Current SOL: ${balance / LAMPORTS_PER_SOL} SOL\n`);

  if (balance < AMOUNT * LAMPORTS_PER_SOL) {
    throw new Error('Insufficient balance');
  }

  // Deposit
  console.log('Depositing...');
  const client = new PrivacyCash({
    RPC_url: rpcUrl,
    // Pass raw secret key bytes so SDK can construct its own Keypair
    owner: getOwnerSecretArray(),
    enableDebug: true,
  });

  const result = await client.deposit({
    lamports: AMOUNT * LAMPORTS_PER_SOL,
  });

  console.log(`\n✅ Deposit successful!`);
  console.log(`TX: ${result.tx}`);
  console.log(`Explorer: https://explorer.solana.com/tx/${result.tx}\n`);
  
  // Force exit to prevent hanging
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
