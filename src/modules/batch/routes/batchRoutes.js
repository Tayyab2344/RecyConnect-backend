import { Router } from 'express';
import { authenticateToken } from '../../../middlewares/authMiddleware.js';
import { batchGetListings, batchGetOrders, batchGetUsers } from '../controllers/batchController.js';

const router = Router();

/**
 * @swagger
 * /api/batch/listings:
 *   post:
 *     summary: Batch fetch marketplace listings
 *     tags: [Batch API]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ids:
 *                 type: array
 *                 items:
 *                   type: integer
 *     responses:
 *       200:
 *         description: Listings fetched successfully
 *       401:
 *         description: Unauthorized
 */
router.post('/listings', authenticateToken, batchGetListings);

/**
 * @swagger
 * /api/batch/orders:
 *   post:
 *     summary: Batch fetch orders by IDs
 *     description: Only returns orders that the authenticated user is involved in directly.
 *     tags: [Batch API]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ids:
 *                 type: array
 *                 items:
 *                   type: integer
 *     responses:
 *       200:
 *         description: Orders fetched successfully
 *       401:
 *         description: Unauthorized
 */
router.post('/orders', authenticateToken, batchGetOrders);

/**
 * @swagger
 * /api/batch/users:
 *   post:
 *     summary: Batch fetch limited user profile data by IDs
 *     tags: [Batch API]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ids:
 *                 type: array
 *                 items:
 *                   type: integer
 *     responses:
 *       200:
 *         description: Profiles fetched successfully
 *       401:
 *         description: Unauthorized
 */
router.post('/users', authenticateToken, batchGetUsers);

export default router;
