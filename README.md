# Nova Privacy Cash API Server

A simple API server for Privacy Cash - enabling private transactions on Solana. **Your private keys never leave your device.**

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/HDB5kQ?referralCode=2CZkeQ&utm_medium=integration&utm_source=template&utm_campaign=generic)

## What is this?

This is a **server** that helps your app (iOS, web, etc.) interact with Privacy Cash. It handles the complex stuff (ZK proofs, transactions) so your app doesn't have to.

**Important:** Your users' private keys stay on their devices. The server never sees them.

## Quick Start

### Option 1: Deploy to Railway (Easiest)

Click the "Deploy on Railway" button above. Railway will:
- Set up the server automatically
- Ask you for your Solana RPC URL
- Deploy in seconds

### Option 2: Run Locally

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment:**
   ```bash
   cp env.example .env
   ```
   
   Then edit `.env` and add your Solana mainnet RPC URL:
   ```
   MAINNET_RPC_URL=https://your-rpc-url-here
   ```
   
   Get a free RPC from:
   - [Helius](https://www.helius.dev/)
   - [QuickNode](https://www.quicknode.com/)

3. **Start the server:**
   ```bash
   npm run dev
   ```

   Server runs on `http://localhost:3000`

4. **Test it:**
   ```bash
   npm run test:health
   ```

## API Endpoints

### Health Check
```
GET /v1/health
```
Check if server is running.

### Get Supported Tokens
```
GET /v1/tokens
```
List all supported tokens (SOL, USDC, USDT, etc.)

### Deposit (Shield Funds)

**Step 1: Prepare**
```
POST /v1/deposit/prepare
Body: {
  "publicKey": "your-wallet-address",
  "signature": "base64-signature",
  "amount": 1.0
}
```

**Step 2: Sign** (on your device with private key)

**Step 3: Submit**
```
POST /v1/deposit/submit
Body: {
  "signedTransaction": "base64-signed-tx",
  "senderAddress": "your-wallet-address",
  "encryptedOutput1": "..."
}
```

### Withdraw (Unshield Funds)

**Step 1: Prepare**
```
POST /v1/withdraw/prepare
Body: {
  "publicKey": "your-wallet-address",
  "signature": "base64-signature",
  "amount": 0.5,
  "recipientAddress": "recipient-address"
}
```

**Step 2: Submit**
```
POST /v1/withdraw/submit
Body: {
  "withdrawParams": {...}
}
```

### Check Balance
```
POST /v1/balance
Body: {
  "publicKey": "your-wallet-address",
  "signature": "base64-signature"
}
```

## Authentication

All endpoints (except `/v1/health` and `/v1/tokens`) require authentication:

1. Sign the message: `"Privacy Money account sign in"`
2. Send the base64-encoded signature in the request body

**Example (JavaScript):**
```javascript
const message = "Privacy Money account sign in";
const signature = await wallet.signMessage(new TextEncoder().encode(message));
const signatureBase64 = Buffer.from(signature).toString('base64');
```

## Deposit Fees

- **Fee:** 1% of deposit amount
- **Minimum fee:** 0.001 SOL
- **Minimum deposit:** 0.02 SOL

Fees are automatically included in the deposit transaction and sent to the admin wallet.

## Supported Tokens

- SOL (native Solana)
- USDC
- USDT
- ZEC
- ORE
- STORE

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `MAINNET_RPC_URL` | Your Solana mainnet RPC endpoint | ✅ Yes |
| `NODE_ENV` | Set to `production` for production | No |

## Security

- ✅ Private keys never touch the server
- ✅ All signing happens on client devices
- ✅ Server only generates unsigned transactions
- ✅ Mainnet-only (most secure)

## API Documentation

Full API specification: `openapi.json` (OpenAPI 3.0 format)

Import into Postman, Insomnia, or generate client code.

## License

MIT
