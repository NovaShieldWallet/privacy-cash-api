/**
 * SOL + ORE Focused Test
 * Tests deposit and withdraw for SOL and ORE only
 * 
 * Usage: npm run test:sol-ore
 */

import 'dotenv/config';
import { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, getAccount } from '@solana/spl-token';
import { PrivacyCash } from '../sdk-reference/src/index.js';

const ORE_MINT = new PublicKey('oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp');

function getOwnerSecretArray(): number[] {
  const pk = process.env.TEST_PRIVATE_KEY;
  if (!pk) throw new Error('TEST_PRIVATE_KEY not set in .env');
  return JSON.parse(pk);
}

function getTestKeypair(): Keypair {
  const keyArray = getOwnerSecretArray();
  return Keypair.fromSecretKey(Uint8Array.from(keyArray));
}

async function getOreBalance(connection: Connection, wallet: PublicKey): Promise<number> {
  try {
    const ata = getAssociatedTokenAddressSync(ORE_MINT, wallet);
    const account = await getAccount(connection, ata);
    return Number(account.amount) / 1e11;
  } catch {
    return 0;
  }
}

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('🧪 SOL + ORE FOCUSED TEST');
  console.log('═'.repeat(60) + '\n');

  const keypair = getTestKeypair();
  const isMainnet = process.env.NODE_ENV === 'production';
  
  if (!isMainnet) {
    console.log('❌ Requires NODE_ENV=production');
    process.exit(1);
  }

  const rpcUrl = process.env.MAINNET_RPC_URL;
  if (!rpcUrl) throw new Error('MAINNET_RPC_URL not set');

  const connection = new Connection(rpcUrl, 'confirmed');
  console.log(`📍 Wallet: ${keypair.publicKey.toBase58()}\n`);

  // Fetch config
  console.log('📋 Fetching relayer config...');
  const configRes = await fetch('https://api3.privacycash.org/config');
  const config = await configRes.json();
  
  console.log('\n💸 Withdrawal Requirements:');
  console.log(`   SOL: min ${config.minimum_withdrawal.sol} SOL, rent fee ${config.rent_fees.sol} SOL`);
  console.log(`   ORE: min ${config.minimum_withdrawal.ore} ORE, rent fee ${config.rent_fees.ore.toFixed(6)} ORE`);

  // Calculate actual minimums needed
  const solMinNeeded = config.minimum_withdrawal.sol + config.rent_fees.sol + 
    (config.minimum_withdrawal.sol * config.withdraw_fee_rate);
  const oreMinNeeded = config.minimum_withdrawal.ore + config.rent_fees.ore + 
    (config.minimum_withdrawal.ore * config.withdraw_fee_rate);

  console.log(`\n📊 Minimum shielded balance needed for withdraw:`);
  console.log(`   SOL: ~${solMinNeeded.toFixed(4)} SOL`);
  console.log(`   ORE: ~${oreMinNeeded.toFixed(6)} ORE`);

  // Check balances
  console.log('\n📊 Current Wallet Balances:');
  const solBalance = await connection.getBalance(keypair.publicKey);
  const oreBalance = await getOreBalance(connection, keypair.publicKey);
  console.log(`   SOL: ${(solBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`   ORE: ${oreBalance.toFixed(6)} ORE`);

  // Initialize client
  const client = new PrivacyCash({
    RPC_url: rpcUrl,
    owner: getOwnerSecretArray(),
    enableDebug: true,
  });

  // Check shielded balances
  console.log('\n🔒 Shielded Balances:');
  let shieldedSol = 0;
  let shieldedOre = 0;
  
  try {
    const s = await client.getPrivateBalance();
    shieldedSol = s.lamports / LAMPORTS_PER_SOL;
    console.log(`   SOL: ${shieldedSol.toFixed(4)} SOL ${shieldedSol >= solMinNeeded ? '✅ can withdraw' : `❌ need ${(solMinNeeded - shieldedSol).toFixed(4)} more`}`);
  } catch {
    console.log(`   SOL: 0 SOL ❌ need ${solMinNeeded.toFixed(4)} to withdraw`);
  }
  
  try {
    const o = await client.getPrivateBalanceSpl(ORE_MINT);
    shieldedOre = o.base_units / 1e11;
    console.log(`   ORE: ${shieldedOre.toFixed(6)} ORE ${shieldedOre >= oreMinNeeded ? '✅ can withdraw' : `❌ need ${(oreMinNeeded - shieldedOre).toFixed(6)} more`}`);
  } catch {
    console.log(`   ORE: 0 ORE ❌ need ${oreMinNeeded.toFixed(6)} to withdraw`);
  }

  // Test SOL
  console.log('\n' + '─'.repeat(60));
  console.log('🧪 SOL Tests');
  console.log('─'.repeat(60));

  // SOL Deposit
  const solDepositAmount = 0.02;
  if (solBalance / LAMPORTS_PER_SOL >= solDepositAmount + 0.005) {
    console.log(`\n💰 Depositing ${solDepositAmount} SOL...`);
    try {
      const result = await client.deposit({ lamports: solDepositAmount * LAMPORTS_PER_SOL });
      console.log(`✅ SOL Deposit TX: ${result.tx}`);
      
      // Update shielded balance
      await new Promise(r => setTimeout(r, 3000));
      const updated = await client.getPrivateBalance();
      shieldedSol = updated.lamports / LAMPORTS_PER_SOL;
      console.log(`   New shielded: ${shieldedSol.toFixed(4)} SOL`);
    } catch (e: any) {
      console.log(`❌ SOL Deposit failed: ${e.message}`);
    }
  } else {
    console.log(`\n⏭️  Skipping SOL deposit (need ${solDepositAmount + 0.005} SOL, have ${(solBalance / LAMPORTS_PER_SOL).toFixed(4)})`);
  }

  // SOL Withdraw
  if (shieldedSol >= solMinNeeded) {
    const withdrawAmount = Math.floor((shieldedSol - config.rent_fees.sol) * 0.8 * 1000) / 1000;
    console.log(`\n💸 Withdrawing ${withdrawAmount} SOL...`);
    try {
      const result = await client.withdraw({
        lamports: withdrawAmount * LAMPORTS_PER_SOL,
        recipientAddress: keypair.publicKey.toBase58(),
      });
      console.log(`✅ SOL Withdraw TX: ${result.tx}`);
      console.log(`   Received: ${result.amount_in_lamports / LAMPORTS_PER_SOL} SOL (fee: ${result.fee_in_lamports / LAMPORTS_PER_SOL} SOL)`);
    } catch (e: any) {
      console.log(`❌ SOL Withdraw failed: ${e.message}`);
    }
  } else {
    console.log(`\n⏭️  Skipping SOL withdraw (shielded: ${shieldedSol.toFixed(4)}, need: ${solMinNeeded.toFixed(4)})`);
  }

  // Test ORE
  console.log('\n' + '─'.repeat(60));
  console.log('🧪 ORE Tests');
  console.log('─'.repeat(60));

  // ORE Deposit
  const oreDepositAmount = 0.02;
  if (oreBalance >= oreDepositAmount) {
    console.log(`\n💰 Depositing ${oreDepositAmount} ORE...`);
    try {
      const result = await client.depositSPL({
        mintAddress: ORE_MINT,
        amount: oreDepositAmount,
      });
      console.log(`✅ ORE Deposit TX: ${result.tx}`);
      
      // Update shielded balance
      await new Promise(r => setTimeout(r, 3000));
      const updated = await client.getPrivateBalanceSpl(ORE_MINT);
      shieldedOre = updated.base_units / 1e11;
      console.log(`   New shielded: ${shieldedOre.toFixed(6)} ORE`);
    } catch (e: any) {
      console.log(`❌ ORE Deposit failed: ${e.message}`);
    }
  } else {
    console.log(`\n⏭️  Skipping ORE deposit (need ${oreDepositAmount} ORE, have ${oreBalance.toFixed(6)})`);
  }

  // ORE Withdraw  
  if (shieldedOre >= oreMinNeeded) {
    const withdrawAmount = Math.floor((shieldedOre - config.rent_fees.ore) * 0.8 * 10000) / 10000;
    console.log(`\n💸 Withdrawing ${withdrawAmount} ORE...`);
    try {
      const result = await client.withdrawSPL({
        mintAddress: ORE_MINT,
        amount: withdrawAmount,
        recipientAddress: keypair.publicKey.toBase58(),
      });
      console.log(`✅ ORE Withdraw TX: ${result.tx}`);
    } catch (e: any) {
      console.log(`❌ ORE Withdraw failed: ${e.message}`);
    }
  } else {
    console.log(`\n⏭️  Skipping ORE withdraw (shielded: ${shieldedOre.toFixed(6)}, need: ${oreMinNeeded.toFixed(6)})`);
  }

  // Final balances
  console.log('\n' + '─'.repeat(60));
  console.log('📊 Final Balances');
  console.log('─'.repeat(60));
  
  const finalSol = await connection.getBalance(keypair.publicKey);
  const finalOre = await getOreBalance(connection, keypair.publicKey);
  console.log(`\nWallet:`);
  console.log(`   SOL: ${(finalSol / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`   ORE: ${finalOre.toFixed(6)} ORE`);

  try {
    const s = await client.getPrivateBalance();
    console.log(`\nShielded:`);
    console.log(`   SOL: ${(s.lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  } catch {
    console.log(`\nShielded SOL: 0 SOL`);
  }
  try {
    const o = await client.getPrivateBalanceSpl(ORE_MINT);
    console.log(`   ORE: ${(o.base_units / 1e11).toFixed(6)} ORE`);
  } catch {
    console.log(`   ORE: 0 ORE`);
  }

  console.log('\n' + '═'.repeat(60) + '\n');
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
