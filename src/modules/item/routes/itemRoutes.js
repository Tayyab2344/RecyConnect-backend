/**
 * Item Routes
 *
 * Routes for personal inventory item management.
 * All routes require authentication.
 *
 * @module modules/item/routes/itemRoutes
 */

import express from "express";
import { createItem, getItems, getItem, deleteItem } from "../controllers/itemController.js";
import { authenticateToken } from "../../../middlewares/authMiddleware.js";
import multer from "multer";

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

// ── Item CRUD ─────────────────────────────────────────────────
router.post("/", authenticateToken, upload.array("images", 5), createItem);
router.get("/", authenticateToken, getItems);
router.get("/:id", authenticateToken, getItem);
router.delete("/:id", authenticateToken, deleteItem);

export default router;
