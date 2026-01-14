/**
 * Validate setup - check if everything is configured correctly
 */

import 'dotenv/config';
import { existsSync } from 'fs';
import { join } from 'path';

console.log('\n🔍 Validating Setup\n');
console.log('='.repeat(60));

let errors: string[] = [];
let warnings: string[] = [];

// Check .env file
if (!existsSync('.env')) {
  errors.push('❌ .env file not found - copy env.example to .env');
} else {
  console.log('✅ .env file exists');
}

// Check TEST_PRIVATE_KEY
const testKey = process.env.TEST_PRIVATE_KEY;
if (!testKey || testKey.trim() === '') {
  warnings.push('⚠️  TEST_PRIVATE_KEY not set - scripts will not work');
  console.log('⚠️  TEST_PRIVATE_KEY not set');
} else {
  console.log('✅ TEST_PRIVATE_KEY is set');
}

// Check MAINNET_RPC_URL
const rpcUrl = process.env.MAINNET_RPC_URL;
if (!rpcUrl || rpcUrl.trim() === '') {
  errors.push('❌ MAINNET_RPC_URL not set - required for Privacy Cash');
  console.log('❌ MAINNET_RPC_URL not set');
} else {
  console.log('✅ MAINNET_RPC_URL is set');
}

// Check SDK exists
const sdkPath = join(process.cwd(), 'sdk-reference', 'src', 'index.ts');
if (!existsSync(sdkPath)) {
  errors.push('❌ SDK not found at sdk-reference/src/index.ts');
  console.log('❌ SDK not found');
} else {
  console.log('✅ SDK found');
}

// Check circuit files
const circuitWasm = join(process.cwd(), 'circuit2', 'transaction2.wasm');
const circuitZkey = join(process.cwd(), 'circuit2', 'transaction2.zkey');
if (!existsSync(circuitWasm) || !existsSync(circuitZkey)) {
  errors.push('❌ Circuit files not found in circuit2/');
  console.log('❌ Circuit files missing');
} else {
  console.log('✅ Circuit files found');
}

console.log('\n' + '='.repeat(60));

if (errors.length > 0) {
  console.log('\n❌ Errors found:');
  errors.forEach(e => console.log(`   ${e}`));
  process.exit(1);
}

if (warnings.length > 0) {
  console.log('\n⚠️  Warnings:');
  warnings.forEach(w => console.log(`   ${w}`));
  console.log('\n💡 To test:');
  console.log('   1. Set TEST_PRIVATE_KEY in .env (base64 encoded keypair)');
  console.log('   2. Fund the wallet with real SOL on mainnet');
  console.log('   3. Run: npm run sdk:balance');
} else {
  console.log('\n✅ Setup looks good!');
  console.log('\n📝 Available commands:');
  console.log('   npm run sdk:balance    - Check balances');
  console.log('   npm run sdk:deposit    - Deposit SOL');
  console.log('   npm run sdk:withdraw   - Withdraw SOL');
  console.log('   npm run sdk:test       - Full flow test');
}

console.log('');
