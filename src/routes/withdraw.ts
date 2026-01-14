import { Router, Request, Response } from 'express';
import { privacyCashService } from '../services/privacy-cash.js';
import { logger } from '../middleware/logging.js';
import { config } from '../config/env.js';

const router = Router();

/**
 * POST /v1/withdraw/prepare
 * Prepare a withdrawal (generates ZK proof server-side)
 */
router.post('/prepare', async (req: Request, res: Response) => {
  try {
    const { publicKey, signature, amount, recipientAddress, mintAddress, referrer } = req.body;

    if (!publicKey || !signature || !amount || !recipientAddress) {
      return res.status(400).json({
        error: 'Missing required fields: publicKey, signature, amount, recipientAddress',
      });
    }

    if (amount <= 0) {
      return res.status(400).json({ error: 'Amount must be positive' });
    }

    // Use admin referral wallet by default to earn fees
    const effectiveReferrer = referrer || config.adminReferralWallet;
    
    let result;

    if (mintAddress) {
      return res.status(501).json({
        error: 'SPL withdrawal not yet implemented',
      });
    } else {
      const lamports = Math.floor(amount * 1e9);
      result = await privacyCashService.prepareWithdraw({
        publicKey,
        signature,
        lamports,
        recipientAddress,
        referrer: effectiveReferrer,
      });
    }

    logger.debug('Withdrawal prepared');

    res.json({
      success: true,
      withdrawParams: result.withdrawParams,
      metadata: result.metadata,
    });
  } catch (error: any) {
    logger.error('Withdraw prepare failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /v1/withdraw/submit
 * Submit a withdrawal to the relayer
 */
router.post('/submit', async (req: Request, res: Response) => {
  try {
    const { withdrawParams, mintAddress } = req.body;

    if (!withdrawParams) {
      return res.status(400).json({
        error: 'Missing required field: withdrawParams',
      });
    }

    const encryptedOutput1 = withdrawParams.encryptedOutput1;
    const tokenName = mintAddress
      ? config.getTokenByMint(mintAddress)?.name.toLowerCase()
      : undefined;

    const result = await privacyCashService.submitWithdraw({
      withdrawParams,
      encryptedOutput1,
      tokenName,
    });

    logger.debug('Withdrawal submitted');

    res.json({
      success: result.success,
      signature: result.signature,
    });
  } catch (error: any) {
    logger.error('Withdraw submit failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export default router;
