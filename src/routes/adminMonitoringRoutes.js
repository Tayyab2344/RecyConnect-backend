import express from 'express';
import { authenticateToken } from '../middlewares/authMiddleware.js';
import { permit } from '../middlewares/roleMiddleware.js';
import * as monitorCtrl from '../controllers/adminMonitoringController.js';

const router = express.Router();

// All routes require Admin privileges
router.use(authenticateToken, permit('admin'));

/**
 * @swagger
 * /api/admin/monitoring/analytics:
 *   get:
 *     summary: Get comprehensive system health and usage overview
 *     tags: [Admin Monitoring]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: System analytics retrieved successfully
 *       403:
 *         description: Forbidden (Admin only)
 */
router.get('/analytics', monitorCtrl.getAnalyticsSnapshot);

/**
 * @swagger
 * /api/admin/monitoring/errors:
 *   get:
 *     summary: Retrieve recent system crashes and stack traces
 *     tags: [Admin Monitoring]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of recent errors retrieved
 *       403:
 *         description: Forbidden (Admin only)
 */
router.get('/errors', monitorCtrl.getRecentErrors);

/**
 * @swagger
 * /api/admin/monitoring/slow-endpoints:
 *   get:
 *     summary: Retrieve API performance traces exceeding 300ms
 *     tags: [Admin Monitoring]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Slow endpoints records retrieved
 *       403:
 *         description: Forbidden (Admin only)
 */
router.get('/slow-endpoints', monitorCtrl.getSlowEndpoints);

export default router;
