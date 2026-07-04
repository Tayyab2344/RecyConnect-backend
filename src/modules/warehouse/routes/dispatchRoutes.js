import express from "express";
import { authenticateToken } from "../../../middlewares/authMiddleware.js";
import { permit } from "../../../middlewares/roleMiddleware.js";
import {
  optimizeAndClusterRoutes,
  assignTripToCollector,
  getCollectorRecommendations,
  getWarehouseTrips,
  assignOrdersToCollector,
  getNearbyWarehouses,
  requestDispatch,
  getPendingDispatches,
  respondToDispatch,
  assignCollectorToDispatch,
  collectorRespondToDispatch,
  getWarehouseDispatches
} from "../controllers/dispatchController.js";

const router = express.Router();

// Require authenticated user for all dispatch/logistics routes
router.use(authenticateToken);

// Public/Buyer logistics endpoints
router.get("/nearby-warehouses", getNearbyWarehouses);
router.post("/request", requestDispatch);

// Warehouse manager / Admin logistics endpoints
router.get("/pending", permit("warehouse", "admin"), getPendingDispatches);
router.get("/my-dispatches", permit("warehouse", "admin"), getWarehouseDispatches);
router.post("/:id/respond", permit("warehouse", "admin"), respondToDispatch);
router.post("/:id/assign-collector", permit("warehouse", "admin"), assignCollectorToDispatch);

// Legacy Trip management endpoints
router.post("/optimize", permit("warehouse", "admin"), optimizeAndClusterRoutes);
router.post("/assign", permit("warehouse", "admin"), assignTripToCollector);
router.post("/assign-orders", permit("warehouse", "admin"), assignOrdersToCollector);
router.get("/recommendations", permit("warehouse", "admin"), getCollectorRecommendations);
router.get("/trips", permit("warehouse", "admin"), getWarehouseTrips);

// Collector endpoints
router.post("/:id/collector-respond", permit("collector"), collectorRespondToDispatch);

export default router;

