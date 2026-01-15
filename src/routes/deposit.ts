import { Router, Request, Response } from 'express';
import { privacyCashService } from '../services/privacy-cash.js';
import { logger } from '../middleware/logging.js';
import { config } from '../config/env.js';

const router = Router();

/**
 * POST /v1/deposit/prepare
 * Prepare an unsigned deposit transaction
 */
router.post('/prepare', async (req: Request, res: Response) => {
  try {
    const { publicKey, signature, amount, mintAddress, referrer } = req.body;

    if (!publicKey || !signature || !amount) {
      return res.status(400).json({
        error: 'Missing required fields: publicKey, signature, amount',
      });
    }

    if (amount <= 0) {
      return res.status(400).json({ error: 'Amount must be positive' });
    }

    // Use admin referral wallet by default to earn fees
    const effectiveReferrer = referrer || config.adminReferralWallet;
    
    let result;

    if (mintAddress) {
      result = await privacyCashService.prepareSplDeposit({
        publicKey,
        signature,
        mintAddress,
        amount,
        referrer: effectiveReferrer,
      });
    } else {
      const lamports = Math.floor(amount * 1e9);
      result = await privacyCashService.prepareDeposit({
        publicKey,
        signature,
        lamports,
        referrer: effectiveReferrer,
      });
    }

    // Handle both SOL (with fees) and SPL deposits
    const metadata = result.metadata as any;
    const hasFee = 'fee' in metadata;
    
    logger.debug('Deposit prepared', { 
      amount: metadata.amount,
      fee: hasFee ? metadata.fee : 0,
      amountAfterFee: hasFee ? metadata.amountAfterFee : metadata.amount
    });

    const responseMetadata: any = {
      amount: metadata.amount,
      encryptedOutput1: metadata.encryptedOutput1,
      encryptedOutput2: metadata.encryptedOutput2,
    };

    if (hasFee) {
      responseMetadata.fee = metadata.fee;
      responseMetadata.feeRate = metadata.feeRate;
      responseMetadata.amountAfterFee = metadata.amountAfterFee;
    }

    res.json({
      success: true,
      unsignedTransaction: result.unsignedTransaction,
      metadata: responseMetadata,
    });
  } catch (error: any) {
    logger.error('Deposit prepare failed', { 
      error: error.message, 
      stack: error.stack,
      requestBody: { publicKey: req.body.publicKey, amount: req.body.amount, mintAddress: req.body.mintAddress }
    });
    res.status(500).json({ error: error.message || 'Unknown error' });
  }
});

/**
 * POST /v1/deposit/submit
 * Submit a signed deposit transaction
 */
router.post('/submit', async (req: Request, res: Response) => {
  try {
    const { signedTransaction, senderAddress, encryptedOutput1, referrer, mintAddress } = req.body;

    if (!signedTransaction || !senderAddress || !encryptedOutput1) {
      return res.status(400).json({
        error: 'Missing required fields: signedTransaction, senderAddress, encryptedOutput1',
      });
    }

    // Use admin referral wallet by default to earn fees
    const effectiveReferrer = referrer || config.adminReferralWallet;

    const result = await privacyCashService.submitDeposit({
      signedTransaction,
      senderAddress,
      encryptedOutput1,
      referrer: effectiveReferrer,
      mintAddress,
    });

    logger.debug('Deposit submitted');

    res.json({
      success: result.success,
      signature: result.signature,
    });
  } catch (error: any) {
    logger.error('Deposit submit failed', { 
      error: error.message,
      stack: error.stack,
      requestBody: { senderAddress: req.body.senderAddress, mintAddress: req.body.mintAddress }
    });
    res.status(500).json({ error: error.message });
  }
});

export default router;
