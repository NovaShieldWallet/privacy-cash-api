import { Router, Request, Response } from 'express';
import { privacyCashService } from '../services/privacy-cash.js';
import { config } from '../config/env.js';
import { logger } from '../middleware/logging.js';

const router = Router();

/**
 * POST /v1/balance
 * Get shielded balance for a user
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { publicKey, signature, mintAddress } = req.body;

    if (!publicKey || !signature) {
      return res.status(400).json({
        error: 'Missing required fields: publicKey, signature',
      });
    }

    const result = await privacyCashService.getBalance({
      publicKey,
      signature,
      mintAddress,
    });

    logger.debug('Balance retrieved');

    res.json({
      success: true,
      balance: result.balance,
      token: result.token,
      decimals: result.decimals,
    });
  } catch (error: any) {
    logger.error('Balance retrieval failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /v1/balance/all
 * Get all shielded balances
 */
router.post('/all', async (req: Request, res: Response) => {
  try {
    const { publicKey, signature } = req.body;

    if (!publicKey || !signature) {
      return res.status(400).json({
        error: 'Missing required fields: publicKey, signature',
      });
    }

    const tokens = config.getAllTokens();
    const balances: Array<{
      token: string;
      mint: string;
      balance: number;
      decimals: number;
    }> = [];

    for (const token of tokens) {
      try {
        const mintAddress = token.name.toLowerCase() === 'sol' ? undefined : token.mint.toBase58();
        const result = await privacyCashService.getBalance({
          publicKey,
          signature,
          mintAddress,
        });

        balances.push({
          token: result.token,
          mint: token.mint.toBase58(),
          balance: result.balance,
          decimals: result.decimals,
        });
      } catch {
        // Skip tokens that fail
      }
    }

    res.json({ success: true, balances });
  } catch (error: any) {
    logger.error('Balance retrieval failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export default router;
