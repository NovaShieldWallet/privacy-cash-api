import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config/env.js';
import { requestLogger, errorLogger, logger } from './middleware/logging.js';
import depositRoutes from './routes/deposit.js';
import withdrawRoutes from './routes/withdraw.js';
import balanceRoutes from './routes/balance.js';

const app = express();

// Security middleware
app.use(helmet());
app.use(cors());

// Body parsing
app.use(express.json({ limit: '1mb' }));

// Request logging (only in debug)
app.use(requestLogger);

// Health check
app.get('/v1/health', (_req, res) => {
  res.json({
    status: 'ok',
    network: config.network,
  });
});

// API routes
app.use('/v1/deposit', depositRoutes);
app.use('/v1/withdraw', withdrawRoutes);
app.use('/v1/balance', balanceRoutes);

// Token list
app.get('/v1/tokens', (_req, res) => {
  res.json({
    tokens: config.getAllTokens().map(t => ({
      name: t.name,
      mint: t.mint.toBase58(),
      decimals: t.decimals,
    })),
  });
});

// Config endpoint (fetches from Privacy Cash relayer)
app.get('/v1/config', async (_req, res) => {
  try {
    const relayerConfig = await fetch(`${config.relayerUrl}/config`);
    const data = await relayerConfig.json() as any;
    
    res.json({
      supportedTokens: ['SOL', 'USDC', 'USDT', 'ORE', 'ZEC', 'STORE'],
      fees: {
        withdrawFeeRate: data.withdraw_fee_rate,
        depositFeeRate: data.deposit_fee_rate,
        rentFees: data.rent_fees,
      },
      minimumWithdrawal: data.minimum_withdrawal,
      prices: data.prices,
      referralWallet: config.adminReferralWallet,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Error handling
app.use(errorLogger);
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({
    error: config.isProduction ? 'Internal server error' : err.message,
  });
});

// 404
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(config.port, config.host, () => {
  logger.info(`Server started on port ${config.port}`, { network: config.network });
});

export default app;
