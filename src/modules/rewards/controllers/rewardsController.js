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

    // --- Dynamic Trust Score Calculation ---
    const [
      completedOrders,
      positiveRatings,
      disputes,
      refunds,
      cancellations
    ] = await Promise.all([
      prisma.order.count({
        where: {
          OR: [{ buyerId: userId }, { sellerId: userId }],
          status: 'COMPLETED'
        }
      }),
      prisma.review.count({
        where: {
          revieweeId: userId,
          rating: { gte: 4 }
        }
      }),
      prisma.activityLog.count({
        where: {
          userId,
          action: { contains: 'DISPUTE' }
        }
      }),
      prisma.payment.count({
        where: {
          order: {
            OR: [{ buyerId: userId }, { sellerId: userId }]
          },
          status: 'REFUNDED'
        }
      }),
      prisma.order.count({
        where: {
          OR: [{ buyerId: userId }, { sellerId: userId }],
          status: 'CANCELLED'
        }
      })
    ]);

    const baseScore = (completedOrders * 2) + positiveRatings - disputes - refunds - cancellations;
    const trustScore = Math.min(100, Math.max(0, baseScore));

    const nextLevelInfo = getNextLevelInfo(user.ecoPoints);

    sendSuccess(res, "Rewards status fetched successfully", {
      ecoPoints: user.ecoPoints,
      currentLevel: user.currentLevel,
      dailyStreak: user.dailyStreak,
      lastLoginDate: user.lastLoginDate,
      badges: user.badges,
      trustScore,
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

    // Calculate start of current week (Monday 12:00 AM)
    const startOfWeek = new Date();
    const day = startOfWeek.getDay();
    const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
    startOfWeek.setDate(diff);
    startOfWeek.setHours(0, 0, 0, 0);

    // 1. Fetch weekly points sum grouped by user
    const weeklyGroup = await prisma.reward.groupBy({
      by: ['userId'],
      where: {
        createdAt: { gte: startOfWeek },
        rewardType: 'POINTS'
      },
      _sum: {
        points: true
      }
    });

    const weeklyPointsMap = new Map(
      weeklyGroup.map(g => [g.userId, g._sum.points || 0])
    );

    // 2. Fetch users matching roles
    const users = await prisma.user.findMany({
      where: {
        role: { in: roles },
        deletedAt: null,
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
      }
    });

    // 3. Map weekly points and sort desc
    const mapped = users.map(u => ({
      ...u,
      weeklyPoints: weeklyPointsMap.get(u.id) || 0
    }));

    mapped.sort((a, b) => {
      if (b.weeklyPoints !== a.weeklyPoints) {
        return b.weeklyPoints - a.weeklyPoints;
      }
      return b.ecoPoints - a.ecoPoints; // tie breaker
    });

    const top20 = mapped.slice(0, 20);

    // 4. Enrich with completed orders and weight processed
    const data = await Promise.all(top20.map(async (u, idx) => {
      let displayName = u.name;
      if (category === "warehouses") displayName = u.businessName || u.name;
      if (category === "companies") displayName = u.companyName || u.name;

      const completedTransactions = await prisma.order.count({
        where: {
          OR: [{ buyerId: u.id }, { sellerId: u.id }],
          status: 'COMPLETED'
        }
      });

      const weightSum = await prisma.orderItem.aggregate({
        _sum: { quantity: true },
        where: {
          order: {
            OR: [{ buyerId: u.id }, { sellerId: u.id }],
            status: 'COMPLETED'
          }
        }
      });
      const materialProcessed = weightSum._sum.quantity || 0.0;

      return {
        userId: u.id,
        displayName: displayName || "Anonymous Recycler",
        profileImage: u.profileImage,
        city: u.city,
        area: u.area,
        ecoPoints: u.weeklyPoints, // Show weekly points on leaderboard
        totalEcoPoints: u.ecoPoints,
        currentLevel: u.currentLevel,
        completedTransactions,
        materialProcessed: parseFloat(materialProcessed.toFixed(1)),
        rank: idx + 1
      };
    }));

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

/**
 * Submit a review for a completed order
 * POST /api/orders/:id/review
 */
export async function submitOrderReview(req, res) {
  try {
    const orderId = parseInt(req.params.id, 10);
    const {
      rating,
      feedback,
      productQuality,
      materialAccuracy,
      communication,
      deliveryExperience,
      overallSatisfaction
    } = req.body;
    const reviewerId = req.user.id;

    if (isNaN(orderId)) {
      return sendError(res, "Invalid order ID", null, 400);
    }

    if (!rating || rating < 1 || rating > 5) {
      return sendError(res, "Rating must be an integer between 1 and 5", null, 400);
    }

    // 1. Fetch order details and check permissions
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { reviews: true, payment: true }
    });

    if (!order) {
      return sendError(res, "Order not found", null, 404);
    }

    if (order.status !== 'COMPLETED') {
      return sendError(res, "Only completed orders can be reviewed", null, 400);
    }

    if (order.payment && order.payment.status === 'REFUNDED') {
      return sendError(res, "Cannot submit review for a refunded order", null, 400);
    }

    const disputeLog = await prisma.activityLog.findFirst({
      where: {
        resourceType: 'order',
        resourceId: orderId.toString(),
        action: { contains: 'DISPUTE' }
      }
    });
    if (disputeLog) {
      return sendError(res, "Cannot submit review for an order with a dispute", null, 400);
    }

    const isBuyer = order.buyerId === reviewerId;
    const isSeller = order.sellerId === reviewerId;
    if (!isBuyer && !isSeller) {
      return sendError(res, "You did not participate in this transaction", null, 403);
    }

    const revieweeId = isBuyer ? order.sellerId : order.buyerId;

    // Check if this reviewer has already reviewed this order
    const existingReview = order.reviews.find(r => r.reviewerId === reviewerId);
    if (existingReview) {
      return sendError(res, "You have already reviewed this order", null, 400);
    }

    // Validate category ratings if provided
    const categories = {
      productQuality,
      materialAccuracy,
      communication,
      deliveryExperience,
      overallSatisfaction
    };
    for (const [key, val] of Object.entries(categories)) {
      if (val !== undefined && val !== null) {
        const intVal = parseInt(val, 10);
        if (isNaN(intVal) || intVal < 1 || intVal > 5) {
          return sendError(res, `${key} rating must be an integer between 1 and 5`, null, 400);
        }
      }
    }

    // 2. Create review inside transaction
    const result = await prisma.$transaction(async (tx) => {
      const review = await tx.review.create({
        data: {
          orderId,
          reviewerId,
          revieweeId,
          rating: parseInt(rating, 10),
          feedback,
          productQuality: productQuality ? parseInt(productQuality, 10) : null,
          materialAccuracy: materialAccuracy ? parseInt(materialAccuracy, 10) : null,
          communication: communication ? parseInt(communication, 10) : null,
          deliveryExperience: deliveryExperience ? parseInt(deliveryExperience, 10) : null,
          overallSatisfaction: overallSatisfaction ? parseInt(overallSatisfaction, 10) : null,
        }
      });
      return review;
    });

    // 3. Award Eco Points on review submission (only if reviewer is buyer)
    if (isBuyer) {
      await awardPoints({
        userId: reviewerId,
        activityType: 'RATING',
        customPoints: 5
      });

      if (rating >= 4) {
        await awardPoints({
          userId: revieweeId,
          activityType: 'SUCCESSFUL_SALE',
          customPoints: 10
        });
      }
    }

    sendSuccess(res, "Review submitted successfully", result, 201);
  } catch (error) {
    logger.error(`[REWARDS_CTRL] Review submission failed: ${error.message}`);
    sendError(res, "Failed to submit review", error);
  }
}

/**
 * Edit a review within 7 days
 * PUT /api/orders/:id/review
 */
export async function editOrderReview(req, res) {
  try {
    const orderId = parseInt(req.params.id, 10);
    const {
      rating,
      feedback,
      productQuality,
      materialAccuracy,
      communication,
      deliveryExperience,
      overallSatisfaction
    } = req.body;
    const reviewerId = req.user.id;

    if (isNaN(orderId)) {
      return sendError(res, "Invalid order ID", null, 400);
    }

    const review = await prisma.review.findFirst({
      where: { orderId, reviewerId }
    });

    if (!review) {
      return sendError(res, "Review not found", null, 404);
    }

    // Check if within 7 days
    const diffMs = Date.now() - new Date(review.createdAt).getTime();
    const limitMs = 7 * 24 * 60 * 60 * 1000;
    if (diffMs > limitMs) {
      return sendError(res, "Review edit period has expired. Reviews can only be edited within 7 days.", null, 400);
    }

    // Validate category ratings if provided
    const categories = {
      productQuality,
      materialAccuracy,
      communication,
      deliveryExperience,
      overallSatisfaction
    };
    for (const [key, val] of Object.entries(categories)) {
      if (val !== undefined && val !== null) {
        const intVal = parseInt(val, 10);
        if (isNaN(intVal) || intVal < 1 || intVal > 5) {
          return sendError(res, `${key} rating must be an integer between 1 and 5`, null, 400);
        }
      }
    }

    const newRating = rating !== undefined ? parseInt(rating, 10) : review.rating;
    if (newRating < 1 || newRating > 5) {
      return sendError(res, "Rating must be an integer between 1 and 5", null, 400);
    }

    const updatedReview = await prisma.review.update({
      where: { id: review.id },
      data: {
        rating: newRating,
        feedback: feedback !== undefined ? feedback : review.feedback,
        productQuality: productQuality !== undefined ? (productQuality ? parseInt(productQuality, 10) : null) : review.productQuality,
        materialAccuracy: materialAccuracy !== undefined ? (materialAccuracy ? parseInt(materialAccuracy, 10) : null) : review.materialAccuracy,
        communication: communication !== undefined ? (communication ? parseInt(communication, 10) : null) : review.communication,
        deliveryExperience: deliveryExperience !== undefined ? (deliveryExperience ? parseInt(deliveryExperience, 10) : null) : review.deliveryExperience,
        overallSatisfaction: overallSatisfaction !== undefined ? (overallSatisfaction ? parseInt(overallSatisfaction, 10) : null) : review.overallSatisfaction,
      }
    });

    // Check if point adjustment is needed for the seller (only if reviewer is buyer)
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (order && order.buyerId === reviewerId) {
      const oldWasPositive = review.rating >= 4;
      const newIsPositive = newRating >= 4;

      if (oldWasPositive && !newIsPositive) {
        await awardPoints({
          userId: order.sellerId,
          activityType: 'SUCCESSFUL_SALE',
          customPoints: -10
        });
      } else if (!oldWasPositive && newIsPositive) {
        await awardPoints({
          userId: order.sellerId,
          activityType: 'SUCCESSFUL_SALE',
          customPoints: 10
        });
      }
    }

    sendSuccess(res, "Review updated successfully", updatedReview);
  } catch (error) {
    logger.error(`[REWARDS_CTRL] Review edit failed: ${error.message}`);
    sendError(res, "Failed to edit review", error);
  }
}

/**
 * Report a review
 * POST /api/orders/:id/review/report
 */
export async function reportOrderReview(req, res) {
  try {
    const orderId = parseInt(req.params.id, 10);
    const { reason } = req.body;
    const userId = req.user.id;

    if (isNaN(orderId)) {
      return sendError(res, "Invalid order ID", null, 400);
    }

    if (!reason || reason.trim() === '') {
      return sendError(res, "Reason is required to report a review", null, 400);
    }

    const review = await prisma.review.findFirst({
      where: {
        orderId,
        reviewerId: { not: userId }
      }
    });

    if (!review) {
      return sendError(res, "Review to report not found", null, 404);
    }

    const updatedReview = await prisma.review.update({
      where: { id: review.id },
      data: {
        isReported: true,
        reportReason: reason
      }
    });

    await prisma.complaint.create({
      data: {
        userId,
        category: "REVIEW_REPORT",
        description: `Review ID: ${review.id} for Order #${orderId} was reported by User #${userId}. Reason: ${reason}`,
        status: "PENDING"
      }
    });

    sendSuccess(res, "Review reported successfully", updatedReview);
  } catch (error) {
    logger.error(`[REWARDS_CTRL] Review report failed: ${error.message}`);
    sendError(res, "Failed to report review", error);
  }
}

/**
 * Get reviews received by a user
 * GET /api/users/:id/reviews
 */
export async function getUserReviews(req, res) {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return sendError(res, "Invalid user ID", null, 400);
    }

    const reviews = await prisma.review.findMany({
      where: {
        revieweeId: userId,
        isReported: false
      },
      include: {
        reviewer: {
          select: {
            id: true,
            name: true,
            profileImage: true,
            role: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const count = reviews.length;
    let averageRating = 0;
    let avgProductQuality = 0;
    let avgMaterialAccuracy = 0;
    let avgCommunication = 0;
    let avgDeliveryExperience = 0;
    let avgOverallSatisfaction = 0;

    let pqCount = 0, maCount = 0, commCount = 0, deCount = 0, osCount = 0;

    if (count > 0) {
      let totalRating = 0;
      reviews.forEach(r => {
        totalRating += r.rating;
        if (r.productQuality) { avgProductQuality += r.productQuality; pqCount++; }
        if (r.materialAccuracy) { avgMaterialAccuracy += r.materialAccuracy; maCount++; }
        if (r.communication) { avgCommunication += r.communication; commCount++; }
        if (r.deliveryExperience) { avgDeliveryExperience += r.deliveryExperience; deCount++; }
        if (r.overallSatisfaction) { avgOverallSatisfaction += r.overallSatisfaction; osCount++; }
      });
      averageRating = parseFloat((totalRating / count).toFixed(2));
      avgProductQuality = pqCount > 0 ? parseFloat((avgProductQuality / pqCount).toFixed(2)) : null;
      avgMaterialAccuracy = maCount > 0 ? parseFloat((avgMaterialAccuracy / maCount).toFixed(2)) : null;
      avgCommunication = commCount > 0 ? parseFloat((avgCommunication / commCount).toFixed(2)) : null;
      avgDeliveryExperience = deCount > 0 ? parseFloat((avgDeliveryExperience / deCount).toFixed(2)) : null;
      avgOverallSatisfaction = osCount > 0 ? parseFloat((avgOverallSatisfaction / osCount).toFixed(2)) : null;
    }

    sendSuccess(res, "User reviews fetched successfully", {
      reviews,
      stats: {
        totalReviews: count,
        averageRating,
        avgProductQuality,
        avgMaterialAccuracy,
        avgCommunication,
        avgDeliveryExperience,
        avgOverallSatisfaction
      }
    });
  } catch (error) {
    logger.error(`[REWARDS_CTRL] Failed to get user reviews: ${error.message}`);
    sendError(res, "Failed to fetch user reviews", error);
  }
}

/**
 * Get reviews submitted by the current user
 * GET /api/reviews/my
 */
export async function getMyReviews(req, res) {
  try {
    const userId = req.user.id;

    const reviews = await prisma.review.findMany({
      where: { reviewerId: userId },
      include: {
        reviewee: {
          select: {
            id: true,
            name: true,
            profileImage: true,
            role: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    sendSuccess(res, "Submitted reviews fetched successfully", reviews);
  } catch (error) {
    logger.error(`[REWARDS_CTRL] Failed to get my reviews: ${error.message}`);
    sendError(res, "Failed to fetch submitted reviews", error);
  }
}

/**
 * Get reviews received by the current user
 * GET /api/reviews/received
 */
export async function getReceivedReviews(req, res) {
  try {
    req.params.id = req.user.id.toString();
    return getUserReviews(req, res);
  } catch (error) {
    logger.error(`[REWARDS_CTRL] Failed to get received reviews: ${error.message}`);
    sendError(res, "Failed to fetch received reviews", error);
  }
}
