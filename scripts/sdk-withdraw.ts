/**
 * Withdraw SOL from Privacy Cash (mainnet)
 * Usage: npm run sdk:withdraw [amount] [recipient]
 * Example: npm run sdk:withdraw 0.005
 * Example: npm run sdk:withdraw 0.005 SomeOtherAddress...
 */

import 'dotenv/config';
import { Keypair, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { PrivacyCash } from '../sdk-reference/src/index.js';

const AMOUNT = parseFloat(process.argv[2] || '0.005');
const RECIPIENT = process.argv[3];

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
  console.log(`\n💸 Withdraw ${AMOUNT} SOL from Privacy Cash (Mainnet)\n`);

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

  const recipient = RECIPIENT || keypair.publicKey.toBase58();
  console.log(`Wallet: ${keypair.publicKey.toBase58()}`);
  console.log(`Recipient: ${recipient}\n`);

  const client = new PrivacyCash({
    RPC_url: rpcUrl,
    // Pass raw secret key bytes so SDK can construct its own Keypair
    owner: getOwnerSecretArray(),
    enableDebug: true,
  });

  // Check shielded balance
  console.log('Checking shielded balance...');
  const shielded = await client.getPrivateBalance();
  console.log(`Shielded: ${shielded.lamports / LAMPORTS_PER_SOL} SOL\n`);

  if (shielded.lamports < AMOUNT * LAMPORTS_PER_SOL) {
    throw new Error('Insufficient shielded balance');
  }

  // Withdraw
  console.log('Withdrawing...');
  const result = await client.withdraw({
    lamports: AMOUNT * LAMPORTS_PER_SOL,
    recipientAddress: recipient,
  });

  console.log(`\n✅ Withdraw successful!`);
  console.log(`TX: ${result.tx}`);
  console.log(`Received: ${result.amount_in_lamports / LAMPORTS_PER_SOL} SOL`);
  console.log(`Fee: ${result.fee_in_lamports / LAMPORTS_PER_SOL} SOL`);
  console.log(`Explorer: https://explorer.solana.com/tx/${result.tx}\n`);
  
  // Force exit to prevent hanging
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
