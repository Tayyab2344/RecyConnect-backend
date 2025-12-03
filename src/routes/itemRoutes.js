import express from "express";
import { createItem, getItems, getItem, deleteItem } from "../controllers/itemController.js";
import { authenticateToken } from "../middlewares/authMiddleware.js";
import multer from "multer";

const upload = multer({ dest: "tmp/" });
const router = express.Router();

router.post("/", authenticateToken, upload.array("images", 5), createItem);
router.get("/", authenticateToken, getItems);
router.get("/:id", authenticateToken, getItem);
router.delete("/:id", authenticateToken, deleteItem);

export default router;
