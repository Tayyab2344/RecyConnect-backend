import { PrismaClient } from "@prisma/client";
import { logger } from "../utils/logger.js";
import { UserRole, VerificationStatus, KycStage } from "../constants/enums.js";
import { sendSuccess, sendPaginated, sendError } from "../utils/responseHelper.js";
import { getPaginationParams, buildSearchFilter } from "../utils/queryHelper.js";

const prisma = new PrismaClient();

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

    await prisma.activityLog.create({
      data: {
        userId: adminId,
        actorRole: UserRole.ADMIN,
        action: "KYC_APPROVED",
        resourceType: "user",
        resourceId: userId.toString(),
        meta: {
          previousRole: user.role,
          newRole: updateData.role || user.role
        }
      }
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

    await prisma.activityLog.create({
      data: {
        userId: adminId,
        actorRole: UserRole.ADMIN,
        action: "KYC_REJECTED",
        resourceType: "user",
        resourceId: userId.toString(),
        meta: { reason }
      }
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

export async function suspendUser(req, res) {
  try {
    const { id } = req.params;
    const { suspended } = req.body; // true or false

    const status = suspended ? VerificationStatus.SUSPENDED : VerificationStatus.VERIFIED;

    await prisma.user.update({
      where: { id: parseInt(id) },
      data: { verificationStatus: status }
    });

    sendSuccess(res, `User ${suspended ? 'suspended' : 'activated'} successfully`);
  } catch (err) {
    sendError(res, "Failed to suspend/activate user", err);
  }
}

export async function updateRates(req, res) {
  try {
    const { category, pricePerUnit } = req.body;

    const rate = await prisma.rate.upsert({
      where: { category },
      update: { pricePerUnit: parseFloat(pricePerUnit) },
      create: { category, pricePerUnit: parseFloat(pricePerUnit) }
    });

    sendSuccess(res, "Rates updated", rate);
  } catch (err) {
    sendError(res, "Failed to update rates", err);
  }
}

export async function getDashboardStats(req, res) {
  try {
    const [userCount, itemCount, transactionCount, revenue] = await prisma.$transaction([
      prisma.user.count(),
      prisma.item.count(),
      prisma.transaction.count(),
      prisma.transaction.aggregate({ _sum: { totalAmount: true } })
    ]);

    sendSuccess(res, "Dashboard stats fetched", {
      users: userCount,
      items: itemCount,
      transactions: transactionCount,
      revenue: revenue._sum.totalAmount || 0
    });
  } catch (err) {
    sendError(res, "Failed to fetch dashboard stats", err);
  }
}
