/**
 * Transfer maximum SOL to recipient using deployed API
 * Usage: npm run transfer:max <recipient_address>
 */

import 'dotenv/config';
import { Keypair, VersionedTransaction, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import nacl from 'tweetnacl';

const API_URL = process.env.API_URL || 'https://api.privatelysend.com';
const SIGN_MESSAGE = 'Privacy Money account sign in';

function getTestKeypair(): Keypair {
  const pk = process.env.TEST_PRIVATE_KEY;
  if (!pk) throw new Error('TEST_PRIVATE_KEY not set');
  const keyArray = JSON.parse(pk);
  return Keypair.fromSecretKey(Uint8Array.from(keyArray));
}

async function main() {
  const recipient = process.argv[2];
  if (!recipient) {
    console.error('❌ Please provide recipient address');
    console.log('Usage: npm run transfer:max <recipient_address>');
    process.exit(1);
  }

  console.log('\n💰 Transfer Maximum SOL via Privacy Cash API\n');
  console.log('='.repeat(60));

  const keypair = getTestKeypair();
  console.log(`📍 Wallet: ${keypair.publicKey.toBase58()}`);
  console.log(`🎯 Recipient: ${recipient}`);
  console.log(`🌐 API: ${API_URL}\n`);

  // Check SOL balance
  const connection = new Connection(process.env.MAINNET_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');
  const solBalance = await connection.getBalance(keypair.publicKey);
  console.log(`💰 Regular SOL: ${solBalance / LAMPORTS_PER_SOL} SOL`);

  // Sign auth message
  const signature = nacl.sign.detached(Buffer.from(SIGN_MESSAGE), keypair.secretKey);
  const signatureBase64 = Buffer.from(signature).toString('base64');

  // Check shielded balance
  console.log('\n1️⃣  Checking shielded balance...');
  let shieldedBalance = 0;
  try {
    const balanceRes = await fetch(`${API_URL}/v1/balance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: keypair.publicKey.toBase58(),
        signature: signatureBase64,
      }),
    });

    if (balanceRes.ok) {
      const balanceData = await balanceRes.json();
      shieldedBalance = parseFloat(balanceData.balance) || 0;
      console.log(`   🔒 Shielded SOL: ${shieldedBalance} SOL`);
    } else {
      const err = await balanceRes.json();
      console.log(`   🔒 Shielded SOL: 0 SOL (${err.error})`);
    }
  } catch (e: any) {
    console.log(`   ❌ Error checking balance: ${e.message}`);
    process.exit(1);
  }

  // Withdraw existing balance first, then try to deposit more
  if (shieldedBalance >= 0.001) {
    console.log(`\n2️⃣  Withdrawing existing ${shieldedBalance.toFixed(6)} SOL first...`);
    try {
      const withdrawPrepareRes = await fetch(`${API_URL}/v1/withdraw/prepare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicKey: keypair.publicKey.toBase58(),
          signature: signatureBase64,
          amount: shieldedBalance,
          recipientAddress: recipient,
        }),
      });

      if (withdrawPrepareRes.ok) {
        const withdrawData = await withdrawPrepareRes.json();
        const withdrawSubmitRes = await fetch(`${API_URL}/v1/withdraw/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            withdrawParams: withdrawData.withdrawParams,
          }),
        });

        if (withdrawSubmitRes.ok) {
          const result = await withdrawSubmitRes.json();
          console.log(`   ✅ Withdrew ${shieldedBalance.toFixed(6)} SOL`);
          console.log(`   📝 TX: ${result.signature}`);
          shieldedBalance = 0; // Reset for deposit
        }
      }
    } catch (e: any) {
      console.log(`   ⚠️  Could not withdraw existing balance: ${e.message}`);
    }
  }

  // Try to deposit more if we have regular SOL
  if (shieldedBalance < 0.01 && solBalance > 0.02 * LAMPORTS_PER_SOL) {
    console.log('\n2️⃣  Depositing maximum available SOL...');
    
    // Deposit in smaller chunks to avoid circuit errors
    // Try 0.02 SOL at a time (leave ~0.01 for fees)
    const availableForDeposit = (solBalance / LAMPORTS_PER_SOL) - 0.01;
    const depositAmount = Math.min(0.02, Math.max(0.001, availableForDeposit));
    if (depositAmount < 0.001) {
      console.log('   ❌ Not enough SOL to deposit (need at least 0.001 + fees)');
      process.exit(1);
    }

    console.log(`   💸 Depositing ${depositAmount.toFixed(6)} SOL...`);

    try {
      // Prepare deposit
      const prepareRes = await fetch(`${API_URL}/v1/deposit/prepare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicKey: keypair.publicKey.toBase58(),
          signature: signatureBase64,
          amount: depositAmount,
        }),
      });

      if (!prepareRes.ok) {
        const err = await prepareRes.json();
        throw new Error(err.error || 'Failed to prepare deposit');
      }

      const prepareData = await prepareRes.json();
      console.log('   ✅ Deposit prepared');

      // Sign transaction
      const txBuffer = Buffer.from(prepareData.unsignedTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(txBuffer);
      transaction.sign([keypair]);
      const signedTx = Buffer.from(transaction.serialize()).toString('base64');

      // Submit deposit
      const submitRes = await fetch(`${API_URL}/v1/deposit/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signedTransaction: signedTx,
          senderAddress: keypair.publicKey.toBase58(),
          encryptedOutput1: prepareData.metadata.encryptedOutput1,
        }),
      });

      if (!submitRes.ok) {
        const err = await submitRes.json();
        throw new Error(err.error || 'Failed to submit deposit');
      }

      const submitData = await submitRes.json();
      console.log(`   ✅ Deposit submitted: ${submitData.signature}`);
      console.log(`   📝 Explorer: https://explorer.solana.com/tx/${submitData.signature}`);

      // Wait for confirmation
      console.log('   ⏳ Waiting for confirmation...');
      await new Promise(r => setTimeout(r, 10000));

      // Re-check balance
      const newBalanceRes = await fetch(`${API_URL}/v1/balance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicKey: keypair.publicKey.toBase58(),
          signature: signatureBase64,
        }),
      });

      if (newBalanceRes.ok) {
        const newBalanceData = await newBalanceRes.json();
        shieldedBalance = parseFloat(newBalanceData.balance) || 0;
        console.log(`   🔒 New shielded balance: ${shieldedBalance} SOL`);
      }
    } catch (e: any) {
      console.log(`   ❌ Deposit failed: ${e.message}`);
      process.exit(1);
    }
  }

  // Withdraw maximum amount
  if (shieldedBalance < 0.001) {
    console.log('\n❌ Not enough shielded balance to withdraw');
    process.exit(1);
  }

  console.log(`\n3️⃣  Withdrawing maximum amount (${shieldedBalance.toFixed(6)} SOL)...`);

  try {
    // Withdraw everything we can (the API will calculate fees and adjust)
    // Try withdrawing the full amount, API will handle fee calculation
    const withdrawAmount = shieldedBalance;
    
    const withdrawPrepareRes = await fetch(`${API_URL}/v1/withdraw/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: keypair.publicKey.toBase58(),
        signature: signatureBase64,
        amount: withdrawAmount,
        recipientAddress: recipient,
      }),
    });

    if (!withdrawPrepareRes.ok) {
      const err = await withdrawPrepareRes.json();
      throw new Error(err.error || 'Failed to prepare withdrawal');
    }

    const withdrawData = await withdrawPrepareRes.json();
    console.log(`   ✅ Withdrawal prepared`);
    console.log(`   💸 Amount: ${withdrawData.metadata.amount / LAMPORTS_PER_SOL} SOL`);
    console.log(`   💰 Fee: ${withdrawData.metadata.fee / LAMPORTS_PER_SOL} SOL`);

    // Submit withdrawal
    const withdrawSubmitRes = await fetch(`${API_URL}/v1/withdraw/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        withdrawParams: withdrawData.withdrawParams,
      }),
    });

    if (!withdrawSubmitRes.ok) {
      const err = await withdrawSubmitRes.json();
      throw new Error(err.error || 'Failed to submit withdrawal');
    }

    const withdrawSubmitData = await withdrawSubmitRes.json();
    console.log(`\n✅ Withdrawal successful!`);
    console.log(`   📝 TX: ${withdrawSubmitData.signature}`);
    console.log(`   🔗 Explorer: https://explorer.solana.com/tx/${withdrawSubmitData.signature}`);
    console.log(`   💸 Sent to: ${recipient}`);
    console.log(`   💰 Amount: ${withdrawData.metadata.amount / LAMPORTS_PER_SOL} SOL`);
    console.log(`   💸 Fee: ${withdrawData.metadata.fee / LAMPORTS_PER_SOL} SOL\n`);

  } catch (e: any) {
    console.log(`\n❌ Withdrawal failed: ${e.message}`);
    process.exit(1);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
