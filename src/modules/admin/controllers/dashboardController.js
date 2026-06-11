/**
 * Admin Dashboard Controller
 *
 * Provides aggregated dashboard statistics, and admin-level views
 * for orders, payments, and listings oversight.
 *
 * @module modules/admin/controllers/dashboardController
 */

import { UserRole, VerificationStatus } from "../../../constants/enums.js";
import { sendSuccess, sendPaginated, sendError } from "../../../utils/responseHelper.js";
import { getPaginationParams } from "../../../utils/queryHelper.js";
import prisma from "../../../lib/prisma.js";

/**
 * Get comprehensive dashboard statistics for the admin panel.
 * Uses a Prisma transaction to batch all aggregation queries.
 *
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>}
 */
export async function getDashboardStats(req, res) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const week = new Date();
    week.setDate(week.getDate() - 7);
    week.setHours(0, 0, 0, 0);

    const month = new Date();
    month.setDate(month.getDate() - 30);
    month.setHours(0, 0, 0, 0);

    const year = new Date();
    year.setDate(year.getDate() - 365);
    year.setHours(0, 0, 0, 0);

    const [
      userCount,
      itemCount,
      transactionCount,
      revenue,
      orderCount,
      completedOrderCount,
      cancelledOrderCount,
      activeCollectors,
      roleCounts,
      paymentCounts,
      processedWeight,
      openDisputes,
      suspendedUsers,
      dayStats,
      weekStats,
      monthStats,
      yearStats,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.item.count(),
      prisma.transaction.count(),
      prisma.transaction.aggregate({ _sum: { totalAmount: true } }),
      prisma.order.count(),
      prisma.order.count({ where: { status: "COMPLETED" } }),
      prisma.order.count({ where: { status: "CANCELLED" } }),
      prisma.user.count({
        where: {
          role: UserRole.COLLECTOR,
          verificationStatus: VerificationStatus.VERIFIED,
        },
      }),
      prisma.user.groupBy({ by: ["role"], _count: { role: true } }),
      prisma.payment.groupBy({
        by: ["provider"],
        _count: { provider: true },
        _sum: { amount: true },
      }),
      prisma.orderItem.aggregate({
        where: { order: { status: "COMPLETED" } },
        _sum: { quantity: true },
      }),
      prisma.activityLog.count({ where: { action: { contains: "DISPUTE" } } }),
      prisma.user.count({
        where: { verificationStatus: VerificationStatus.SUSPENDED },
      }),
      getOrderAggregation(today),
      getOrderAggregation(week),
      getOrderAggregation(month),
      getOrderAggregation(year),
    ]);

    sendSuccess(res, "Dashboard stats fetched", {
      users: userCount,
      items: itemCount,
      transactions: transactionCount,
      revenue: revenue._sum.totalAmount || 0,
      orders: {
        total: orderCount,
        completed: completedOrderCount,
        cancelled: cancelledOrderCount,
      },
      activeCollectors,
      totalProcessedKg: processedWeight._sum.quantity || 0,
      roles: roleCounts.reduce((acc, item) => {
        acc[item.role] = item._count.role;
        return acc;
      }, {}),
      payments: paymentCounts.reduce((acc, item) => {
        acc[item.provider] = {
          count: item._count.provider,
          amount: item._sum.amount || 0,
        };
        return acc;
      }, {}),
      alerts: {
        openDisputes,
        suspendedUsers,
        cancelledOrders: cancelledOrderCount,
      },
      analytics: {
        day: dayStats,
        week: weekStats,
        month: monthStats,
        year: yearStats,
      }
    });
  } catch (err) {
    sendError(res, "Failed to fetch dashboard stats", err);
  }
}

async function getOrderAggregation(startDate) {
  const orders = await prisma.order.findMany({
    where: {
      status: "COMPLETED",
      createdAt: { gte: startDate }
    },
    include: {
      items: {
        include: {
          listing: true
        }
      }
    }
  });

  let buyValue = 0;
  let sellValue = 0;
  let volume = 0;

  for (const order of orders) {
    const qty = order.items.reduce((sum, item) => sum + (item.quantity || 0), 0);
    volume += qty;
    buyValue += order.totalAmount || 0;
    
    const pricePerUnit = order.items[0]?.price || 0;
    const estSellValue = qty * pricePerUnit * 1.3;
    sellValue += estSellValue;
  }

  return {
    buyValue: Math.round(buyValue),
    sellValue: Math.round(sellValue),
    volume: Math.round(volume)
  };
}

/**
 * Fetch all orders with admin-level filters (status, paymentMethod, city).
 *
 * @param {import('express').Request} req - Express request with optional query filters
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>}
 */
export async function getAdminOrders(req, res) {
  try {
    const { status, paymentMethod, city, page = 1, limit = 25 } = req.query;
    const where = {};

    if (status) where.status = status;
    if (paymentMethod) where.paymentMethod = paymentMethod;
    if (city) {
      where.OR = [
        { buyer: { city: { equals: city, mode: "insensitive" } } },
        { seller: { city: { equals: city, mode: "insensitive" } } },
      ];
    }

    const totalCount = await prisma.order.count({ where });
    const { skip, take, page: pageNum, limit: limitNum } = getPaginationParams(page, limit);

    const orders = await prisma.order.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
      include: {
        buyer: {
          select: { id: true, name: true, email: true, role: true, city: true, area: true },
        },
        seller: {
          select: { id: true, name: true, email: true, role: true, city: true, area: true },
        },
        payment: true,
        items: {
          include: {
            listing: {
              select: {
                id: true, title: true, category: true,
                materialType: true, images: true, city: true, area: true,
              },
            },
          },
        },
      },
    });

    sendPaginated(res, orders, totalCount, pageNum, limitNum);
  } catch (err) {
    sendError(res, "Failed to fetch admin orders", err);
  }
}

/**
 * Fetch all payments with admin-level filters (status, provider).
 *
 * @param {import('express').Request} req - Express request with optional query filters
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>}
 */
export async function getAdminPayments(req, res) {
  try {
    const { status, provider, page = 1, limit = 25 } = req.query;
    const where = {};

    if (status) where.status = status;
    if (provider) where.provider = provider;

    const totalCount = await prisma.payment.count({ where });
    const { skip, take, page: pageNum, limit: limitNum } = getPaginationParams(page, limit);

    const payments = await prisma.payment.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
      include: {
        order: {
          include: {
            buyer: { select: { id: true, name: true, email: true, role: true } },
            seller: { select: { id: true, name: true, email: true, role: true } },
          },
        },
      },
    });

    sendPaginated(res, payments, totalCount, pageNum, limitNum);
  } catch (err) {
    sendError(res, "Failed to fetch admin payments", err);
  }
}

/**
 * Fetch all listings with admin-level filters (status, category, materialType, city).
 *
 * @param {import('express').Request} req - Express request with optional query filters
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>}
 */
export async function getAdminListings(req, res) {
  try {
    const { status, category, materialType, city, page = 1, limit = 25 } = req.query;
    const where = {};

    if (status) where.status = status;
    if (category) where.category = { equals: category, mode: "insensitive" };
    if (materialType) where.materialType = { equals: materialType, mode: "insensitive" };
    if (city) where.city = { equals: city, mode: "insensitive" };

    const totalCount = await prisma.listing.count({ where });
    const { skip, take, page: pageNum, limit: limitNum } = getPaginationParams(page, limit);

    const listings = await prisma.listing.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: { id: true, name: true, email: true, role: true, verificationStatus: true },
        },
      },
    });

    sendPaginated(res, listings, totalCount, pageNum, limitNum);
  } catch (err) {
    sendError(res, "Failed to fetch admin listings", err);
  }
}
