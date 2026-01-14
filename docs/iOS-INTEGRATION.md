# Nova Privacy Cash - iOS Integration Guide

## Overview

Nova Privacy Cash API provides private transactions on Solana using zero-knowledge proofs. This API wraps the Privacy Cash protocol and adds referral revenue for our platform.

## Supported Tokens

| Token | Mint Address | Decimals |
|-------|--------------|----------|
| SOL | Native | 9 |
| USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | 6 |
| USDT | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` | 6 |
| ORE | `oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp` | 11 |
| ZEC | `A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS` | 8 |
| STORE | `sTorERYB6xAZ1SSbwpK3zoK2EEwbBrc7TZAzg1uCGiH` | 11 |

## Base URL

```
Production: https://your-api-domain.com/v1
```

## Authentication

All endpoints requiring user authentication use a **signature-based auth**:

1. User signs the message: `"Privacy Money account sign in"`
2. Sign with their Solana wallet (ed25519)
3. Send base64-encoded signature in request body

### Swift Example

```swift
import Foundation

let signMessage = "Privacy Money account sign in"

// Sign with wallet (using your Solana SDK)
let signature = wallet.sign(message: signMessage.data(using: .utf8)!)
let signatureBase64 = signature.base64EncodedString()
```

---

## Endpoints

### 1. Health Check

```
GET /v1/health
```

**Response:**
```json
{
  "status": "ok",
  "network": "mainnet"
}
```

---

### 2. Get Configuration

```
GET /v1/config
```

**Response:**
```json
{
  "supportedTokens": ["SOL", "USDC", "USDT", "ORE", "ZEC", "STORE"],
  "fees": {
    "withdrawFeeRate": 0.0035,
    "depositFeeRate": 0,
    "rentFees": {
      "sol": 0.006,
      "usdc": 0.87,
      "usdt": 0.87,
      "ore": 0.0052
    }
  },
  "minimumWithdrawal": {
    "sol": 0.01,
    "usdc": 2,
    "usdt": 2,
    "ore": 0.02
  },
  "prices": {
    "sol": 145.45,
    "usdc": 1.0,
    "ore": 168.08
  }
}
```

---

### 3. Get Token List

```
GET /v1/tokens
```

**Response:**
```json
{
  "tokens": [
    { "name": "SOL", "mint": "So11111111111111111111111111111111111111112", "decimals": 9 },
    { "name": "USDC", "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "decimals": 6 }
  ]
}
```

---

### 4. Get Balance

```
POST /v1/balance
```

**Request Body:**
```json
{
  "publicKey": "UserWalletAddress...",
  "signature": "base64EncodedSignature..."
}
```

**Response:**
```json
{
  "balances": {
    "sol": {
      "raw": 10000000,
      "formatted": "0.01",
      "shielded": {
        "raw": 5000000,
        "formatted": "0.005"
      }
    }
  }
}
```

---

### 5. Deposit (Shield Funds)

Depositing moves funds from public wallet to private/shielded balance.

#### Step 1: Prepare Deposit

```
POST /v1/deposit/prepare
```

**Request Body (SOL):**
```json
{
  "publicKey": "UserWalletAddress...",
  "signature": "base64EncodedSignature...",
  "amount": 0.1
}
```

**Request Body (SPL Token):**
```json
{
  "publicKey": "UserWalletAddress...",
  "signature": "base64EncodedSignature...",
  "amount": 10.0,
  "mintAddress": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
}
```

**Response:**
```json
{
  "success": true,
  "unsignedTransaction": "base64EncodedTransaction...",
  "metadata": {
    "amount": 100000000,
    "encryptedOutput1": "hex...",
    "encryptedOutput2": "hex..."
  }
}
```

#### Step 2: Sign & Submit

User signs the transaction locally, then submit:

```
POST /v1/deposit/submit
```

**Request Body:**
```json
{
  "signedTransaction": "base64EncodedSignedTransaction...",
  "senderAddress": "UserWalletAddress...",
  "encryptedOutput1": "hex...",
  "mintAddress": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
}
```

**Response:**
```json
{
  "success": true,
  "signature": "TransactionSignature..."
}
```

---

### 6. Withdraw (Unshield Funds)

Withdrawing moves funds from private/shielded balance back to a public wallet.

#### Step 1: Prepare Withdraw

```
POST /v1/withdraw/prepare
```

**Request Body:**
```json
{
  "publicKey": "UserWalletAddress...",
  "signature": "base64EncodedSignature...",
  "amount": 0.05,
  "recipientAddress": "RecipientWalletAddress..."
}
```

**Response:**
```json
{
  "success": true,
  "withdrawParams": { ... },
  "metadata": {
    "amount": 50000000,
    "fee": 6000000
  }
}
```

#### Step 2: Submit Withdraw

```
POST /v1/withdraw/submit
```

**Request Body:**
```json
{
  "withdrawParams": { ... }
}
```

**Response:**
```json
{
  "success": true,
  "signature": "TransactionSignature..."
}
```

---

## Fee Structure

### Deposits
- **Fee Rate:** 0% (free deposits)

### Withdrawals
- **Fee Rate:** 0.35% of withdrawal amount
- **Rent Fee:** Fixed fee per token (covers Solana account rent)
  - SOL: ~0.006 SOL (~$0.87)
  - USDC/USDT: ~$0.87
  - ORE: ~0.005 ORE

### Minimum Withdrawals
- SOL: 0.01 SOL
- USDC/USDT: 2 tokens
- ORE: 0.02 ORE

---

## Swift Implementation Example

```swift
import Foundation

class NovaPrivacyCash {
    let baseURL = "https://your-api.com/v1"
    
    struct DepositPrepareResponse: Codable {
        let success: Bool
        let unsignedTransaction: String
        let metadata: Metadata
        
        struct Metadata: Codable {
            let amount: Int
            let encryptedOutput1: String
            let encryptedOutput2: String
        }
    }
    
    func prepareDeposit(
        publicKey: String,
        signature: String,
        amount: Double,
        mintAddress: String? = nil
    ) async throws -> DepositPrepareResponse {
        var body: [String: Any] = [
            "publicKey": publicKey,
            "signature": signature,
            "amount": amount
        ]
        
        if let mint = mintAddress {
            body["mintAddress"] = mint
        }
        
        let url = URL(string: "\(baseURL)/deposit/prepare")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(DepositPrepareResponse.self, from: data)
    }
    
    func submitDeposit(
        signedTransaction: String,
        senderAddress: String,
        encryptedOutput1: String,
        mintAddress: String? = nil
    ) async throws -> Bool {
        var body: [String: Any] = [
            "signedTransaction": signedTransaction,
            "senderAddress": senderAddress,
            "encryptedOutput1": encryptedOutput1
        ]
        
        if let mint = mintAddress {
            body["mintAddress"] = mint
        }
        
        let url = URL(string: "\(baseURL)/deposit/submit")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (data, _) = try await URLSession.shared.data(for: request)
        let response = try JSONDecoder().decode([String: Bool].self, from: data)
        return response["success"] ?? false
    }
}
```

---

## Error Handling

All errors return:
```json
{
  "error": "Error message description"
}
```

Common errors:
- `400` - Missing required fields
- `500` - Server error (check error message)
- `501` - Feature not implemented

---

## Important Notes

1. **Mainnet Only** - Privacy Cash only works on Solana mainnet
2. **Real Funds** - All transactions use real SOL/tokens
3. **ZK Proofs** - Proof generation takes 2-5 seconds
4. **Confirmation** - Transactions take ~5-15 seconds to confirm
5. **Referral** - Our admin wallet automatically earns fees on all transactions

---

## Support

For issues or questions, contact the development team.
