/**
 * Admin Routes — Consolidated Entry Point
 *
 * Mounts all admin sub-domain routes under /api/admin.
 * Each sub-router handles its own authentication and authorization.
 *
 * @module modules/admin/routes
 */

import express from "express";
import { authenticateToken } from "../../../middlewares/authMiddleware.js";
import { permit } from "../../../middlewares/roleMiddleware.js";
import { cacheResponse } from "../../../middlewares/cacheMiddleware.js";

// ── Admin Controllers ─────────────────────────────────────────
import { getPendingKYCUsers, approveKYC, rejectKYC } from "../controllers/kycController.js";
import { getUsers, suspendUser, banUser, resetUserPassword, getActiveSessions, revokeSession } from "../controllers/userManagementController.js";
import {
  getDashboardStats,
  getAdminOrders,
  getAdminPayments,
  getAdminListings,
} from "../controllers/dashboardController.js";
import { getRates, updateRates, deleteRate } from "../controllers/rateController.js";
import { getSystemLogs, getLogById } from "../controllers/logController.js";
import * as monitoringCtrl from "../controllers/monitoringController.js";
import {
  getSystemOverview,
  getMaterialBreakdown,
  getUserActivity,
  getTimeSeries,
  getLocationAnalytics,
  exportSystemReport,
} from "../controllers/reportController.js";

// ── Cross-Module Imports ─────────────────────────────────────
import {
  getAllComplaints,
  updateComplaintStatus,
  deleteComplaint,
} from "../../complaint/controllers/complaintController.js";

const router = express.Router();

// All admin routes require authentication + admin role
router.use(authenticateToken);
router.use(permit("admin"));

// ── Dashboard ─────────────────────────────────────────────────
router.get("/dashboard", getDashboardStats);

// ── KYC Management ────────────────────────────────────────────
router.get("/kyc/pending", getPendingKYCUsers);
router.post("/kyc/approve", approveKYC);
router.post("/kyc/reject", rejectKYC);

// ── User Management ───────────────────────────────────────────
router.get("/users", getUsers);
router.put("/users/:id/suspend", suspendUser);
router.put("/users/:id/ban", banUser);
router.post("/users/:id/reset-password", resetUserPassword);

// ── Sessions Management ─────────────────────────────────────────
router.get("/sessions", getActiveSessions);
router.post("/sessions/:id/revoke", revokeSession);

// ── Orders / Payments / Listings Oversight ────────────────────
router.get("/orders", getAdminOrders);
router.get("/payments", getAdminPayments);
router.get("/listings", getAdminListings);

// ── Rate Management ───────────────────────────────────────────
router.get("/rates", getRates);
router.post("/rates", updateRates);
router.delete("/rates/:category", deleteRate);

// ── Activity Logs ─────────────────────────────────────────────
router.get("/logs", getSystemLogs);
router.get("/logs/:id", getLogById);

// ── Complaint Management ──────────────────────────────────────
router.get("/complaints", getAllComplaints);
router.put("/complaints/:id", updateComplaintStatus);
router.delete("/complaints/:id", deleteComplaint);

// ── Reports & Analytics ───────────────────────────────────────
router.get("/reports/overview", cacheResponse(120), getSystemOverview);
router.get("/reports/materials", cacheResponse(120), getMaterialBreakdown);
router.get("/reports/user-activity", cacheResponse(120), getUserActivity);
router.get("/reports/timeseries", cacheResponse(300), getTimeSeries);
router.get("/reports/locations", cacheResponse(300), getLocationAnalytics);
router.get("/reports/export", exportSystemReport);

// ── System Monitoring ─────────────────────────────────────────
router.get("/monitoring/analytics", monitoringCtrl.getAnalyticsSnapshot);
router.get("/monitoring/errors", monitoringCtrl.getRecentErrors);
router.get("/monitoring/slow-endpoints", monitoringCtrl.getSlowEndpoints);

// ── AI Observability & AIOps ──────────────────────────────────
import observabilityRouter from "./observabilityRoutes.js";
router.use("/observability", observabilityRouter);

export default router;
