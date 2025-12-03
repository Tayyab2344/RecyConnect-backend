import express from "express";
import { createTransaction, getTransactions, updateTransactionStatus } from "../controllers/transactionController.js";
import { authenticateToken } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.post("/", authenticateToken, createTransaction);
router.get("/", authenticateToken, getTransactions);
router.put("/:id/status", authenticateToken, updateTransactionStatus);

export default router;
