import express from "express";
import { ingestClientLogs } from "../controllers/logController.js";
import { optionalAuth } from "../middlewares/authMiddleware.js";

const router = express.Router();

/**
 * @swagger
 * /api/logs/client:
 *   post:
 *     summary: Ingest batched logs from the client app
 *     tags: [Logs]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               logs:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       200:
 *         description: Logs ingested successfully
 */
router.post("/client", optionalAuth, ingestClientLogs);

export default router;
