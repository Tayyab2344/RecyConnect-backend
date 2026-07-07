import prisma from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { createAndSendNotification } from './notificationService.js';
import { getIO } from '../modules/chat/gateway/socketGateway.js';
import redis, { isRedisConnected } from '../lib/redis.js';

// Level thresholds
const LEVEL_THRESHOLDS = [
  { level: "Recycling Leader", minPoints: 7000 },
  { level: "Green Champion", minPoints: 3000 },
  { level: "Eco Contributor", minPoints: 1500 },
  { level: "Active Recycler", minPoints: 500 },
  { level: "Beginner Recycler", minPoints: 0 },
];

/**
 * Determine level based on total points
 * @param {number} points 
 * @returns {string} Level name
 */
export function getLevelForPoints(points) {
  for (const threshold of LEVEL_THRESHOLDS) {
    if (points >= threshold.minPoints) {
      return threshold.level;
    }
  }
  return "Beginner Recycler";
}

/**
 * Get next level and points required
 * @param {number} points 
 * @returns {Object} { nextLevel, pointsNeeded, progressPercent }
 */
export function getNextLevelInfo(points) {
  let nextLevel = null;
  let minPointsForNext = 0;
  let prevMinPoints = 0;

  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    const currentThreshold = LEVEL_THRESHOLDS[i];
    if (points < currentThreshold.minPoints) {
      nextLevel = currentThreshold.level;
      minPointsForNext = currentThreshold.minPoints;
      prevMinPoints = LEVEL_THRESHOLDS[i + 1]?.minPoints || 0;
      break;
    }
  }

  if (!nextLevel) {
    return {
      nextLevel: "Max Level Reached",
      pointsNeeded: 0,
      progressPercent: 1.0,
    };
  }

  const range = minPointsForNext - prevMinPoints;
  const progress = points - prevMinPoints;
  const progressPercent = range > 0 ? parseFloat((progress / range).toFixed(2)) : 1.0;

  return {
    nextLevel,
    pointsNeeded: minPointsForNext - points,
    progressPercent: Math.min(1.0, Math.max(0.0, progressPercent)),
  };
}

/**
 * Award Eco Points to a user. Handles points, level progression, badges, leaderboards, and notifications.
 * 
 * @param {Object} params
 * @param {number} params.userId - Recipient user ID
 * @param {string} params.activityType - e.g. "LISTING_UPLOAD", "AI_CLASSIFICATION", "SUCCESSFUL_SALE", "PURCHASE", "DAILY_STREAK", "REFERRAL", "RATING", "CHALLENGE"
 * @param {number} [params.customPoints=null] - Overrides role-based points if provided
 * @returns {Promise<Object|null>} The created reward record
 */
export async function awardPoints({ userId, activityType, customPoints = null }) {
  if (!userId) {
    logger.warn('[REWARDS] Cannot award points: missing userId');
    return null;
  }

  try {
    const parsedUserId = parseInt(userId, 10);
    if (isNaN(parsedUserId)) {
      logger.warn(`[REWARDS] Invalid userId: ${userId}`);
      return null;
    }

    // 1. Fetch user to verify they exist and get current points/role
    const user = await prisma.user.findUnique({
      where: { id: parsedUserId },
      select: { id: true, role: true, ecoPoints: true, currentLevel: true, name: true }
    });

    if (!user) {
      logger.warn(`[REWARDS] User ${parsedUserId} not found`);
      return null;
    }

    // 2. Determine points based on activityType
    const allowedActivities = ['SUCCESSFUL_SALE', 'PURCHASE', 'BULK_SALE', 'BULK_PURCHASE'];
    if (!allowedActivities.includes(activityType)) {
      logger.info(`[REWARDS] Points skipped. User only earns points for buying or selling. Activity: ${activityType}`);
      return null;
    }

    // Sell or buy gets exactly 10 points
    const points = 10;

    const newPoints = user.ecoPoints + points;
    const computedLevel = getLevelForPoints(newPoints);
    const leveledUp = computedLevel !== user.currentLevel;

    // 3. Execute DB updates in transaction
    const rewardRecord = await prisma.$transaction(async (tx) => {
      // Create Reward record
      const reward = await tx.reward.create({
        data: {
          userId: parsedUserId,
          points,
          activityType,
          rewardType: 'POINTS',
        }
      });

      // Update User points & level
      await tx.user.update({
        where: { id: parsedUserId },
        data: {
          ecoPoints: newPoints,
          currentLevel: computedLevel,
        }
      });

      return reward;
    });

    logger.info(`[REWARDS] Awarded +${points} Eco Points to User ${parsedUserId} for ${activityType}. New total: ${newPoints}`);

    // 4. Send Point Notification
    const activityName = activityType.replace(/_/g, ' ').toLowerCase();
    await createAndSendNotification({
      userId: parsedUserId,
      title: 'Eco Points Earned!',
      message: `You earned +${points} Eco Points for ${activityName}.`,
      type: 'REWARD',
      priority: 'MEDIUM',
    });

    // 5. Handle Level Up
    if (leveledUp) {
      logger.info(`[REWARDS] User ${parsedUserId} leveled up from ${user.currentLevel} to ${computedLevel}`);
      await createAndSendNotification({
        userId: parsedUserId,
        title: 'Level Up!',
        message: `Congratulations! Your recycling rank increased to ${computedLevel}.`,
        type: 'REWARD',
        priority: 'HIGH',
      });
    }

    // 6. Evaluate and award Badges (non-blocking)
    await evaluateBadges(parsedUserId, newPoints);

    // 7. Update Leaderboard ranking (optimized & real-time via Redis Sorted Set)
    await updateUserLeaderboard(parsedUserId, newPoints, user.role);

    // 8. Emit live WebSocket update
    const io = getIO();
    if (io) {
      io.to(`user:${parsedUserId}`).emit('rewards:updated', {
        ecoPoints: newPoints,
        currentLevel: computedLevel,
        pointsAwarded: points,
        activityType,
      });
    }

    return rewardRecord;
  } catch (err) {
    logger.error(`[REWARDS] Failed to award points: ${err.message}`);
    return null;
  }
}

/**
 * Evaluate and award badges to a user based on points, levels, and activities.
 * 
 * @param {number} userId 
 * @param {number} currentPoints 
 */
export async function evaluateBadges(userId, currentPoints) {
  try {
    const badges = await prisma.badge.findMany({
      where: { userId },
      select: { badgeName: true }
    });
    const earnedBadgeNames = new Set(badges.map(b => b.badgeName));

    const checkAndAward = async (badgeName) => {
      if (!earnedBadgeNames.has(badgeName)) {
        await prisma.badge.create({
          data: { userId, badgeName }
        });
        logger.info(`[REWARDS] User ${userId} unlocked badge: ${badgeName}`);
        await createAndSendNotification({
          userId,
          title: 'Achievement Unlocked!',
          message: `Congratulations! You unlocked the "${badgeName}" badge.`,
          type: 'REWARD',
          priority: 'HIGH',
        });
      }
    };

    // Eco Hero Badge: Reached 1000+ points
    if (currentPoints >= 1000) {
      await checkAndAward('Eco Hero');
    }

    // Check successful sales for "First Sale Badge" and "Trusted Seller" (100+ sales)
    const salesCount = await prisma.order.count({
      where: {
        sellerId: userId,
        status: 'COMPLETED',
      }
    });

    if (salesCount >= 1) {
      await checkAndAward('First Sale Badge');
    }

    if (salesCount >= 100) {
      await checkAndAward('Trusted Seller');
    }

    // Recycling Master Badge: Reached 500+ total reward activities
    const rewardsCount = await prisma.reward.count({
      where: { userId }
    });
    if (rewardsCount >= 500) {
      await checkAndAward('Recycling Master');
    }

    // Green Contributor: Check if active this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const activeThisMonth = await prisma.reward.count({
      where: {
        userId,
        createdAt: { gte: startOfMonth }
      }
    });
    if (activeThisMonth >= 1) {
      await checkAndAward('Green Contributor');
    }

    // --- Warehouse Badge Levels ---
    const userProfile = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true }
    });

    if (userProfile && userProfile.role.toLowerCase() === 'warehouse') {
      if (currentPoints >= 500) {
        await checkAndAward('Bronze Warehouse');
      }
      if (currentPoints >= 2000) {
        await checkAndAward('Silver Warehouse');
      }
      if (currentPoints >= 5000) {
        await checkAndAward('Gold Warehouse');
      }
      if (currentPoints >= 10000) {
        await checkAndAward('Platinum Warehouse');
      }
      if (currentPoints >= 20000) {
        // Fetch positive review rating percentage
        const reviews = await prisma.review.findMany({
          where: { revieweeId: userId },
          select: { rating: true }
        });
        const totalReviews = reviews.length;
        const positiveReviews = reviews.filter(r => r.rating >= 4).length;
        const positiveRatingPercent = totalReviews > 0 ? (positiveReviews / totalReviews) * 100 : 100.0;
        
        if (positiveRatingPercent >= 95.0) {
          await checkAndAward('Green Partner Warehouse');
        }
      }
    }

  } catch (err) {
    logger.error(`[REWARDS] Failed to evaluate badges: ${err.message}`);
  }
}

/**
 * Update a single user's leaderboard score in Redis and DB
 */
export async function updateUserLeaderboard(userId, points, role) {
  try {
    const cleanRole = (role || 'individual').toLowerCase();

    // 1. Update Redis (real-time ZADD)
    if (isRedisConnected() && redis) {
      const redisKey = `leaderboard:${cleanRole}s`;
      await redis.zadd(redisKey, points, userId);
      await redis.zadd('leaderboard:all', points, userId);
    }

    // 2. Upsert user in DB Leaderboard (for persistence, rank updated via periodic cron)
    await prisma.leaderboard.upsert({
      where: { userId },
      update: { totalPoints: points },
      create: { userId, totalPoints: points, rank: 0 }
    });
  } catch (err) {
    logger.error(`[REWARDS] Failed to update user leaderboard: ${err.message}`);
  }
}

/**
 * Re-populate Redis from DB if it gets cleared
 */
export async function populateRedisLeaderboard() {
  if (!isRedisConnected() || !redis) return;

  try {
    const users = await prisma.user.findMany({
      where: { ecoPoints: { gt: 0 }, deletedAt: null },
      select: { id: true, ecoPoints: true, role: true }
    });

    const pipeline = redis.pipeline();
    for (const u of users) {
      const roleKey = `leaderboard:${u.role.toLowerCase()}s`;
      pipeline.zadd(roleKey, u.ecoPoints, u.id);
      pipeline.zadd('leaderboard:all', u.ecoPoints, u.id);
    }
    await pipeline.exec();
    logger.info('[REDIS] Leaderboard populated from database successfully');
  } catch (err) {
    logger.error(`[REDIS] Failed to populate leaderboard: ${err.message}`);
  }
}

/**
 * Recalculate ranks in Leaderboard table for all active users
 */
export async function recalculateLeaderboardRanks() {
  try {
    const users = await prisma.user.findMany({
      where: {
        ecoPoints: { gt: 0 },
        deletedAt: null,
      },
      orderBy: {
        ecoPoints: 'desc',
      },
      select: { id: true, ecoPoints: true }
    });

    // Run updates sequentially to avoid locks/deadlocks
    for (let i = 0; i < users.length; i++) {
      const u = users[i];
      const rank = i + 1;

      await prisma.leaderboard.upsert({
        where: { userId: u.id },
        update: {
          totalPoints: u.ecoPoints,
          rank,
        },
        create: {
          userId: u.id,
          totalPoints: u.ecoPoints,
          rank,
        }
      });
    }
  } catch (err) {
    logger.error(`[REWARDS] Failed to recalculate leaderboard ranks: ${err.message}`);
  }
}
