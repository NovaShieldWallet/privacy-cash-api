/**
 * Check balances using SDK directly (mainnet)
 * Usage: npm run sdk:balance
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
  console.log('\n📊 Balance Check\n');

  const keypair = getTestKeypair();
  // Use devnet for testing
  const isMainnet = process.env.NODE_ENV === 'production';
  let rpcUrl = process.env.DEVNET_RPC_URL || 'https://api.devnet.solana.com';
  
  if (isMainnet) {
    const mainnetRpc = process.env.MAINNET_RPC_URL;
    if (!mainnetRpc) throw new Error('MAINNET_RPC_URL required for mainnet');
    rpcUrl = mainnetRpc;
  }

  console.log(`Wallet: ${keypair.publicKey.toBase58()}\n`);

  // SOL balance
  const connection = new Connection(rpcUrl, 'confirmed');
  const solBalance = await connection.getBalance(keypair.publicKey);
  console.log(`💰 SOL: ${solBalance / LAMPORTS_PER_SOL} SOL`);

  // Shielded balance (only works on mainnet)
  if (isMainnet) {
    const client = new PrivacyCash({
      RPC_url: rpcUrl,
      // Pass raw secret key bytes so SDK can construct its own Keypair
      owner: getOwnerSecretArray(),
      enableDebug: false,
    });

    try {
      const shielded = await client.getPrivateBalance();
      console.log(`🔒 Shielded SOL: ${shielded.lamports / LAMPORTS_PER_SOL} SOL`);
    } catch (err: any) {
      console.log(`🔒 Shielded SOL: 0 SOL (${err.message})`);
    }
  } else {
    console.log(`🔒 Shielded SOL: N/A (Privacy Cash is mainnet only)`);
  }

  console.log('');
  
  // Force exit to prevent hanging
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
