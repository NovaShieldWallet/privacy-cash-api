# Privacy Cash API - Mainnet Status

## ✅ What's Working

### Configuration
- **Mainnet-only** setup (Privacy Cash doesn't support devnet)
- Hardcoded constants from audited SDK:
  - Program ID: `9fhQBbumKEFuXtMBDw8AaQyAjCorLGJQiS3skWZdQyQD`
  - ALT Address: `HEN49U2ySJ85Vc78qprSW9y6mFDhs1NczRxyppNHjofe`
  - Relayer: `https://api3.privacycash.org`
- Supported tokens: SOL, USDC, USDT, ZEC, ORE, STORE

### Test Wallet
- Test wallet address removed for security
- Use your own test wallet for development

### Verified Working
1. ✅ SDK integration - connects to mainnet Privacy Cash
2. ✅ Balance checking - reads shielded + regular balances
3. ✅ UTXO scanning - found existing shielded funds (0.011 SOL)
4. ✅ Scripts exit properly (no hanging)

## 📝 Available Commands

### Balance & Info
```bash
npm run validate        # Check setup
npm run sdk:balance     # Check SOL + shielded SOL balances
```

### SOL Operations (needs funding)
```bash
npm run sdk:deposit 0.005   # Deposit 0.005 SOL to shield pool
npm run sdk:withdraw 0.002  # Withdraw 0.002 SOL from shield pool
npm run sdk:test            # Full flow: deposit + withdraw
```

### API Server (for iOS)
```bash
npm run dev             # Start API server on port 3000
npm run test:api        # Test all API endpoints
```

## 📊 Current State

### What Just Worked
- Connected to mainnet Privacy Cash
- Scanned merkle tree (187k UTXOs)
- Found existing shielded balance: **0.011 SOL**
- Balance check completes instantly now (cached)

### Next Steps

To run full mainnet tests, the wallet needs:
- **Minimum 0.02 SOL** for deposit+withdraw tests
- Configure your test wallet in `.env` file

Then you can:
1. `npm run sdk:deposit 0.005` - deposit to shield pool
2. `npm run sdk:withdraw 0.002` - withdraw back to wallet
3. `npm run sdk:test` - full automated flow

## 🔐 Security Notes

- Private key **never leaves** the test wallet
- SDK handles all ZK proof generation locally
- Relayer only receives signed transactions
- All operations use audited Privacy Cash contracts

## 📱 iOS Integration Ready

Once SOL testing is complete, the API provides:

### Endpoints
- `POST /v1/balance` - Get shielded balance
- `POST /v1/deposit/prepare` - Get unsigned deposit tx
- `POST /v1/deposit/submit` - Submit signed deposit
- `POST /v1/withdraw/prepare` - Get withdrawal params + proof
- `POST /v1/withdraw/submit` - Submit withdrawal
- `GET /v1/tokens` - List supported tokens

### Flow
1. iOS gets user's public key + signature
2. API generates unsigned tx or ZK proof
3. iOS signs tx locally (private key stays on device)
4. API submits to Privacy Cash relayer

## 🎯 Next: SPL Tokens

Once SOL flow is verified, can add:
- `npm run sdk:deposit:usdc 1` - Shield 1 USDC
- `npm run sdk:withdraw:usdc 0.5` - Unshield 0.5 USDC
- Similar for USDT, ORE, etc.

All using the same mainnet wallet.
