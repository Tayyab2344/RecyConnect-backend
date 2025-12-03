import express from 'express';
import { authenticateToken } from '../middlewares/authMiddleware.js';
import {
    getDashboardStats,
    getActivity,
    getTrends
} from '../controllers/reportController.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

/**
 * @swagger
 * tags:
 *   name: Reports
 *   description: User reports and analytics
 */

/**
 * @swagger
 * /api/reports/dashboard:
 *   get:
 *     summary: Get dashboard statistics
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 selling:
 *                   type: object
 *                 buying:
 *                   type: object
 */
router.get('/dashboard', getDashboardStats);

/**
 * @swagger
 * /api/reports/activity:
 *   get:
 *     summary: Get recent activity feed
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Activity feed retrieved successfully
 */
router.get('/activity', getActivity);

/**
 * @swagger
 * /api/reports/trends:
 *   get:
 *     summary: Get trend analysis
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: months
 *         schema:
 *           type: integer
 *           default: 6
 *     responses:
 *       200:
 *         description: Trends retrieved successfully
 */
router.get('/trends', getTrends);

export default router;
