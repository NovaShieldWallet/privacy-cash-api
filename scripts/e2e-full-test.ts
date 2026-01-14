/**
 * Full End-to-End Test - Privacy Cash API
 * Tests: SOL, USDC, USDT, ORE deposit and withdrawal flows
 * 
 * Usage: npm run e2e:full
 * 
 * ⚠️  MAINNET ONLY - Uses real funds!
 */

import 'dotenv/config';
import { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, getAccount } from '@solana/spl-token';
import { PrivacyCash } from '../sdk-reference/src/index.js';

// Token mints (mainnet)
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDT_MINT = new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
const ORE_MINT = new PublicKey('oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp');

// Test amounts based on relayer config minimums:
// - SOL: min 0.01, rent fee ~0.006 SOL → need ~0.02 shielded to withdraw
// - ORE: min 0.02, rent fee ~0.005 ORE → need ~0.03 shielded to withdraw  
// - USDC: min 2, rent fee ~0.87 USDC → need ~3 shielded to withdraw
// - USDT: min 2, rent fee ~0.87 USDT → need ~3 shielded to withdraw
const SOL_DEPOSIT = 0.025;     // 0.025 SOL (to have enough for withdraw after fees)
const SOL_WITHDRAW = 0.015;    // Try to withdraw 0.015 SOL
const USDC_DEPOSIT = 2;        // 2 USDC
const USDC_WITHDRAW = 1.5;     // 1.5 USDC  
const USDT_DEPOSIT = 2;        // 2 USDT
const USDT_WITHDRAW = 1.5;     // 1.5 USDT
const ORE_DEPOSIT = 0.03;      // 0.03 ORE (need ~0.03 to cover min 0.02 + ~0.005 rent fee)
const ORE_WITHDRAW = 0.02;     // 0.02 ORE (minimum from config)

interface TestResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  tx?: string;
  error?: string;
  duration?: number;
}

interface RelayerConfig {
  withdraw_fee_rate: number;
  withdraw_rent_fee: number;
  rent_fees: Record<string, number>;
  minimum_withdrawal: Record<string, number>;
  prices: Record<string, number>;
}

const results: TestResult[] = [];
let relayerConfig: RelayerConfig;

function getOwnerSecretArray(): number[] {
  const pk = process.env.TEST_PRIVATE_KEY;
  if (!pk) throw new Error('TEST_PRIVATE_KEY not set in .env');
  return JSON.parse(pk);
}

function getTestKeypair(): Keypair {
  const keyArray = getOwnerSecretArray();
  return Keypair.fromSecretKey(Uint8Array.from(keyArray));
}

async function getTokenBalance(connection: Connection, wallet: PublicKey, mint: PublicKey): Promise<number> {
  try {
    const ata = getAssociatedTokenAddressSync(mint, wallet);
    const account = await getAccount(connection, ata);
    return Number(account.amount);
  } catch {
    return 0;
  }
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function runTest(
  name: string,
  testFn: () => Promise<{ tx?: string }>
): Promise<TestResult> {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`🧪 ${name}`);
  console.log(`${'─'.repeat(60)}`);
  
  const start = Date.now();
  try {
    const result = await testFn();
    const duration = Date.now() - start;
    console.log(`✅ PASSED (${(duration / 1000).toFixed(1)}s)`);
    if (result.tx) {
      console.log(`   TX: https://explorer.solana.com/tx/${result.tx}`);
    }
    return { name, status: 'passed', tx: result.tx, duration };
  } catch (err: any) {
    const duration = Date.now() - start;
    console.log(`❌ FAILED: ${err.message}`);
    return { name, status: 'failed', error: err.message, duration };
  }
}

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('🚀 PRIVACY CASH - FULL END-TO-END TEST');
  console.log('═'.repeat(60));
  console.log('\n⚠️  WARNING: This test uses REAL funds on MAINNET!\n');

  // Setup
  const keypair = getTestKeypair();
  const isMainnet = process.env.NODE_ENV === 'production';
  
  if (!isMainnet) {
    console.log('❌ This test requires NODE_ENV=production (mainnet only)');
    console.log('   Set NODE_ENV=production in .env and try again');
    process.exit(1);
  }

  const rpcUrl = process.env.MAINNET_RPC_URL;
  if (!rpcUrl) {
    console.log('❌ MAINNET_RPC_URL not set in .env');
    process.exit(1);
  }

  const connection = new Connection(rpcUrl, 'confirmed');
  console.log(`📍 Wallet: ${keypair.publicKey.toBase58()}`);

  // Fetch relayer config
  console.log('\n📋 Fetching relayer config...');
  const configRes = await fetch('https://api3.privacycash.org/config');
  relayerConfig = await configRes.json();
  
  console.log('\n💸 Withdrawal Requirements (from relayer):');
  console.log(`   SOL:  min ${relayerConfig.minimum_withdrawal.sol} SOL, rent fee ${relayerConfig.rent_fees.sol} SOL`);
  console.log(`   USDC: min ${relayerConfig.minimum_withdrawal.usdc} USDC, rent fee ${relayerConfig.rent_fees.usdc.toFixed(2)} USDC`);
  console.log(`   USDT: min ${relayerConfig.minimum_withdrawal.usdt} USDT, rent fee ${relayerConfig.rent_fees.usdt.toFixed(2)} USDT`);
  console.log(`   ORE:  min ${relayerConfig.minimum_withdrawal.ore} ORE, rent fee ${relayerConfig.rent_fees.ore.toFixed(6)} ORE`);

  // Check balances
  console.log('\n📊 Current Balances:');
  const solBalance = await connection.getBalance(keypair.publicKey);
  const usdcBalance = await getTokenBalance(connection, keypair.publicKey, USDC_MINT);
  const usdtBalance = await getTokenBalance(connection, keypair.publicKey, USDT_MINT);
  const oreBalance = await getTokenBalance(connection, keypair.publicKey, ORE_MINT);

  console.log(`   SOL:  ${(solBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`   USDC: ${(usdcBalance / 1e6).toFixed(2)} USDC`);
  console.log(`   USDT: ${(usdtBalance / 1e6).toFixed(2)} USDT`);
  console.log(`   ORE:  ${(oreBalance / 1e11).toFixed(6)} ORE`);

  // Initialize client
  const client = new PrivacyCash({
    RPC_url: rpcUrl,
    owner: getOwnerSecretArray(),
    enableDebug: true,
  });

  // Check shielded balances
  console.log('\n🔒 Shielded Balances:');
  try {
    const shieldedSol = await client.getPrivateBalance();
    console.log(`   SOL:  ${(shieldedSol.lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  } catch {
    console.log(`   SOL:  0 SOL`);
  }
  try {
    const shieldedUsdc = await client.getPrivateBalanceSpl(USDC_MINT);
    console.log(`   USDC: ${(shieldedUsdc.base_units / 1e6).toFixed(2)} USDC`);
  } catch {
    console.log(`   USDC: 0 USDC`);
  }
  try {
    const shieldedUsdt = await client.getPrivateBalanceSpl(USDT_MINT);
    console.log(`   USDT: ${(shieldedUsdt.base_units / 1e6).toFixed(2)} USDT`);
  } catch {
    console.log(`   USDT: 0 USDT`);
  }
  try {
    const shieldedOre = await client.getPrivateBalanceSpl(ORE_MINT);
    console.log(`   ORE:  ${(shieldedOre.base_units / 1e11).toFixed(6)} ORE`);
  } catch {
    console.log(`   ORE:  0 ORE`);
  }

  // ═══════════════════════════════════════════════════════════════
  // TEST 1: SOL Deposit
  // ═══════════════════════════════════════════════════════════════
  if (solBalance >= SOL_DEPOSIT * LAMPORTS_PER_SOL + 0.01 * LAMPORTS_PER_SOL) {
    results.push(await runTest(`SOL Deposit (${SOL_DEPOSIT} SOL)`, async () => {
      const result = await client.deposit({
        lamports: SOL_DEPOSIT * LAMPORTS_PER_SOL,
      });
      return { tx: result.tx };
    }));
    await sleep(3000); // Wait for confirmation
  } else {
    console.log(`\n⏭️  Skipping SOL deposit (insufficient balance, need ${SOL_DEPOSIT + 0.01} SOL)`);
    results.push({ name: `SOL Deposit (${SOL_DEPOSIT} SOL)`, status: 'skipped' });
  }

  // ═══════════════════════════════════════════════════════════════
  // TEST 2: SOL Withdraw
  // ═══════════════════════════════════════════════════════════════
  const solRentFee = relayerConfig.rent_fees.sol || 0.006;
  const solMinWithdraw = relayerConfig.minimum_withdrawal.sol || 0.01;
  try {
    const shieldedSol = await client.getPrivateBalance();
    const shieldedSolAmount = shieldedSol.lamports / LAMPORTS_PER_SOL;
    // Need: shielded >= min_withdraw + rent_fee + (min_withdraw * fee_rate)
    const minNeeded = solMinWithdraw + solRentFee + (solMinWithdraw * relayerConfig.withdraw_fee_rate);
    
    if (shieldedSolAmount >= minNeeded) {
      const withdrawAmount = Math.min(SOL_WITHDRAW, Math.floor((shieldedSolAmount - solRentFee) * 0.9 * 1000) / 1000);
      results.push(await runTest(`SOL Withdraw (${withdrawAmount} SOL)`, async () => {
        const result = await client.withdraw({
          lamports: withdrawAmount * LAMPORTS_PER_SOL,
          recipientAddress: keypair.publicKey.toBase58(),
        });
        return { tx: result.tx };
      }));
      await sleep(3000);
    } else {
      console.log(`\n⏭️  Skipping SOL withdraw (shielded: ${shieldedSolAmount.toFixed(4)} SOL, need ~${minNeeded.toFixed(4)} SOL [min ${solMinWithdraw} + fee ${solRentFee}])`);
      results.push({ name: `SOL Withdraw (${SOL_WITHDRAW} SOL)`, status: 'skipped' });
    }
  } catch {
    console.log(`\n⏭️  Skipping SOL withdraw (no shielded balance)`);
    results.push({ name: `SOL Withdraw (${SOL_WITHDRAW} SOL)`, status: 'skipped' });
  }

  // ═══════════════════════════════════════════════════════════════
  // TEST 3: USDC Deposit
  // ═══════════════════════════════════════════════════════════════
  if (usdcBalance >= USDC_DEPOSIT * 1e6) {
    results.push(await runTest(`USDC Deposit (${USDC_DEPOSIT} USDC)`, async () => {
      const result = await client.depositSPL({
        mintAddress: USDC_MINT,
        amount: USDC_DEPOSIT,
      });
      return { tx: result.tx };
    }));
    await sleep(3000);
  } else {
    console.log(`\n⏭️  Skipping USDC deposit (insufficient balance, need ${USDC_DEPOSIT} USDC)`);
    results.push({ name: `USDC Deposit (${USDC_DEPOSIT} USDC)`, status: 'skipped' });
  }

  // ═══════════════════════════════════════════════════════════════
  // TEST 4: USDC Withdraw
  // ═══════════════════════════════════════════════════════════════
  const USDC_RENT_FEE = 1.1; // ~1.1 USDC rent fee for withdrawals
  try {
    const shieldedUsdc = await client.getPrivateBalanceSpl(USDC_MINT);
    const usdcBalance = shieldedUsdc.base_units / 1e6;
    const availableForWithdraw = usdcBalance - USDC_RENT_FEE;
    if (availableForWithdraw >= 0.1) { // At least 0.1 USDC withdrawable after fees
      const withdrawAmount = Math.min(USDC_WITHDRAW, Math.floor(availableForWithdraw * 100) / 100);
      results.push(await runTest(`USDC Withdraw (${withdrawAmount} USDC)`, async () => {
        const result = await client.withdrawSPL({
          mintAddress: USDC_MINT,
          amount: withdrawAmount,
          recipientAddress: keypair.publicKey.toBase58(),
        });
        return { tx: result.tx };
      }));
      await sleep(3000);
    } else {
      console.log(`\n⏭️  Skipping USDC withdraw (shielded: ${usdcBalance.toFixed(2)} USDC, need ~${USDC_RENT_FEE} for fees)`);
      results.push({ name: `USDC Withdraw (${USDC_WITHDRAW} USDC)`, status: 'skipped' });
    }
  } catch {
    console.log(`\n⏭️  Skipping USDC withdraw (no shielded balance)`);
    results.push({ name: `USDC Withdraw (${USDC_WITHDRAW} USDC)`, status: 'skipped' });
  }

  // ═══════════════════════════════════════════════════════════════
  // TEST 5: USDT Deposit
  // ═══════════════════════════════════════════════════════════════
  if (usdtBalance >= USDT_DEPOSIT * 1e6) {
    results.push(await runTest(`USDT Deposit (${USDT_DEPOSIT} USDT)`, async () => {
      const result = await client.depositSPL({
        mintAddress: USDT_MINT,
        amount: USDT_DEPOSIT,
      });
      return { tx: result.tx };
    }));
    await sleep(3000);
  } else {
    console.log(`\n⏭️  Skipping USDT deposit (insufficient balance, need ${USDT_DEPOSIT} USDT)`);
    results.push({ name: `USDT Deposit (${USDT_DEPOSIT} USDT)`, status: 'skipped' });
  }

  // ═══════════════════════════════════════════════════════════════
  // TEST 6: USDT Withdraw
  // ═══════════════════════════════════════════════════════════════
  const USDT_RENT_FEE = 1.1; // ~1.1 USDT rent fee for withdrawals
  try {
    const shieldedUsdt = await client.getPrivateBalanceSpl(USDT_MINT);
    const usdtBalance = shieldedUsdt.base_units / 1e6;
    const availableForWithdraw = usdtBalance - USDT_RENT_FEE;
    if (availableForWithdraw >= 0.1) { // At least 0.1 USDT withdrawable after fees
      const withdrawAmount = Math.min(USDT_WITHDRAW, Math.floor(availableForWithdraw * 100) / 100);
      results.push(await runTest(`USDT Withdraw (${withdrawAmount} USDT)`, async () => {
        const result = await client.withdrawSPL({
          mintAddress: USDT_MINT,
          amount: withdrawAmount,
          recipientAddress: keypair.publicKey.toBase58(),
        });
        return { tx: result.tx };
      }));
      await sleep(3000);
    } else {
      console.log(`\n⏭️  Skipping USDT withdraw (shielded: ${usdtBalance.toFixed(2)} USDT, need ~${USDT_RENT_FEE} for fees)`);
      results.push({ name: `USDT Withdraw (${USDT_WITHDRAW} USDT)`, status: 'skipped' });
    }
  } catch {
    console.log(`\n⏭️  Skipping USDT withdraw (no shielded balance)`);
    results.push({ name: `USDT Withdraw (${USDT_WITHDRAW} USDT)`, status: 'skipped' });
  }

  // ═══════════════════════════════════════════════════════════════
  // TEST 7: ORE Deposit
  // ═══════════════════════════════════════════════════════════════
  if (oreBalance >= ORE_DEPOSIT * 1e11) {
    results.push(await runTest(`ORE Deposit (${ORE_DEPOSIT} ORE)`, async () => {
      const result = await client.depositSPL({
        mintAddress: ORE_MINT,
        amount: ORE_DEPOSIT,
      });
      return { tx: result.tx };
    }));
    await sleep(3000);
  } else {
    console.log(`\n⏭️  Skipping ORE deposit (insufficient balance, need ${ORE_DEPOSIT} ORE)`);
    results.push({ name: `ORE Deposit (${ORE_DEPOSIT} ORE)`, status: 'skipped' });
  }

  // ═══════════════════════════════════════════════════════════════
  // TEST 8: ORE Withdraw
  // ═══════════════════════════════════════════════════════════════
  const oreRentFee = relayerConfig.rent_fees.ore || 0.0052;
  const oreMinWithdraw = relayerConfig.minimum_withdrawal.ore || 0.02;
  try {
    const shieldedOre = await client.getPrivateBalanceSpl(ORE_MINT);
    const oreBalance = shieldedOre.base_units / 1e11;
    // Need: shielded >= min_withdraw + rent_fee + (min_withdraw * fee_rate)
    const minNeeded = oreMinWithdraw + oreRentFee + (oreMinWithdraw * relayerConfig.withdraw_fee_rate);
    
    if (oreBalance >= minNeeded) {
      const withdrawAmount = Math.min(ORE_WITHDRAW, Math.floor((oreBalance - oreRentFee) * 0.9 * 10000) / 10000);
      results.push(await runTest(`ORE Withdraw (${withdrawAmount} ORE)`, async () => {
        const result = await client.withdrawSPL({
          mintAddress: ORE_MINT,
          amount: withdrawAmount,
          recipientAddress: keypair.publicKey.toBase58(),
        });
        return { tx: result.tx };
      }));
      await sleep(3000);
    } else {
      console.log(`\n⏭️  Skipping ORE withdraw (shielded: ${oreBalance.toFixed(6)} ORE, need ~${minNeeded.toFixed(6)} ORE [min ${oreMinWithdraw} + fee ${oreRentFee.toFixed(6)}])`);
      results.push({ name: `ORE Withdraw (${ORE_WITHDRAW} ORE)`, status: 'skipped' });
    }
  } catch {
    console.log(`\n⏭️  Skipping ORE withdraw (no shielded balance)`);
    results.push({ name: `ORE Withdraw (${ORE_WITHDRAW} ORE)`, status: 'skipped' });
  }

  // ═══════════════════════════════════════════════════════════════
  // FINAL REPORT
  // ═══════════════════════════════════════════════════════════════
  console.log('\n\n' + '═'.repeat(60));
  console.log('📊 TEST RESULTS SUMMARY');
  console.log('═'.repeat(60) + '\n');

  const passed = results.filter(r => r.status === 'passed').length;
  const failed = results.filter(r => r.status === 'failed').length;
  const skipped = results.filter(r => r.status === 'skipped').length;

  for (const result of results) {
    const icon = result.status === 'passed' ? '✅' : result.status === 'failed' ? '❌' : '⏭️';
    const time = result.duration ? ` (${(result.duration / 1000).toFixed(1)}s)` : '';
    console.log(`${icon} ${result.name}${time}`);
    if (result.error) {
      console.log(`   └─ Error: ${result.error}`);
    }
    if (result.tx) {
      console.log(`   └─ TX: ${result.tx}`);
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`Total: ${results.length} | ✅ Passed: ${passed} | ❌ Failed: ${failed} | ⏭️ Skipped: ${skipped}`);
  console.log('─'.repeat(60));

  // Final balances
  console.log('\n📊 Final Balances:');
  const finalSolBalance = await connection.getBalance(keypair.publicKey);
  const finalUsdcBalance = await getTokenBalance(connection, keypair.publicKey, USDC_MINT);
  const finalUsdtBalance = await getTokenBalance(connection, keypair.publicKey, USDT_MINT);
  const finalOreBalance = await getTokenBalance(connection, keypair.publicKey, ORE_MINT);

  console.log(`   SOL:  ${(finalSolBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`   USDC: ${(finalUsdcBalance / 1e6).toFixed(2)} USDC`);
  console.log(`   USDT: ${(finalUsdtBalance / 1e6).toFixed(2)} USDT`);
  console.log(`   ORE:  ${(finalOreBalance / 1e11).toFixed(6)} ORE`);

  console.log('\n🔒 Final Shielded Balances:');
  try {
    const shieldedSol = await client.getPrivateBalance();
    console.log(`   SOL:  ${(shieldedSol.lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  } catch {
    console.log(`   SOL:  0 SOL`);
  }
  try {
    const shieldedUsdc = await client.getPrivateBalanceSpl(USDC_MINT);
    console.log(`   USDC: ${(shieldedUsdc.base_units / 1e6).toFixed(2)} USDC`);
  } catch {
    console.log(`   USDC: 0 USDC`);
  }
  try {
    const shieldedUsdt = await client.getPrivateBalanceSpl(USDT_MINT);
    console.log(`   USDT: ${(shieldedUsdt.base_units / 1e6).toFixed(2)} USDT`);
  } catch {
    console.log(`   USDT: 0 USDT`);
  }
  try {
    const shieldedOre = await client.getPrivateBalanceSpl(ORE_MINT);
    console.log(`   ORE:  ${(shieldedOre.base_units / 1e11).toFixed(6)} ORE`);
  } catch {
    console.log(`   ORE:  0 ORE`);
  }

  console.log('\n' + '═'.repeat(60));
  if (failed > 0) {
    console.log('❌ SOME TESTS FAILED');
    process.exit(1);
  } else if (passed > 0) {
    console.log('✅ ALL TESTS PASSED');
  } else {
    console.log('⚠️  ALL TESTS SKIPPED (no funds available)');
  }
  console.log('═'.repeat(60) + '\n');
}

main().catch(err => {
  console.error('\n❌ Fatal Error:', err.message);
  process.exit(1);
});
