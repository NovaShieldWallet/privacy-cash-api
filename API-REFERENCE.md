# Privacy Cash API Reference

## OpenAPI Specification

The complete API specification is available in `openapi.json` (OpenAPI 3.0 format).

**For iOS developers:**
- Import `openapi.json` into your API client generator (e.g., Swagger Codegen, OpenAPI Generator)
- Or use it directly with tools like Postman, Insomnia, or generate Swift client code

## Base URL

**Production:** `https://api.privatelysend.com`  
**Local:** `http://localhost:3000`

## Authentication

All endpoints (except `/v1/health` and `/v1/tokens`) require authentication via signature:

1. **Message to sign:** `"Privacy Money account sign in"`
2. **Sign with:** User's Solana private key (using Ed25519)
3. **Send as:** Base64-encoded signature in request body

### Example (Swift/Solana)

```swift
import Solana

let message = "Privacy Money account sign in"
let messageData = message.data(using: .utf8)!
let signature = try keypair.sign(message: messageData)
let signatureBase64 = signature.base64EncodedString()
```

## Endpoints

### Health Check
```
GET /v1/health
```

### List Tokens
```
GET /v1/tokens
```

### Get Shielded Balance
```
POST /v1/balance
Body: {
  "publicKey": "user_public_key_base58",
  "signature": "base64_signature",
  "mint": "optional_token_mint" // defaults to SOL
}
```

### Get All Balances
```
POST /v1/balance/all
Body: {
  "publicKey": "user_public_key_base58",
  "signature": "base64_signature"
}
```

### Deposit Flow

**Step 1: Prepare**
```
POST /v1/deposit/prepare
Body: {
  "publicKey": "user_public_key_base58",
  "signature": "base64_signature",
  "amount": 0.01,  // in token units
  "mint": "optional_token_mint"  // defaults to SOL
}

Response: {
  "unsignedTransaction": "base64_encoded_tx",
  "metadata": {
    "amount": 10000000,  // in lamports
    "encryptedOutput1": "hex_string",
    "encryptedOutput2": "hex_string"
  }
}
```

**Step 2: Sign locally (iOS)**
```swift
let txData = Data(base64Encoded: unsignedTransaction)!
let transaction = try VersionedTransaction.from(data: txData)
transaction.sign(keypair: userKeypair)
let signedTx = transaction.serialize().base64EncodedString()
```

**Step 3: Submit**
```
POST /v1/deposit/submit
Body: {
  "signedTransaction": "base64_signed_tx",
  "senderAddress": "user_public_key_base58",
  "encryptedOutput1": "from_prepare_response"
}
```

### Withdraw Flow

**Step 1: Prepare**
```
POST /v1/withdraw/prepare
Body: {
  "publicKey": "user_public_key_base58",
  "signature": "base64_signature",
  "amount": 0.01,  // in token units
  "recipientAddress": "recipient_public_key_base58",
  "mint": "optional_token_mint"  // defaults to SOL
}

Response: {
  "withdrawParams": {
    "proofA": [numbers],
    "proofB": [[numbers]],
    "proofC": [numbers],
    "root": [numbers],
    "publicAmount": [numbers],
    "extDataHash": [numbers],
    "inputNullifier": [[numbers]],
    "outputCommitment": [[numbers]],
    "encryptedOutput1": "hex_string",
    "encryptedOutput2": "hex_string"
  },
  "metadata": {
    "amount": 10000000,  // in lamports
    "fee": 6035000,      // Privacy Cash fee
    "recipient": "recipient_address"
  }
}
```

**Step 2: Submit**
```
POST /v1/withdraw/submit
Body: {
  "withdrawParams": { /* from prepare response */ }
}
```

## Important Notes

1. **Private keys NEVER leave the iOS device** - all signing happens locally
2. **Server handles ZK proof generation** - this is computationally expensive
3. **All transactions are mainnet** - Privacy Cash only works on mainnet
4. **Transaction fees** - Privacy Cash charges ~0.006 SOL per withdrawal
5. **Transaction size limits** - Large withdrawals may need to be split into smaller chunks

## Error Handling

All errors return:
```json
{
  "error": "Error message here"
}
```

Common errors:
- `400` - Invalid request (missing fields, invalid amounts, etc.)
- `500` - Server error (ZK proof generation failed, relayer error, etc.)

## Example Flow

1. User wants to deposit 0.01 SOL
2. iOS app calls `POST /v1/deposit/prepare` with user's public key + signature
3. Server generates unsigned transaction + ZK proof
4. iOS app signs transaction locally (private key stays on device)
5. iOS app calls `POST /v1/deposit/submit` with signed transaction
6. Server relays to Privacy Cash relayer
7. Transaction confirmed on Solana mainnet

## Support

See `openapi.json` for complete API specification with all request/response schemas.
