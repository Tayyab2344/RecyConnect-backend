import prisma from '../../../lib/prisma.js';
import { sendSuccess, sendError } from '../../../utils/responseHelper.js';
import { getNextLevelInfo, awardPoints, populateRedisLeaderboard } from '../../../services/rewardService.js';
import { logger } from '../../../utils/logger.js';
import redis, { isRedisConnected } from '../../../lib/redis.js';

/**
 * Get user's rewards status, points, level, progress, and badges.
 * GET /api/rewards/status
 */
export async function getRewardsStatus(req, res) {
  try {
    const userId = req.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        ecoPoints: true,
        currentLevel: true,
        dailyStreak: true,
        lastLoginDate: true,
        badges: {
          select: {
            id: true,
            badgeName: true,
            earnedAt: true,
          }
        }
      }
    });

    if (!user) {
      return sendError(res, "User not found", null, 404);
    }

    const nextLevelInfo = getNextLevelInfo(user.ecoPoints);

    sendSuccess(res, "Rewards status fetched successfully", {
      ecoPoints: user.ecoPoints,
      currentLevel: user.currentLevel,
      dailyStreak: user.dailyStreak,
      lastLoginDate: user.lastLoginDate,
      badges: user.badges,
      nextLevelInfo,
    });
  } catch (error) {
    logger.error(`[REWARDS_CTRL] Failed to get rewards status: ${error.message}`);
    sendError(res, "Failed to fetch rewards status", error);
  }
}

/**
 * Claim daily login rewards and increment streaks.
 * POST /api/rewards/check-in
 */
export async function checkIn(req, res) {
  try {
    const userId = req.user.id;
    const today = new Date();

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, lastLoginDate: true, dailyStreak: true }
    });

    if (!user) {
      return sendError(res, "User not found", null, 404);
    }

    // Check if user already checked in today
    if (user.lastLoginDate) {
      const lastCheckIn = new Date(user.lastLoginDate);
      if (lastCheckIn.toDateString() === today.toDateString()) {
        return sendError(res, "You have already checked in today!", null, 400);
      }
    }

    let newStreak = 1;
    if (user.lastLoginDate) {
      const lastCheckIn = new Date(user.lastLoginDate);
      
      // Calculate difference in calendar days
      // Set hours to 0 to compare exact dates
      const lastCheckInDate = new Date(lastCheckIn.getFullYear(), lastCheckIn.getMonth(), lastCheckIn.getDate());
      const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      
      const diffTime = todayDate.getTime() - lastCheckInDate.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        newStreak = user.dailyStreak + 1;
      } else {
        newStreak = 1; // Streak broken, restart
      }
    }

    // 1. Award base check-in points (+5 points)
    await prisma.user.update({
      where: { id: userId },
      data: {
        lastLoginDate: today,
        dailyStreak: newStreak,
      }
    });

    await awardPoints({
      userId,
      activityType: 'DAILY_STREAK',
      customPoints: 5,
    });

    // 2. Check and award milestone bonuses
    let bonusPoints = 0;
    let message = "Successfully checked in! You earned +5 Eco Points.";

    if (newStreak === 3) {
      bonusPoints = 20;
    } else if (newStreak === 7) {
      bonusPoints = 50;
    } else if (newStreak === 15) {
      bonusPoints = 120;
    } else if (newStreak === 30) {
      bonusPoints = 300;
    }

    if (bonusPoints > 0) {
      await awardPoints({
        userId,
        activityType: 'DAILY_STREAK',
        customPoints: bonusPoints,
      });
      message = `Amazing! You hit a ${newStreak}-day streak and earned a bonus of +${bonusPoints} points!`;
    }

    // Fetch updated user data to return
    const updatedUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        ecoPoints: true,
        currentLevel: true,
        dailyStreak: true,
        lastLoginDate: true,
      }
    });

    sendSuccess(res, message, {
      dailyStreak: updatedUser.dailyStreak,
      lastLoginDate: updatedUser.lastLoginDate,
      ecoPoints: updatedUser.ecoPoints,
      currentLevel: updatedUser.currentLevel,
      pointsEarned: 5 + bonusPoints,
    });
  } catch (error) {
    logger.error(`[REWARDS_CTRL] Daily check-in failed: ${error.message}`);
    sendError(res, "Check-in failed", error);
  }
}

/**
 * Get leaderboard list by user category (individuals, warehouses, companies)
 * GET /api/rewards/leaderboard
 */
export async function getLeaderboard(req, res) {
  try {
    const { category = "individuals" } = req.query;

    let roles = ["individual"];
    if (category === "warehouses") {
      roles = ["warehouse"];
    } else if (category === "companies") {
      roles = ["company"];
    }

    // ── Real-Time Redis Sorted Set Lookup ────────────────────────────
    if (isRedisConnected() && redis && typeof redis.zrevrange === "function") {
      try {
        // Map category query param to Redis key
        let redisKey = 'leaderboard:individuals';
        if (category === 'warehouses') redisKey = 'leaderboard:warehouses';
        else if (category === 'companies') redisKey = 'leaderboard:companies';

        const topIds = await redis.zrevrange(redisKey, 0, 19);
      if (topIds && topIds.length > 0) {
        const userIds = topIds.map(id => parseInt(id, 10));
        
        // Retrieve profile details for the ranked user IDs in a single query
        const dbUsers = await prisma.user.findMany({
          where: { id: { in: userIds }, deletedAt: null },
          select: {
            id: true,
            name: true,
            businessName: true,
            companyName: true,
            profileImage: true,
            city: true,
            area: true,
            ecoPoints: true,
            currentLevel: true,
          }
        });

        // Re-align database results to match Redis ranking order
        const userMap = new Map(dbUsers.map(u => [u.id, u]));
        const sortedUsers = userIds
          .map(id => userMap.get(id))
          .filter(Boolean);

        const data = sortedUsers.map((u, idx) => {
          let displayName = u.name;
          if (category === "warehouses") displayName = u.businessName || u.name;
          if (category === "companies") displayName = u.companyName || u.name;

          return {
            userId: u.id,
            displayName: displayName || "Anonymous Recycler",
            profileImage: u.profileImage,
            city: u.city,
            area: u.area,
            ecoPoints: u.ecoPoints,
            currentLevel: u.currentLevel,
            rank: idx + 1
          };
        });

        return sendSuccess(res, "Leaderboard fetched successfully", data);
      } else {
        // If Redis is empty, trigger an async background repopulation
        populateRedisLeaderboard().catch(err => logger.error(`[REDIS] Repopulate error: ${err.message}`));
      }
    } catch (redisErr) {
      logger.error(`[REDIS] Leaderboard lookup failed: ${redisErr.message}`);
    }
  }

    // ── Fallback: Database-Driven Sorted Query ───────────────────────
    // Fetch top users ordered by ecoPoints desc
    const users = await prisma.user.findMany({
      where: {
        role: { in: roles },
        ecoPoints: { gt: 0 },
        deletedAt: null,
      },
      orderBy: {
        ecoPoints: 'desc'
      },
      select: {
        id: true,
        name: true,
        businessName: true,
        companyName: true,
        profileImage: true,
        city: true,
        area: true,
        ecoPoints: true,
        currentLevel: true,
      },
      take: 20
    });

    // Map output to include clean ranks and business names
    const data = users.map((u, idx) => {
      let displayName = u.name;
      if (category === "warehouses") displayName = u.businessName || u.name;
      if (category === "companies") displayName = u.companyName || u.name;

      return {
        userId: u.id,
        displayName: displayName || "Anonymous Recycler",
        profileImage: u.profileImage,
        city: u.city,
        area: u.area,
        ecoPoints: u.ecoPoints,
        currentLevel: u.currentLevel,
        rank: idx + 1
      };
    });

    sendSuccess(res, "Leaderboard fetched successfully", data);
  } catch (error) {
    logger.error(`[REWARDS_CTRL] Leaderboard fetch failed: ${error.message}`);
    sendError(res, "Failed to fetch leaderboard", error);
  }
}

/**
 * Get user's rewards history ledger.
 * GET /api/rewards/history
 */
export async function getHistory(req, res) {
  try {
    const userId = req.user.id;

    const history = await prisma.reward.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    sendSuccess(res, "Rewards history fetched successfully", history);
  } catch (error) {
    logger.error(`[REWARDS_CTRL] History fetch failed: ${error.message}`);
    sendError(res, "Failed to fetch rewards history", error);
  }
}

/**
 * Get user's active missions/challenges and progress.
 * GET /api/rewards/challenges
 */
export async function getChallenges(req, res) {
  try {
    const userId = req.user.id;

    // Fetch counts from database for challenges progress
    const listingCount = await prisma.listing.count({
      where: { userId }
    });

    const salesCount = await prisma.order.count({
      where: {
        sellerId: userId,
        status: 'COMPLETED'
      }
    });

    const referralsCount = await prisma.user.count({
      where: {
        referredById: userId,
        emailVerified: true
      }
    });

    const challenges = [
      {
        id: "challenge_listings",
        title: "Recycling Publisher",
        description: "List 3 recyclable listings on the marketplace",
        target: 3,
        current: Math.min(3, listingCount),
        points: 30,
        type: "LISTINGS",
      },
      {
        id: "challenge_sales",
        title: "Successful Trader",
        description: "Complete 5 successful sales of recyclable materials",
        target: 5,
        current: Math.min(5, salesCount),
        points: 150,
        type: "SALES",
      },
      {
        id: "challenge_referrals",
        title: "Green Ambassador",
        description: "Invite 3 new friends who verify their accounts",
        target: 3,
        current: Math.min(3, referralsCount),
        points: 300,
        type: "REFERRALS",
      }
    ];

    sendSuccess(res, "Challenges fetched successfully", challenges);
  } catch (error) {
    logger.error(`[REWARDS_CTRL] Challenges fetch failed: ${error.message}`);
    sendError(res, "Failed to fetch challenges", error);
  }
}
