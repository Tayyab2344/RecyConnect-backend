import express from "express";
import { addCollector, getCollectors } from "../controllers/warehouseController.js";
import { authenticateToken } from "../middlewares/authMiddleware.js";
import { permit } from "../middlewares/roleMiddleware.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Warehouse
 *   description: Warehouse management endpoints
 */

import multer from "multer";

const upload = multer({ storage: multer.memoryStorage() });

/**
 * @swagger
 * /api/warehouse/add-collector:
 *   post:
 *     summary: Create a new collector
 *     description: |
 *       Warehouse users can create a collector with full details and files.
 *       Generates and returns credentials.
 *     tags: [Warehouse]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - address
 *               - contactNo
 *             properties:
 *               name:
 *                 type: string
 *               address:
 *                 type: string
 *               contactNo:
 *                 type: string
 *               profileImage:
 *                 type: string
 *                 format: binary
 *               cnic:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Collector created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     collectorId:
 *                       type: string
 *                     password:
 *                       type: string
 *                     name:
 *                       type: string
 */
router.post(
    "/add-collector",
    authenticateToken,
    permit("warehouse"),
    upload.fields([
        { name: "profileImage", maxCount: 1 },
        { name: "cnic", maxCount: 1 }
    ]),
    addCollector
);

/**
 * @swagger
 * /api/warehouse/collectors:
 *   get:
 *     summary: Get all collectors
 *     description: Retrieve all collectors created by the authenticated warehouse
 *     tags: [Warehouse]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of collectors
 */
router.get(
    "/collectors",
    authenticateToken,
    permit("warehouse"),
    getCollectors
);

export default router;
