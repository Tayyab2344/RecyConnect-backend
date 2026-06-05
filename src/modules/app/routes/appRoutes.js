import express from 'express';
import { authenticateToken } from '../../../middlewares/authMiddleware.js';
import { cacheResponse } from '../../../middlewares/cacheMiddleware.js';
import { syncAppInit, getPublicRates } from '../controllers/appController.js';
import { chatWithEcoAssist } from '../controllers/ecoAssistController.js';

const router = express.Router();

/**
 * @swagger
 * /api/app/bootstrap:
 *   get:
 *     summary: Get initial payload for app load
 *     description: Combines user profile, statistics, and notifications in one payload to reduce API latency.
 *     tags: [App]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Initial payload retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get('/bootstrap', authenticateToken, cacheResponse(30), syncAppInit);

/**
 * @swagger
 * /api/app/rates:
 *   get:
 *     summary: Get public material rates
 *     tags: [App]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Rates retrieved successfully
 */
router.get('/rates', authenticateToken, cacheResponse(300), getPublicRates);

/**
 * @swagger
 * /api/app/eco-assist/chat:
 *   post:
 *     summary: AI-powered RecyConnect eco companion
 *     tags: [App]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               message:
 *                 type: string
 *               location:
 *                 type: object
 *     responses:
 *       200:
 *         description: Responded successfully with chat response and navigation intent
 */
router.post('/eco-assist/chat', authenticateToken, chatWithEcoAssist);

export default router;

