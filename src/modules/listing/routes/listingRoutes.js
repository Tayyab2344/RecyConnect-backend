/**
 * Listing Routes
 *
 * Routes for recyclable material listing management.
 * Public endpoint available without auth; all others require authentication.
 *
 * @module modules/listing/routes/listingRoutes
 */

import express from "express";
import { authenticateToken } from "../../../middlewares/authMiddleware.js";
import { cacheResponse } from "../../../middlewares/cacheMiddleware.js";
import {
  createListing,
  getListings,
  getPublicListings,
  getListingById,
  getListingStats,
  exportListings,
  updateListing,
  publishListing,
  pauseListing,
  deleteListing,
  classifyListingImage,
} from "../controllers/listingController.js";

const router = express.Router();

// ── Public (no auth) ──────────────────────────────────────────
router.get("/public", cacheResponse(30), getPublicListings);

// ── Authenticated ─────────────────────────────────────────────
router.use(authenticateToken);

router.post("/classify", classifyListingImage);
router.post("/", createListing);
router.get("/", cacheResponse(60), getListings);
router.get("/stats", getListingStats);
router.get("/export", exportListings);
router.get("/:id", getListingById);
router.put("/:id", updateListing);
router.put("/:id/publish", publishListing);
router.put("/:id/pause", pauseListing);
router.delete("/:id", deleteListing);

export default router;
