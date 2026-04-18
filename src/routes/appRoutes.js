import express from 'express';
import { authenticateToken } from '../middlewares/authMiddleware.js';
import { syncAppInit } from '../controllers/appController.js';

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
router.get('/bootstrap', authenticateToken, syncAppInit);

export default router;
