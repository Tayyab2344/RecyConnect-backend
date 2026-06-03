import express from "express";
import { authenticateToken } from "../../../middlewares/authMiddleware.js";
import { permit } from "../../../middlewares/roleMiddleware.js";
import {
  optimizeAndClusterRoutes,
  assignTripToCollector,
  getCollectorRecommendations,
  getWarehouseTrips,
  assignOrdersToCollector
} from "../controllers/dispatchController.js";

const router = express.Router();

// All dispatch routes require warehouse manager or admin authorization
router.use(authenticateToken, permit("warehouse", "admin"));

router.post("/optimize", optimizeAndClusterRoutes);
router.post("/assign", assignTripToCollector);
router.post("/assign-orders", assignOrdersToCollector);
router.get("/recommendations", getCollectorRecommendations);
router.get("/trips", getWarehouseTrips);

export default router;
