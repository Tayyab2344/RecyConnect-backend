import express from "express";
import { createItem, getItems, getItem, deleteItem } from "../controllers/itemController.js";
import { authenticateToken } from "../middlewares/authMiddleware.js";
import multer from "multer";

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Items
 *   description: Personal item management and inventory
 */

/**
 * @swagger
 * /api/items:
 *   post:
 *     summary: Create a new item
 *     tags: [Items]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       201:
 *         description: Item created
 *   get:
 *     summary: Get all user items
 *     tags: [Items]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of items
 */
router.post("/", authenticateToken, upload.array("images", 5), createItem);
router.get("/", authenticateToken, getItems);

/**
 * @swagger
 * /api/items/{id}:
 *   get:
 *     summary: Get item details
 *     tags: [Items]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Item details retrieved
 *   delete:
 *     summary: Delete an item
 *     tags: [Items]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Item deleted
 */
router.get("/:id", authenticateToken, getItem);
router.delete("/:id", authenticateToken, deleteItem);

export default router;
