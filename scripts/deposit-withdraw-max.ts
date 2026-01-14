/**
 * Deposit maximum SOL and withdraw it all to recipient
 * Usage: npm run deposit:withdraw:max <recipient_address>
 */

import 'dotenv/config';
import { Keypair, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { PrivacyCash } from '../sdk-reference/src/index.js';

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
  const recipient = process.argv[2] || 'GG2Kkkcef9UZXvnJTKP7Q6QRtS8he3FezKHuQP67Ct2r';
  
  console.log('\n💰 Deposit & Withdraw Maximum SOL\n');
  console.log('='.repeat(60));

  const keypair = getTestKeypair();
  const rpcUrl = process.env.MAINNET_RPC_URL || 'https://api.mainnet-beta.solana.com';
  
  console.log(`📍 Wallet: ${keypair.publicKey.toBase58()}`);
  console.log(`🎯 Recipient: ${recipient}\n`);

  // Check balances
  const connection = new Connection(rpcUrl, 'confirmed');
  const solBalance = await connection.getBalance(keypair.publicKey);
  console.log(`💰 Regular SOL: ${solBalance / LAMPORTS_PER_SOL} SOL`);

  const client = new PrivacyCash({
    RPC_url: rpcUrl,
    owner: getOwnerSecretArray(),
    enableDebug: false,
  });

  let shieldedBalance = 0;
  try {
    const shielded = await client.getPrivateBalance();
    shieldedBalance = shielded.lamports / LAMPORTS_PER_SOL;
    console.log(`🔒 Shielded SOL: ${shieldedBalance} SOL`);
  } catch {
    console.log(`🔒 Shielded SOL: 0 SOL`);
  }

  // Calculate maximum deposit (leave 0.005 SOL for rent + fees)
  // Rent exemption is ~0.002 SOL, plus transaction fees
  const availableForDeposit = (solBalance / LAMPORTS_PER_SOL) - 0.005;
  const maxDeposit = Math.max(0, availableForDeposit);

  if (maxDeposit < 0.001) {
    console.log('\n❌ Not enough SOL to deposit (need at least 0.001 + fees)');
    process.exit(1);
  }

  console.log(`\n📊 Maximum deposit possible: ${maxDeposit.toFixed(6)} SOL`);
  console.log(`   (Leaving 0.005 SOL for rent + transaction fees)\n`);

  // Deposit maximum
  console.log(`1️⃣  Depositing ${maxDeposit.toFixed(6)} SOL...`);
  try {
    const depositResult = await client.deposit({
      lamports: maxDeposit * LAMPORTS_PER_SOL,
    });
    console.log(`   ✅ Deposit TX: ${depositResult.tx}`);
    console.log(`   🔗 Explorer: https://explorer.solana.com/tx/${depositResult.tx}`);

    // Wait for confirmation
    console.log('   ⏳ Waiting for confirmation...');
    await new Promise(r => setTimeout(r, 10000));

    // Check new shielded balance
    const newShielded = await client.getPrivateBalance();
    const newShieldedAmount = newShielded.lamports / LAMPORTS_PER_SOL;
    console.log(`   🔒 New shielded balance: ${newShieldedAmount.toFixed(6)} SOL\n`);

    // Withdraw maximum (try to withdraw all, but in chunks if needed)
    if (newShieldedAmount < 0.001) {
      console.log('❌ Not enough shielded balance to withdraw');
      process.exit(1);
    }

    console.log(`2️⃣  Withdrawing maximum (${newShieldedAmount.toFixed(6)} SOL)...`);
    
    // Try withdrawing in smaller chunks to avoid transaction size limits
    let remaining = newShieldedAmount;
    let totalWithdrawn = 0;
    const chunkSize = 0.01; // Withdraw 0.01 SOL at a time
    
    while (remaining >= 0.001) {
      const withdrawAmount = Math.min(chunkSize, remaining);
      
      try {
        console.log(`   💸 Withdrawing ${withdrawAmount.toFixed(6)} SOL...`);
        const withdrawResult = await client.withdraw({
          lamports: withdrawAmount * LAMPORTS_PER_SOL,
          recipientAddress: recipient,
        });
        
        const received = withdrawResult.amount_in_lamports / LAMPORTS_PER_SOL;
        const fee = withdrawResult.fee_in_lamports / LAMPORTS_PER_SOL;
        
        console.log(`   ✅ TX: ${withdrawResult.tx}`);
        console.log(`   💰 Received: ${received.toFixed(6)} SOL, Fee: ${fee.toFixed(6)} SOL`);
        console.log(`   🔗 Explorer: https://explorer.solana.com/tx/${withdrawResult.tx}`);
        
        totalWithdrawn += received;
        remaining -= (withdrawAmount); // Subtract what we tried to withdraw
        
        // Wait between withdrawals
        await new Promise(r => setTimeout(r, 5000));
        
        // Re-check balance
        const updatedShielded = await client.getPrivateBalance();
        remaining = updatedShielded.lamports / LAMPORTS_PER_SOL;
        
        if (remaining < 0.001) {
          console.log(`   ⚠️  Remaining balance (${remaining.toFixed(6)} SOL) too small to withdraw`);
          break;
        }
      } catch (e: any) {
        console.log(`   ⚠️  Withdrawal failed: ${e.message}`);
        // Try smaller amount
        if (withdrawAmount > 0.005) {
          remaining = withdrawAmount * 0.5; // Try half
          continue;
        } else {
          break;
        }
      }
    }

    console.log(`\n✅ Complete!`);
    console.log(`   📤 Deposited: ${maxDeposit.toFixed(6)} SOL`);
    console.log(`   📥 Withdrawn: ${totalWithdrawn.toFixed(6)} SOL`);
    console.log(`   🎯 To: ${recipient}\n`);

  } catch (e: any) {
    console.log(`\n❌ Error: ${e.message}`);
    process.exit(1);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
