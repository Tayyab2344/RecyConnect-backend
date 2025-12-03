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
  suspendUser,
  updateRates,
  getDashboardStats
} from "../controllers/adminController.js";

const router = express.Router();

// Logs
router.get("/logs", authenticateToken, permit("admin"), getSystemLogs);
router.get("/logs/:id", authenticateToken, permit("admin"), getLogById);

// User Management
router.get("/users", authenticateToken, permit("admin"), getUsers);
router.put("/users/:id/suspend", authenticateToken, permit("admin"), suspendUser);

// Rates Management
router.post("/rates", authenticateToken, permit("admin"), updateRates);

// Dashboard Stats
router.get("/dashboard", authenticateToken, permit("admin"), getDashboardStats);

// KYC Management
router.get("/kyc/pending", authenticateToken, permit("admin"), getPendingKYCUsers);
router.post("/kyc/approve", authenticateToken, permit("admin"), approveKYC);
router.post("/kyc/reject", authenticateToken, permit("admin"), rejectKYC);

export default router;
