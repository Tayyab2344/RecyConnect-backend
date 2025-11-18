import express from "express";
import { addCollector } from "../controllers/warehouseController.js";
import { authenticate } from "../middlewares/authMiddleware.js";
import { permit } from "../middlewares/roleMiddleware.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Warehouse
 *   description: Warehouse management endpoints
 */

/**
 * @swagger
 * /api/warehouse/add-collector:
 *   post:
 *     summary: Create a new collector ID
 *     description: |
 *       Warehouse users can create collector IDs for their waste collectors.
 *       A unique collector ID (format: COL-XXXX) is generated automatically.
 *       The collector can later use this ID to complete their registration.
 *     tags: [Warehouse]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: Collector's name (optional)
 *             example:
 *               name: "John Doe"
 *     responses:
 *       201:
 *         description: Collector ID created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Collector ID created"
 *                 collectorId:
 *                   type: string
 *                   example: "COL-1234"
 *                   description: Generated collector ID
 *       401:
 *         description: Unauthorized - Invalid or missing token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Forbidden - User is not a warehouse
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post("/add-collector", authenticate, permit("warehouse"), addCollector);

export default router;
