import prisma from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { createAndSendNotification } from './notificationService.js';
import { getIO } from '../modules/chat/gateway/socketGateway.js';

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

    // 2. Determine points based on activityType and user role
    let points = 0;
    const role = (user.role || 'individual').toLowerCase();

    if (customPoints !== null) {
      points = customPoints;
    } else {
      if (role === 'individual') {
        switch (activityType) {
          case 'LISTING_UPLOAD': points = 10; break;
          case 'AI_CLASSIFICATION': points = 15; break;
          case 'SUCCESSFUL_SALE': points = 50; break;
          case 'PURCHASE': points = 20; break;
          case 'DAILY_STREAK': points = 5; break;
          case 'REFERRAL': points = 100; break;
          case 'RATING': points = 25; break;
          default: points = 10;
        }
      } else if (role === 'warehouse') {
        switch (activityType) {
          case 'BULK_PURCHASE': points = 100; break;
          case 'BULK_SALE': points = 120; break;
          case 'HIGH_TRANSACTION_VOLUME': points = 80; break;
          case 'FAST_ORDER_COMPLETION': points = 40; break;
          case 'CUSTOMER_RATING': points = 50; break;
          case 'WEEKLY_ACTIVITY': points = 70; break;
          default: points = 50;
        }
      } else if (role === 'company') {
        switch (activityType) {
          case 'CORPORATE_RECYCLING': points = 200; break;
          case 'LARGE_TRANSACTION': points = 150; break;
          case 'MONTHLY_SUSTAINABILITY': points = 300; break;
          case 'CONTINUOUS_MONTHLY': points = 100; break;
          default: points = 100;
        }
      } else {
        // Fallback for admin or collector
        points = 10;
      }
    }

    if (points <= 0) return null;

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

    // 7. Update Leaderboard ranking (non-blocking)
    await recalculateLeaderboardRanks();

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

  } catch (err) {
    logger.error(`[REWARDS] Failed to evaluate badges: ${err.message}`);
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
