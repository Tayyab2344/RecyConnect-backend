import express from "express";
import { authenticate } from "../middlewares/authMiddleware.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Collector
 *   description: Collector-specific endpoints
 */

/**
 * @swagger
 * /api/collector/me:
 *   get:
 *     summary: Get collector profile
 *     description: Retrieve the authenticated collector's profile information
 *     tags: [Collector]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Collector profile retrieved successfully
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
 *                     id:
 *                       type: integer
 *                       description: User ID
 *                     collectorId:
 *                       type: string
 *                       description: Collector ID
 *                     name:
 *                       type: string
 *                       description: Collector name
 *                     role:
 *                       type: string
 *                       example: "collector"
 *                     createdById:
 *                       type: integer
 *                       description: ID of warehouse that created this collector
 *       401:
 *         description: Unauthorized - Invalid or missing token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get("/me", authenticate, (req, res) =>
  res.json({ success: true, data: req.user })
);

export default router;
