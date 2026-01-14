/**
 * Direct SDK test - uses Privacy Cash SDK directly
 * NOTE: Privacy Cash only works on MAINNET - requires real SOL
 * 
 * Usage: npm run sdk:test
 */

import 'dotenv/config';
import { Keypair, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { PrivacyCash } from '../sdk-reference/src/index.js';

function getOwnerSecretArray(): number[] {
  const pk = process.env.TEST_PRIVATE_KEY;
  if (!pk) throw new Error('TEST_PRIVATE_KEY not set in .env');
  return JSON.parse(pk);
}

function getTestKeypair(): Keypair {
  const keyArray = getOwnerSecretArray();
  return Keypair.fromSecretKey(Uint8Array.from(keyArray));
}

async function main() {
  console.log('\n🧪 Privacy Cash SDK Direct Test (MAINNET)\n');
  console.log('⚠️  This uses REAL SOL on mainnet!\n');
  console.log('='.repeat(60));

  const keypair = getTestKeypair();
  console.log(`\n📍 Wallet: ${keypair.publicKey.toBase58()}`);

  // Use devnet for testing
  const isMainnet = process.env.NODE_ENV === 'production';
  let rpcUrl = process.env.DEVNET_RPC_URL || 'https://api.devnet.solana.com';
  
  if (isMainnet) {
    rpcUrl = process.env.MAINNET_RPC_URL;
    if (!rpcUrl) throw new Error('MAINNET_RPC_URL required for mainnet');
  }
  
  if (!isMainnet) {
    console.log('⚠️  Note: Privacy Cash only works on mainnet');
    console.log('   This test will fail at the relayer step\n');
  }

  const connection = new Connection(rpcUrl, 'confirmed');
  const balance = await connection.getBalance(keypair.publicKey);
  console.log(`💰 SOL Balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  if (balance < 0.02 * LAMPORTS_PER_SOL) {
    console.log('\n❌ Need at least 0.02 SOL on mainnet for testing');
    console.log('   Send SOL to: ' + keypair.publicKey.toBase58());
    process.exit(1);
  }

  // Initialize client
  console.log('\n1️⃣  Initializing Privacy Cash...');
  const client = new PrivacyCash({
    RPC_url: rpcUrl,
    // Pass raw secret key bytes so SDK can construct its own Keypair
    owner: getOwnerSecretArray(),
    enableDebug: true,
  });

  // Check shielded balance
  console.log('\n2️⃣  Checking shielded balance...');
  try {
    const shielded = await client.getPrivateBalance();
    console.log(`   🔒 Shielded: ${shielded.lamports / LAMPORTS_PER_SOL} SOL`);
  } catch {
    console.log('   🔒 Shielded: 0 SOL');
  }

  // Deposit
  const depositLamports = 0.005 * LAMPORTS_PER_SOL;
  console.log(`\n3️⃣  Depositing 0.005 SOL...`);
  const depositResult = await client.deposit({ lamports: depositLamports });
  console.log(`   ✅ TX: ${depositResult.tx}`);

  // Wait
  console.log('\n4️⃣  Waiting for confirmation...');
  await new Promise(r => setTimeout(r, 5000));

  // Check new balance
  const newShielded = await client.getPrivateBalance();
  console.log(`   🔒 Shielded: ${newShielded.lamports / LAMPORTS_PER_SOL} SOL`);

  // Withdraw (less than we deposited to cover fees)
  const withdrawLamports = 0.002 * LAMPORTS_PER_SOL;
  console.log(`\n5️⃣  Withdrawing 0.002 SOL...`);
  const withdrawResult = await client.withdraw({
    lamports: withdrawLamports,
    recipientAddress: keypair.publicKey.toBase58(),
  });
  console.log(`   ✅ TX: ${withdrawResult.tx}`);
  console.log(`   Received: ${withdrawResult.amount_in_lamports / LAMPORTS_PER_SOL} SOL`);
  console.log(`   Fee: ${withdrawResult.fee_in_lamports / LAMPORTS_PER_SOL} SOL`);

  // Final
  console.log('\n6️⃣  Final balances...');
  await new Promise(r => setTimeout(r, 3000));
  const finalSol = await connection.getBalance(keypair.publicKey);
  const finalShielded = await client.getPrivateBalance();
  console.log(`   💰 SOL: ${finalSol / LAMPORTS_PER_SOL} SOL`);
  console.log(`   🔒 Shielded: ${finalShielded.lamports / LAMPORTS_PER_SOL} SOL`);

  console.log('\n' + '='.repeat(60));
  console.log('✅ Full flow test completed!\n');
  
  // Force exit to prevent hanging
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
