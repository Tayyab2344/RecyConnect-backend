/**
 * Admin KYC Controller
 *
 * Handles Know-Your-Customer verification workflows for admin users.
 * Includes fetching pending verifications, approving, and rejecting KYC requests.
 *
 * @module modules/admin/controllers/kycController
 */

import { UserRole, VerificationStatus, KycStage } from "../../../constants/enums.js";
import { sendSuccess, sendError } from "../../../utils/responseHelper.js";
import prisma from "../../../lib/prisma.js";
import { logActivity } from "../../../utils/activityLogger.js";

/**
 * Fetch all users with pending KYC verification.
 *
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>}
 */
export async function getPendingKYCUsers(req, res) {
  try {
    const users = await prisma.user.findMany({
      where: {
        verificationStatus: VerificationStatus.PENDING,
        role: { in: [UserRole.WAREHOUSE, UserRole.COMPANY] },
        kycStage: { in: [KycStage.DOCUMENTS_UPLOADED, "OCR_VERIFIED"] },
      },
      include: {
        documents: true,
        ocrDatas: true,
      },
      orderBy: { createdAt: "desc" },
    });

    sendSuccess(res, "Pending KYC users fetched", users);
  } catch (err) {
    sendError(res, "Failed to fetch pending KYC users", err);
  }
}

/**
 * Approve a user's KYC verification request.
 * Optionally upgrades the user's role if a requestedRole is set.
 *
 * @param {import('express').Request} req - Express request with `body.userId`
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>}
 */
export async function approveKYC(req, res) {
  try {
    const { userId } = req.body;
    const adminId = req.user.id;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return sendError(res, "User not found", null, 404);

    const updateData = {
      verificationStatus: VerificationStatus.VERIFIED,
      kycStage: KycStage.VERIFIED,
      rejectionReason: null,
    };

    // Upgrade role if the user had a pending role request
    if (user.requestedRole) {
      updateData.role = user.requestedRole;
      updateData.requestedRole = null;
    }

    await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    await logActivity({
      userId: adminId,
      role: UserRole.ADMIN,
      action: "KYC_APPROVED",
      resourceType: "user",
      resourceId: userId.toString(),
      meta: {
        previousRole: user.role,
        newRole: updateData.role || user.role,
      },
      req,
    });

    sendSuccess(res, "User approved successfully");
  } catch (err) {
    sendError(res, "Failed to approve KYC", err);
  }
}

/**
 * Reject a user's KYC verification request with a reason.
 *
 * @param {import('express').Request} req - Express request with `body.userId` and `body.reason`
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>}
 */
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
        kycStage: VerificationStatus.REJECTED,
        rejectionReason: reason,
      },
    });

    await logActivity({
      userId: adminId,
      role: UserRole.ADMIN,
      action: "KYC_REJECTED",
      resourceType: "user",
      resourceId: userId.toString(),
      meta: { reason },
      req,
    });

    sendSuccess(res, "User rejected successfully");
  } catch (err) {
    sendError(res, "Failed to reject KYC", err);
  }
}
