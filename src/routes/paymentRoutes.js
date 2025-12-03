import express from 'express';
import { createPaymentIntent, handleWebhook, getPaymentStatus } from '../controllers/paymentController.js';
import { authenticateToken } from '../middlewares/authMiddleware.js';

import express from 'express';
import { createPaymentIntent, handleWebhook, getPaymentStatus } from '../controllers/paymentController.js';
import { authenticateToken } from '../middlewares/authMiddleware.js';

const router = express.Router();

// Create payment intent
router.post('/create-payment-intent', authenticateToken, createPaymentIntent);

// Stripe webhook (no auth middleware - Stripe handles it)
router.post('/webhook', express.raw({ type: 'application/json' }), handleWebhook);

// Get payment status
router.get('/status/:paymentIntentId', authenticateToken, getPaymentStatus);

export default router;
