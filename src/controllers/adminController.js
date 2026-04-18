import { UserRole, VerificationStatus, KycStage } from "../constants/enums.js";
import { sendSuccess, sendPaginated, sendError } from "../utils/responseHelper.js";
import { getPaginationParams, buildSearchFilter } from "../utils/queryHelper.js";
import prisma from "../lib/prisma.js";
import { logActivity } from "../utils/activityLogger.js";

export async function getPendingKYCUsers(req, res) {
  try {
    const users = await prisma.user.findMany({
      where: {
        verificationStatus: VerificationStatus.PENDING,
        role: { in: [UserRole.WAREHOUSE, UserRole.COMPANY] },
        kycStage: { in: [KycStage.DOCUMENTS_UPLOADED, "OCR_VERIFIED"] }
      },
      include: {
        documents: true,
        ocrDatas: true
      },
      orderBy: { createdAt: "desc" }
    });

    sendSuccess(res, "Pending KYC users fetched", users);
  } catch (err) {
    sendError(res, "Failed to fetch pending KYC users", err);
  }
}

export async function approveKYC(req, res) {
  try {
    const { userId } = req.body;
    const adminId = req.user.id;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return sendError(res, "User not found", null, 404);

    const updateData = {
      verificationStatus: VerificationStatus.VERIFIED,
      kycStage: KycStage.VERIFIED,
      rejectionReason: null
    };

    // Handle Role Upgrade
    if (user.requestedRole) {
      updateData.role = user.requestedRole;
      updateData.requestedRole = null; // Clear request
    }

    await prisma.user.update({
      where: { id: userId },
      data: updateData
    });

    await logActivity({
      userId: adminId,
      role: UserRole.ADMIN,
      action: "KYC_APPROVED",
      resourceType: "user",
      resourceId: userId.toString(),
      meta: {
        previousRole: user.role,
        newRole: updateData.role || user.role
      },
      req
    });



    sendSuccess(res, "User approved successfully");
  } catch (err) {
    sendError(res, "Failed to approve KYC", err);
  }
}

export async function rejectKYC(req, res) {
  try {
    const { userId, reason } = req.body;
    const adminId = req.user.id;

    if (!reason) return sendError(res, "Rejection reason is required", null, 400);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return sendError(res, "User not found", null, 404);

    await prisma.user.update({
      where: { id: userId },
      data: {
        verificationStatus: VerificationStatus.REJECTED,
        kycStage: VerificationStatus.REJECTED, // Using REJECTED for stage too as per original code logic
        rejectionReason: reason
      }
    });

    await logActivity({
      userId: adminId,
      role: UserRole.ADMIN,
      action: "KYC_REJECTED",
      resourceType: "user",
      resourceId: userId.toString(),
      meta: { reason },
      req
    });



    sendSuccess(res, "User rejected successfully");
  } catch (err) {
    sendError(res, "Failed to reject KYC", err);
  }
}

export async function getSystemLogs(req, res) {
  try {
    const { page = 1, limit = 50, role, action, userId } = req.query;

    const where = {};
    if (role) where.actorRole = role;
    if (action) where.action = action;
    if (userId) where.userId = parseInt(userId);

    const totalCount = await prisma.activityLog.count({ where });
    const { skip, take, page: pageNum, limit: limitNum } = getPaginationParams(page, limit);

    const logs = await prisma.activityLog.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
      include: { actor: { select: { name: true, email: true, role: true } } }
    });

    sendPaginated(res, logs, totalCount, pageNum, limitNum);
  } catch (err) {
    sendError(res, "Failed to fetch system logs", err);
  }
}

export async function getLogById(req, res) {
  try {
    const { id } = req.params;
    const log = await prisma.activityLog.findUnique({
      where: { id: parseInt(id) },
      include: { actor: { select: { name: true, email: true, role: true } } }
    });

    if (!log) return sendError(res, "Log not found", null, 404);

    sendSuccess(res, "Log fetched", log);
  } catch (err) {
    sendError(res, "Failed to fetch log", err);
  }
}

// --- New Admin Functions ---

export async function getUsers(req, res) {
  try {
    const { role, search } = req.query;
    const where = {};
    if (role) where.role = role;

    if (search) {
      Object.assign(where, buildSearchFilter(search, ['name', 'email']));
    }

    const users = await prisma.user.findMany({
      where,
      select: { id: true, name: true, email: true, role: true, verificationStatus: true, createdAt: true },
      orderBy: { createdAt: 'desc' }
    });

    sendSuccess(res, "Users fetched", users);
  } catch (err) {
    sendError(res, "Failed to fetch users", err);
  }
}

export async function getAdminOrders(req, res) {
  try {
    const { status, paymentMethod, city, page = 1, limit = 25 } = req.query;
    const where = {};

    if (status) where.status = status;
    if (paymentMethod) where.paymentMethod = paymentMethod;
    if (city) {
      where.OR = [
        { buyer: { city: { equals: city, mode: "insensitive" } } },
        { seller: { city: { equals: city, mode: "insensitive" } } }
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
        buyer: { select: { id: true, name: true, email: true, role: true, city: true, area: true } },
        seller: { select: { id: true, name: true, email: true, role: true, city: true, area: true } },
        payment: true,
        items: {
          include: {
            listing: { select: { id: true, title: true, category: true, materialType: true, city: true, area: true } }
          }
        }
      }
    });

    sendPaginated(res, orders, totalCount, pageNum, limitNum);
  } catch (err) {
    sendError(res, "Failed to fetch admin orders", err);
  }
}

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
            seller: { select: { id: true, name: true, email: true, role: true } }
          }
        }
      }
    });

    sendPaginated(res, payments, totalCount, pageNum, limitNum);
  } catch (err) {
    sendError(res, "Failed to fetch admin payments", err);
  }
}

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
        user: { select: { id: true, name: true, email: true, role: true, verificationStatus: true } }
      }
    });

    sendPaginated(res, listings, totalCount, pageNum, limitNum);
  } catch (err) {
    sendError(res, "Failed to fetch admin listings", err);
  }
}

export async function getRates(req, res) {
  try {
    const rates = await prisma.rate.findMany({ orderBy: { category: "asc" } });
    sendSuccess(res, "Rates fetched", rates);
  } catch (err) {
    sendError(res, "Failed to fetch rates", err);
  }
}

export async function suspendUser(req, res) {
  try {
    const { id } = req.params;
    const { suspended } = req.body;

    const status = suspended ? VerificationStatus.SUSPENDED : VerificationStatus.VERIFIED;

    await prisma.user.update({
      where: { id: parseInt(id) },
      data: { verificationStatus: status }
    });

    await logActivity({
      action: suspended ? "USER_SUSPENDED" : "USER_ACTIVATED",
      resourceType: "user",
      resourceId: id,
      meta: { status },
      req
    });

    sendSuccess(res, `User ${suspended ? 'suspended' : 'activated'} successfully`);
  } catch (err) {
    sendError(res, "Failed to suspend/activate user", err);
  }
}

export async function updateRates(req, res) {
  try {
    const { category, pricePerUnit, unit = "kg" } = req.body;

    const rate = await prisma.rate.upsert({
      where: { category },
      update: { pricePerUnit: parseFloat(pricePerUnit), unit },
      create: { category, pricePerUnit: parseFloat(pricePerUnit), unit }
    });

    await logActivity({
      action: "UPDATE_RATES",
      resourceType: "rate",
      resourceId: category,
      meta: { pricePerUnit, unit },
      req
    });

    sendSuccess(res, "Rates updated", rate);
  } catch (err) {
    sendError(res, "Failed to update rates", err);
  }
}

export async function deleteRate(req, res) {
  try {
    const { category } = req.params;

    const existing = await prisma.rate.findUnique({ where: { category } });
    if (!existing) return sendError(res, "Rate not found", null, 404);

    await prisma.rate.delete({ where: { category } });

    await logActivity({
      action: "DELETE_RATE",
      resourceType: "rate",
      resourceId: category,
      meta: { deletedRate: existing },
      req
    });

    sendSuccess(res, "Rate deleted successfully");
  } catch (err) {
    sendError(res, "Failed to delete rate", err);
  }
}

export async function getDashboardStats(req, res) {
  try {
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
      suspendedUsers
    ] = await prisma.$transaction([
      prisma.user.count(),
      prisma.item.count(),
      prisma.transaction.count(),
      prisma.transaction.aggregate({ _sum: { totalAmount: true } }),
      prisma.order.count(),
      prisma.order.count({ where: { status: "COMPLETED" } }),
      prisma.order.count({ where: { status: "CANCELLED" } }),
      prisma.user.count({ where: { role: UserRole.COLLECTOR, verificationStatus: VerificationStatus.VERIFIED } }),
      prisma.user.groupBy({ by: ["role"], _count: { role: true } }),
      prisma.payment.groupBy({ by: ["provider"], _count: { provider: true }, _sum: { amount: true } }),
      prisma.orderItem.aggregate({
        where: { order: { status: "COMPLETED" } },
        _sum: { quantity: true }
      }),
      prisma.activityLog.count({ where: { action: { contains: "DISPUTE" } } }),
      prisma.user.count({ where: { verificationStatus: VerificationStatus.SUSPENDED } })
    ]);

    sendSuccess(res, "Dashboard stats fetched", {
      users: userCount,
      items: itemCount,
      transactions: transactionCount,
      revenue: revenue._sum.totalAmount || 0,
      orders: {
        total: orderCount,
        completed: completedOrderCount,
        cancelled: cancelledOrderCount
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
          amount: item._sum.amount || 0
        };
        return acc;
      }, {}),
      alerts: {
        openDisputes,
        suspendedUsers,
        cancelledOrders: cancelledOrderCount
      }
    });
  } catch (err) {
    sendError(res, "Failed to fetch dashboard stats", err);
  }
}
