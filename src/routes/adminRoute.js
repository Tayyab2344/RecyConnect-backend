import express from "express";
import { authenticateToken } from "../middlewares/authMiddleware.js";
import { permit } from "../middlewares/roleMiddleware.js";
import {
  getLogById,
  getPendingKYCUsers,
  approveKYC,
  rejectKYC,
  getSystemLogs,
  getUsers,
  getAdminOrders,
  getAdminPayments,
  getAdminListings,
  getRates,
  suspendUser,
  updateRates,
  deleteRate,
  getDashboardStats
} from "../controllers/adminController.js";

const router = express.Router();

/**
 * @swagger
 * /api/admin/logs:
 *   get:
 *     summary: Get system activity logs
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: System logs retrieved successfully
 */
router.get("/logs", authenticateToken, permit("admin"), getSystemLogs);

/**
 * @swagger
 * /api/admin/logs/{id}:
 *   get:
 *     summary: Get a specific log entry by ID
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Log details retrieved
 */
router.get("/logs/:id", authenticateToken, permit("admin"), getLogById);

// User Management

/**
 * @swagger
 * /api/admin/users:
 *   get:
 *     summary: Get all users
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [INDIVIDUAL, WAREHOUSE, COMPANY, COLLECTOR]
 *         description: Filter users by role
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by name or email
 *     responses:
 *       200:
 *         description: List of users
 *       403:
 *         description: Forbidden
 */
router.get("/users", authenticateToken, permit("admin"), getUsers);

router.get("/orders", authenticateToken, permit("admin"), getAdminOrders);

router.get("/payments", authenticateToken, permit("admin"), getAdminPayments);

router.get("/listings", authenticateToken, permit("admin"), getAdminListings);

router.get("/rates", authenticateToken, permit("admin"), getRates);

/**
 * @swagger
 * /api/admin/users/{id}/suspend:
 *   put:
 *     summary: Suspend or Activate a user
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               suspended:
 *                 type: boolean
 *                 description: Set true to suspend, false to activate
 *     responses:
 *       200:
 *         description: User status updated successfully
 *       404:
 *         description: User not found
 */
router.put("/users/:id/suspend", authenticateToken, permit("admin"), suspendUser);

/**
 * @swagger
 * /api/admin/rates:
 *   post:
 *     summary: Add or update recycling rates (Admin only)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               category:
 *                 type: string
 *               pricePerUnit:
 *                 type: number
 *               unit:
 *                 type: string
 *     responses:
 *       200:
 *         description: Rates updated
 */
router.post("/rates", authenticateToken, permit("admin"), updateRates);

/**
 * @swagger
 * /api/admin/rates/{category}:
 *   delete:
 *     summary: Delete a rate category
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: category
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Rate deleted successfully
 *       404:
 *         description: Rate not found
 */
router.delete("/rates/:category", authenticateToken, permit("admin"), deleteRate);

/**
 * @swagger
 * /api/admin/dashboard:
 *   get:
 *     summary: Get administrative dashboard statistics
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Stats retrieved successfully
 */
router.get("/dashboard", authenticateToken, permit("admin"), getDashboardStats);

/**
 * @swagger
 * /api/admin/kyc/pending:
 *   get:
 *     summary: Get pending KYC verification requests
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of pending requests
 */
router.get("/kyc/pending", authenticateToken, permit("admin"), getPendingKYCUsers);

/**
 * @swagger
 * /api/admin/kyc/approve:
 *   post:
 *     summary: Approve a user's KYC record
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: integer
 *     responses:
 *       200:
 *         description: KYC approved
 */
router.post("/kyc/approve", authenticateToken, permit("admin"), approveKYC);

/**
 * @swagger
 * /api/admin/kyc/reject:
 *   post:
 *     summary: Reject a user's KYC record
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: integer
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: KYC rejected
 */
router.post("/kyc/reject", authenticateToken, permit("admin"), rejectKYC);

export default router;
