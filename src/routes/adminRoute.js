import express from "express";
import { authenticate } from "../middlewares/authMiddleware.js";
import { permit } from "../middlewares/roleMiddleware.js";
import { getLogs, getLogById } from "../controllers/adminController.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Admin
 *   description: Admin-only endpoints for system monitoring and logs
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     ActivityLog:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: Log entry ID
 *         userId:
 *           type: integer
 *           description: ID of user who performed the action
 *         actorRole:
 *           type: string
 *           description: Role of the user who performed the action
 *           enum: [individual, warehouse, company, collector, admin]
 *         action:
 *           type: string
 *           description: Action performed
 *           example: "LOGIN_SUCCESS"
 *         resourceType:
 *           type: string
 *           description: Type of resource affected (if applicable)
 *         resourceId:
 *           type: string
 *           description: ID of resource affected (if applicable)
 *         meta:
 *           type: object
 *           description: Additional metadata about the action
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: Timestamp of the action
 */

/**
 * @swagger
 * /api/admin/logs:
 *   get:
 *     summary: Get activity logs with filtering and pagination
 *     description: |
 *       Retrieve system activity logs with advanced filtering options.
 *       Only accessible by admin users.
 *       Supports filtering by action, role, user, resource type, date range, and search query.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Search query (searches in meta fields)
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *         description: Filter by action type (e.g., LOGIN_SUCCESS, REGISTER_INDIVIDUAL)
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [individual, warehouse, company, collector, admin]
 *         description: Filter by actor role
 *       - in: query
 *         name: userId
 *         schema:
 *           type: integer
 *         description: Filter by user ID
 *       - in: query
 *         name: resourceType
 *         schema:
 *           type: string
 *         description: Filter by resource type
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter logs from this date (ISO 8601 format)
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter logs until this date (ISO 8601 format)
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *         description: Number of items per page (max 100)
 *     responses:
 *       200:
 *         description: Activity logs retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     items:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/ActivityLog'
 *                     total:
 *                       type: integer
 *                       description: Total number of logs matching the filter
 *                     page:
 *                       type: integer
 *                       description: Current page number
 *                     limit:
 *                       type: integer
 *                       description: Items per page
 *       401:
 *         description: Unauthorized - Invalid or missing token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Forbidden - User is not an admin
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get("/logs", authenticate, permit("admin"), getLogs);

/**
 * @swagger
 * /api/admin/logs/{id}:
 *   get:
 *     summary: Get a specific activity log by ID
 *     description: Retrieve detailed information about a specific activity log entry. Only accessible by admin users.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Activity log ID
 *     responses:
 *       200:
 *         description: Activity log retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/ActivityLog'
 *       401:
 *         description: Unauthorized - Invalid or missing token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Forbidden - User is not an admin
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Log not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               success: false
 *               error:
 *                 message: "Log not found"
 */
router.get("/logs/:id", authenticate, permit("admin"), getLogById);

export default router;
