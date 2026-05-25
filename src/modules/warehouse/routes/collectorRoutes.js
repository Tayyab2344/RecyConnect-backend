import express from "express";
import multer from "multer";
import { authenticateToken } from '../../../middlewares/authMiddleware.js';
import { permit } from '../../../middlewares/roleMiddleware.js';
import {
  acceptCollectorTask,
  confirmDeliveryForTask,
  getCollectorDashboard,
  getCollectorEarnings,
  getCollectorProfile,
  getCollectorTaskDetails,
  getCollectorTasks,
  recordCollectorLocation,
  reportCollectorIncident,
  updateCollectorAvailability,
  updateCollectorTaskStatus,
  verifyWasteForTask,
  getOptimizedRoute,
  getNearestCollectors,
} from "../controllers/collectorController.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

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
router.get("/nearest", authenticateToken, permit("warehouse", "admin"), getNearestCollectors);

router.use(authenticateToken, permit("collector"));

router.get("/me", getCollectorProfile);
router.get("/dashboard", getCollectorDashboard);
router.get("/tasks/optimized-route", getOptimizedRoute);
router.patch("/availability", updateCollectorAvailability);
router.get("/tasks", getCollectorTasks);
router.get("/history", (req, res, next) => {
  req.query.history = "true";
  next();
}, getCollectorTasks);
router.get("/tasks/:id", getCollectorTaskDetails);
router.post("/tasks/:id/accept", acceptCollectorTask);
router.patch("/tasks/:id/status", updateCollectorTaskStatus);
router.post("/tasks/:id/location", recordCollectorLocation);
router.post("/location", recordCollectorLocation);

// Verification with proof image uploads
router.post("/tasks/:id/verify", upload.array("proofImages", 5), verifyWasteForTask);

// Delivery confirmation with proof image uploads
router.post("/tasks/:id/delivery", upload.array("proofImages", 5), confirmDeliveryForTask);

// Incident reporting with proof image upload
router.post("/tasks/:id/incident", upload.array("proofImages", 1), reportCollectorIncident);

// Earnings wallet
router.get("/earnings", getCollectorEarnings);

export default router;
