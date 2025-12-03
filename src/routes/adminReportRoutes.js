import express from 'express';
import { authenticateToken } from '../middlewares/authMiddleware.js';
import { permit } from '../middlewares/roleMiddleware.js';
import {
    getSystemOverview,
    getMaterialBreakdown,
    getUserActivity,
    getTimeSeries,
    getLocationAnalytics,
    exportSystemReport
} from '../controllers/adminReportController.js';

const router = express.Router();

// All routes require authentication and admin role
router.use(authenticateToken);
router.use(permit('admin'));

/**
 * @swagger
 * tags:
 *   name: Admin Reports
 *   description: System-wide reporting and analytics for administrators
 */

/**
 * @swagger
 * /api/admin/reports/overview:
 *   get:
 *     summary: Get system-wide overview statistics
 *     tags: [Admin Reports]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: System overview retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 users:
 *                   type: object
 *                 listings:
 *                   type: object
 *                 orders:
 *                   type: object
 *                 recycling:
 *                   type: object
 */
router.get('/overview', getSystemOverview);

/**
 * @swagger
 * /api/admin/reports/materials:
 *   get:
 *     summary: Get material-wise breakdown
 *     tags: [Admin Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Material breakdown retrieved successfully
 */
router.get('/materials', getMaterialBreakdown);

/**
 * @swagger
 * /api/admin/reports/user-activity:
 *   get:
 *     summary: Get user activity statistics (top sellers and buyers)
 *     tags: [Admin Reports]
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
 *         description: User activity retrieved successfully
 */
router.get('/user-activity', getUserActivity);

/**
 * @swagger
 * /api/admin/reports/timeseries:
 *   get:
 *     summary: Get time-series data for charts
 *     tags: [Admin Reports]
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
 *         description: Time series data retrieved successfully
 */
router.get('/timeseries', getTimeSeries);

/**
 * @swagger
 * /api/admin/reports/locations:
 *   get:
 *     summary: Get location-based analytics
 *     tags: [Admin Reports]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Location analytics retrieved successfully
 */
router.get('/locations', getLocationAnalytics);

/**
 * @swagger
 * /api/admin/reports/export:
 *   get:
 *     summary: Export system-wide report as CSV
 *     tags: [Admin Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [listings, orders]
 *           default: listings
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: CSV file download
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 */
router.get('/export', exportSystemReport);

export default router;
