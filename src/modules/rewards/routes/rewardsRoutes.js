import { Router } from "express";
import { authenticateToken } from "../../../middlewares/authMiddleware.js";
import { cacheResponse } from "../../../middlewares/cacheMiddleware.js";
import {
  getRewardsStatus,
  checkIn,
  getLeaderboard,
  getHistory,
  getChallenges
} from "../controllers/rewardsController.js";

const router = Router();

// Protect all rewards routes with token authentication
router.use(authenticateToken);

/**
 * @swagger
 * /api/rewards/status:
 *   get:
 *     summary: Get user's rewards status, points, level, and badges
 *     tags: [Rewards]
 *     security:
 *       - bearerAuth: []
 */
router.get("/status", cacheResponse(30), getRewardsStatus);

/**
 * @swagger
 * /api/rewards/check-in:
 *   post:
 *     summary: Claim daily check-in points and update login streak
 *     tags: [Rewards]
 *     security:
 *       - bearerAuth: []
 */
router.post("/check-in", checkIn);

/**
 * @swagger
 * /api/rewards/leaderboard:
 *   get:
 *     summary: Get role-specific top points leaderboard
 *     tags: [Rewards]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [individuals, warehouses, companies]
 *           default: individuals
 */
router.get("/leaderboard", cacheResponse(60), getLeaderboard);

/**
 * @swagger
 * /api/rewards/history:
 *   get:
 *     summary: Get user's points earning logs history
 *     tags: [Rewards]
 *     security:
 *       - bearerAuth: []
 */
router.get("/history", getHistory);

/**
 * @swagger
 * /api/rewards/challenges:
 *   get:
 *     summary: Get user's active gamified missions and progress
 *     tags: [Rewards]
 *     security:
 *       - bearerAuth: []
 */
router.get("/challenges", cacheResponse(60), getChallenges);

export default router;
