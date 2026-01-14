# Nova Privacy Cash API

Secure HTTPS API wrapper for Privacy Cash SDK. **Private keys never leave the client device.**

## Security Model

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   iOS Client    │────▶│   Nova API      │────▶│  Privacy Cash   │
│                 │     │   Server        │     │    Relayer      │
│ • Holds PK      │     │ • Public key    │     │                 │
│ • Signs locally │     │ • ZK proofs     │     │                 │
│ • Never exposes │     │ • No keys!      │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment config
cp env.example .env

# Start development server
npm run dev

# Run health checks
npm run test:health
```

## API Endpoints

### Health & Info
- `GET /v1/health` - Server health check
- `GET /v1/tokens` - List supported tokens

### Deposits
- `POST /v1/deposit/prepare` - Get unsigned transaction
- `POST /v1/deposit/submit` - Submit signed transaction

### Withdrawals
- `POST /v1/withdraw/prepare` - Generate ZK proof
- `POST /v1/withdraw/submit` - Submit to relayer

### Balance
- `POST /v1/balance` - Get shielded balance
- `POST /v1/balance/all` - Get all token balances

## iOS Client Flow

### 1. Authentication
Sign the message `"Privacy Money account sign in"` with the user's keypair:

```swift
let message = "Privacy Money account sign in".data(using: .utf8)!
let signature = try keypair.sign(message: message)
let signatureBase64 = signature.base64EncodedString()
```

### 2. Deposit Flow
```swift
// Step 1: Prepare deposit
let prepareResponse = await api.post("/v1/deposit/prepare", body: [
    "publicKey": publicKey,
    "signature": signatureBase64,
    "amount": 1.0  // SOL amount
])

// Step 2: Sign transaction locally
let txData = Data(base64Encoded: prepareResponse.unsignedTransaction)!
let transaction = try VersionedTransaction.deserialize(txData)
try transaction.sign(keypair)
let signedTx = transaction.serialize().base64EncodedString()

// Step 3: Submit
let submitResponse = await api.post("/v1/deposit/submit", body: [
    "signedTransaction": signedTx,
    "senderAddress": publicKey,
    "encryptedOutput1": prepareResponse.metadata.encryptedOutput1
])
```

### 3. Withdrawal Flow
```swift
// Step 1: Prepare withdrawal (server generates ZK proof)
let prepareResponse = await api.post("/v1/withdraw/prepare", body: [
    "publicKey": publicKey,
    "signature": signatureBase64,
    "amount": 0.5,  // SOL amount
    "recipientAddress": recipientPublicKey
])

// Step 2: Submit (no client signing needed)
let submitResponse = await api.post("/v1/withdraw/submit", body: [
    "withdrawParams": prepareResponse.withdrawParams
])
```

### 4. Check Balance
```swift
let balanceResponse = await api.post("/v1/balance", body: [
    "publicKey": publicKey,
    "signature": signatureBase64,
    "mintAddress": nil  // nil for SOL, or token mint for SPL
])
// balanceResponse.balance = 1.5 (in token units)
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment (development/production) | development |
| `NETWORK` | Solana network (mainnet/devnet/testnet) | devnet |
| `PORT` | Server port | 3000 |
| `LOG_LEVEL` | Logging level (debug/info/warn/error) | debug (dev), error (prod) |

## Supported Tokens

- SOL (native)
- USDC
- USDT
- ZEC
- ORE
- STORE

## Logging

**Development**: Full debug logging including request details and timing.

**Production**: Minimal logging - errors only, no sensitive data (public keys, amounts, transactions are never logged).

## Testing

```bash
# Health check
npm run test:health

# E2E deposit (requires funded devnet wallet)
TEST_PRIVATE_KEY=<base58_key> npm run test:deposit

# E2E withdraw (requires existing shielded balance)
TEST_PRIVATE_KEY=<base58_key> npm run test:withdraw
```

## Security Notes

1. **Private keys never touch the server** - All signing happens on iOS
2. **Signature-based encryption** - UTXO decryption requires client signature
3. **Production logging** - Sensitive data is never logged
4. **Rate limiting** - ZK proof endpoints have stricter limits

## License

MIT
