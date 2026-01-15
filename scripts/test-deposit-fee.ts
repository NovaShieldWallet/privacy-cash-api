/**
 * Test deposit with fee calculation and transaction simulation
 */

import 'dotenv/config';
import { Keypair, Connection, VersionedTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import nacl from 'tweetnacl';
import fs from 'fs';

const API_URL = process.env.API_URL || 'http://localhost:3000';
const SIGN_MESSAGE = 'Privacy Money account sign in';

function getTestKeypair(): Keypair {
  const walletPath = './test-wallet.json';
  if (!fs.existsSync(walletPath)) {
    throw new Error('test-wallet.json not found - create it with a test wallet');
  }
  const keyArray = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(keyArray));
}

async function main() {
  console.log('\n🧪 Testing Deposit with Fee\n');
  console.log('='.repeat(60));

  const keypair = getTestKeypair();
  console.log(`📍 Wallet: ${keypair.publicKey.toBase58()}\n`);

  // Get mainnet RPC
  const rpcUrl = process.env.MAINNET_RPC_URL;
  if (!rpcUrl) {
    throw new Error('MAINNET_RPC_URL is required');
  }

  const connection = new Connection(rpcUrl, 'confirmed');
  const solBalance = await connection.getBalance(keypair.publicKey);
  console.log(`💰 SOL Balance: ${solBalance / LAMPORTS_PER_SOL} SOL\n`);

  // Sign auth message
  console.log('1️⃣  Signing authentication message...');
  const signature = nacl.sign.detached(Buffer.from(SIGN_MESSAGE), keypair.secretKey);
  const signatureBase64 = Buffer.from(signature).toString('base64');
  console.log('   ✅ Signed\n');

  // Test deposit amounts
  const testAmounts = [0.1, 0.5, 1.0, 2.0]; // SOL amounts

  for (const amount of testAmounts) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 Testing deposit of ${amount} SOL\n`);

    try {
      // Test: POST /v1/deposit/prepare
      console.log('2️⃣  Testing POST /v1/deposit/prepare...');
      const prepareRes = await fetch(`${API_URL}/v1/deposit/prepare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicKey: keypair.publicKey.toBase58(),
          signature: signatureBase64,
          amount: amount,
        }),
      });

      if (!prepareRes.ok) {
        const err = await prepareRes.json();
        console.log(`   ❌ Failed: ${err.error}\n`);
        continue;
      }

      const prepareData = await prepareRes.json();
      console.log(`   ✅ Deposit prepared`);
      console.log(`   📝 Amount: ${prepareData.metadata.amount / LAMPORTS_PER_SOL} SOL`);
      
      if (prepareData.metadata.fee) {
        console.log(`   💰 Fee: ${prepareData.metadata.fee / LAMPORTS_PER_SOL} SOL (${(prepareData.metadata.feeRate * 100).toFixed(2)}%)`);
        console.log(`   📉 Amount after fee: ${prepareData.metadata.amountAfterFee / LAMPORTS_PER_SOL} SOL`);
        
        // Verify fee calculation (1% with minimum 0.001 SOL)
        const expectedFee = Math.max(
          Math.floor(amount * LAMPORTS_PER_SOL * 0.01),
          1_000_000 // 0.001 SOL minimum
        );
        
        if (prepareData.metadata.fee === expectedFee) {
          console.log(`   ✅ Fee calculation correct`);
        } else {
          console.log(`   ⚠️  Fee mismatch! Expected: ${expectedFee}, Got: ${prepareData.metadata.fee}`);
        }
      } else {
        console.log(`   ⚠️  No fee information in response`);
      }

      // Deserialize and inspect transaction
      console.log('\n3️⃣  Inspecting transaction...');
      const txBuffer = Buffer.from(prepareData.unsignedTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(txBuffer);
      
      console.log(`   📦 Transaction has ${transaction.message.compiledInstructions.length} instructions`);
      
      // Check if fee transfer instruction exists
      const hasFeeTransfer = transaction.message.compiledInstructions.length > 2; // compute budget + deposit + fee transfer
      if (hasFeeTransfer) {
        console.log(`   ✅ Fee transfer instruction found`);
      } else {
        console.log(`   ⚠️  Fee transfer instruction missing`);
      }

      // Simulate transaction
      console.log('\n4️⃣  Simulating transaction...');
      try {
        const simulation = await connection.simulateTransaction(transaction, {
          replaceRecentBlockhash: true,
          sigVerify: false,
        });
        
        if (simulation.value.err) {
          console.log(`   ⚠️  Simulation error: ${JSON.stringify(simulation.value.err)}`);
        } else {
          console.log(`   ✅ Simulation successful`);
          console.log(`   📊 Compute units used: ${simulation.value.unitsConsumed || 'N/A'}`);
          console.log(`   💸 Fee: ${simulation.value.fee || 'N/A'} lamports`);
        }
      } catch (simError: any) {
        console.log(`   ⚠️  Simulation failed: ${simError.message}`);
        console.log(`   (This is expected if wallet doesn't have sufficient balance)`);
      }

    } catch (e: any) {
      console.log(`   ❌ Error: ${e.message}\n`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ Deposit fee test completed!\n');
}

main().catch(err => {
  console.error('\n❌ Test failed:', err.message);
  process.exit(1);
});