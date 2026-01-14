/**
 * API Test Script - Tests the Nova Privacy Cash API
 * Usage: npm run test:api
 */

import 'dotenv/config';
import { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const API_BASE = 'http://localhost:3000/v1';
const SIGN_MESSAGE = 'Privacy Money account sign in';

function getTestKeypair(): Keypair {
  const pk = process.env.TEST_PRIVATE_KEY;
  if (!pk) throw new Error('TEST_PRIVATE_KEY not set');
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(pk)));
}

function signMessage(keypair: Keypair): string {
  const messageBytes = new TextEncoder().encode(SIGN_MESSAGE);
  const signature = nacl.sign.detached(messageBytes, keypair.secretKey);
  return bs58.encode(signature);
}

async function testHealth(): Promise<boolean> {
  console.log('\n🧪 Testing /v1/health...');
  const res = await fetch(`${API_BASE}/health`);
  const data = await res.json();
  console.log(`   Status: ${data.status}, Network: ${data.network}`);
  return data.status === 'ok' && data.network === 'mainnet';
}

async function testBalance(keypair: Keypair): Promise<boolean> {
  console.log('\n🧪 Testing /v1/balance...');
  const signature = signMessage(keypair);
  
  const res = await fetch(`${API_BASE}/balance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: keypair.publicKey.toBase58(),
      signature,
    }),
  });
  
  const data = await res.json();
  if (!res.ok) {
    console.log(`   ❌ Error: ${data.error}`);
    return false;
  }
  
  console.log(`   SOL Balance: ${data.balances?.sol?.formatted || '0'} SOL`);
  console.log(`   Shielded SOL: ${data.balances?.sol?.shielded?.formatted || '0'} SOL`);
  return true;
}

async function testConfig(): Promise<boolean> {
  console.log('\n🧪 Testing /v1/config...');
  const res = await fetch(`${API_BASE}/config`);
  const data = await res.json();
  
  if (!res.ok) {
    console.log(`   ❌ Error: ${data.error}`);
    return false;
  }
  
  console.log(`   Supported tokens: ${data.supportedTokens?.join(', ')}`);
  console.log(`   Withdraw fee rate: ${(data.fees?.withdrawFeeRate * 100).toFixed(2)}%`);
  console.log(`   SOL rent fee: ${data.fees?.rentFees?.sol} SOL`);
  return true;
}

async function testDepositPrepare(keypair: Keypair): Promise<any> {
  console.log('\n🧪 Testing /v1/deposit/prepare (SOL)...');
  const signature = signMessage(keypair);
  
  const res = await fetch(`${API_BASE}/deposit/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: keypair.publicKey.toBase58(),
      signature,
      amount: 0.001, // Very small amount for test
    }),
  });
  
  const data = await res.json();
  if (!res.ok) {
    console.log(`   ❌ Error: ${data.error}`);
    return null;
  }
  
  console.log(`   ✅ Transaction prepared`);
  console.log(`   Amount: ${data.metadata?.amount} lamports`);
  console.log(`   Has unsigned tx: ${!!data.unsignedTransaction}`);
  return data;
}

async function testDepositPrepareSPL(keypair: Keypair, mint: string, tokenName: string): Promise<any> {
  console.log(`\n🧪 Testing /v1/deposit/prepare (${tokenName})...`);
  const signature = signMessage(keypair);
  
  const res = await fetch(`${API_BASE}/deposit/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: keypair.publicKey.toBase58(),
      signature,
      amount: 0.01, // Small amount for test
      mintAddress: mint,
    }),
  });
  
  const data = await res.json();
  if (!res.ok) {
    console.log(`   ❌ Error: ${data.error}`);
    return null;
  }
  
  console.log(`   ✅ Transaction prepared`);
  console.log(`   Has unsigned tx: ${!!data.unsignedTransaction}`);
  return data;
}

async function main() {
  console.log('═'.repeat(60));
  console.log('🚀 NOVA PRIVACY CASH API TEST');
  console.log('═'.repeat(60));
  
  const keypair = getTestKeypair();
  console.log(`\n📍 Wallet: ${keypair.publicKey.toBase58()}`);
  
  let passed = 0;
  let failed = 0;
  
  // Test health
  if (await testHealth()) passed++; else failed++;
  
  // Test config
  if (await testConfig()) passed++; else failed++;
  
  // Test balance
  if (await testBalance(keypair)) passed++; else failed++;
  
  // Test SOL deposit prepare
  const solDeposit = await testDepositPrepare(keypair);
  if (solDeposit) passed++; else failed++;
  
  // Test USDC deposit prepare
  const usdcDeposit = await testDepositPrepareSPL(
    keypair, 
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    'USDC'
  );
  if (usdcDeposit) passed++; else failed++;
  
  // Test ORE deposit prepare
  const oreDeposit = await testDepositPrepareSPL(
    keypair,
    'oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp',
    'ORE'
  );
  if (oreDeposit) passed++; else failed++;
  
  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log(`📊 Results: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(60) + '\n');
  
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
