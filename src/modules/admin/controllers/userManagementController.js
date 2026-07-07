/**
 * Admin User Management Controller
 *
 * Provides admin-level user management operations including
 * listing users with filters, and suspending/activating accounts.
 *
 * @module modules/admin/controllers/userManagementController
 */

import bcrypt from "bcrypt";
import { VerificationStatus } from "../../../constants/enums.js";
import { sendSuccess, sendError } from "../../../utils/responseHelper.js";
import { buildSearchFilter } from "../../../utils/queryHelper.js";
import prisma from "../../../lib/prisma.js";
import { logActivity } from "../../../utils/activityLogger.js";

/**
 * Fetch all users with optional role and search filters.
 *
 * @param {import('express').Request} req - Express request with optional `query.role` and `query.search`
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>}
 */
export async function getUsers(req, res) {
  try {
    const { role, search } = req.query;
    const where = {};

    if (role) where.role = role;

    if (search) {
      Object.assign(where, buildSearchFilter(search, ["name", "email"]));
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        contactNo: true,
        city: true,
        area: true,
        businessName: true,
        companyName: true,
        verificationStatus: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    sendSuccess(res, "Users fetched", users);
  } catch (err) {
    sendError(res, "Failed to fetch users", err);
  }
}

/**
 * Suspend or activate a user account.
 *
 * @param {import('express').Request} req - Express request with `params.id` and `body.suspended`
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>}
 */
export async function suspendUser(req, res) {
  try {
    const { id } = req.params;
    const { suspended } = req.body;

    const status = suspended
      ? VerificationStatus.SUSPENDED
      : VerificationStatus.VERIFIED;

    await prisma.user.update({
      where: { id: parseInt(id) },
      data: { verificationStatus: status },
    });

    await logActivity({
      action: suspended ? "USER_SUSPENDED" : "USER_ACTIVATED",
      resourceType: "user",
      resourceId: id,
      meta: { status },
      req,
    });

    sendSuccess(res, `User ${suspended ? "suspended" : "activated"} successfully`);
  } catch (err) {
    sendError(res, "Failed to suspend/activate user", err);
  }
}

/**
 * Ban a fraudulent user account.
 */
export async function banUser(req, res) {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    await prisma.user.update({
      where: { id: parseInt(id) },
      data: { 
        verificationStatus: VerificationStatus.BLOCKED,
        rejectionReason: reason || "Banned by administrator"
      },
    });

    // Revoke all sessions for this banned user immediately
    await prisma.refreshToken.updateMany({
      where: { userId: parseInt(id) },
      data: { revoked: true }
    });

    await logActivity({
      action: "USER_BANNED",
      resourceType: "user",
      resourceId: id,
      meta: { reason },
      req,
    });

    sendSuccess(res, `User banned successfully`);
  } catch (err) {
    sendError(res, "Failed to ban user", err);
  }
}

/**
 * Manually reset a user's password.
 */
export async function resetUserPassword(req, res) {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return sendError(res, "Password must be at least 6 characters long", null, 400);
    }

    const hashed = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: parseInt(id) },
      data: { password: hashed },
    });

    // Revoke all active sessions so they must sign in again
    await prisma.refreshToken.updateMany({
      where: { userId: parseInt(id) },
      data: { revoked: true }
    });

    await logActivity({
      action: "USER_PASSWORD_RESET_BY_ADMIN",
      resourceType: "user",
      resourceId: id,
      req,
    });

    sendSuccess(res, `User password reset successfully`);
  } catch (err) {
    sendError(res, "Failed to reset password", err);
  }
}

/**
 * Fetch all active sessions (refresh tokens) with browser/device info.
 */
export async function getActiveSessions(req, res) {
  try {
    const sessions = await prisma.refreshToken.findMany({
      where: { revoked: false, expiresAt: { gte: new Date() } },
      include: {
        user: {
          select: { id: true, name: true, email: true, role: true, businessName: true, companyName: true }
        }
      },
      orderBy: { createdAt: "desc" }
    });

    // Fetch corresponding login activities to map metadata
    const logs = await prisma.activityLog.findMany({
      where: { action: "LOGIN" },
      orderBy: { createdAt: "desc" },
      take: 200
    });

    const sessionsWithDevice = sessions.map(session => {
      // Find matching activity log within close time range (e.g. 60s)
      const match = logs.find(log => 
        log.userId === session.userId && 
        Math.abs(new Date(log.createdAt) - new Date(session.createdAt)) < 60000
      );

      const userAgentStr = match?.userAgent || "unknown";
      let device = "Other / API";
      if (userAgentStr !== "unknown") {
        const ua = userAgentStr.toLowerCase();
        if (ua.includes("dart") || ua.includes("flutter")) {
          device = "Mobile App (Flutter)";
        } else if (ua.includes("chrome")) {
          device = "Chrome Browser";
        } else if (ua.includes("firefox")) {
          device = "Firefox Browser";
        } else if (ua.includes("safari")) {
          device = "Safari Browser";
        } else if (ua.includes("edge")) {
          device = "Edge Browser";
        } else if (ua.includes("postman")) {
          device = "Postman Client";
        } else {
          device = "Web Browser";
        }
      }

      return {
        id: session.id,
        userId: session.userId,
        userName: session.user?.name || session.user?.businessName || session.user?.companyName || "System/Admin",
        userEmail: session.user?.email || "—",
        userRole: session.user?.role || "—",
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        device: device,
        ip: match?.ip || "unknown",
        userAgent: userAgentStr
      };
    });

    sendSuccess(res, "Active sessions fetched", sessionsWithDevice);
  } catch (err) {
    sendError(res, "Failed to fetch active sessions", err);
  }
}

/**
 * Revoke a specific session/token.
 */
export async function revokeSession(req, res) {
  try {
    const { id } = req.params;

    const token = await prisma.refreshToken.findUnique({
      where: { id: parseInt(id) }
    });

    if (!token) {
      return sendError(res, "Session not found", null, 404);
    }

    await prisma.refreshToken.update({
      where: { id: parseInt(id) },
      data: { revoked: true }
    });

    await logActivity({
      action: "SESSION_REVOKED_BY_ADMIN",
      resourceType: "session",
      resourceId: id,
      meta: { targetUserId: token.userId },
      req,
    });

    sendSuccess(res, `Session terminated successfully`);
  } catch (err) {
    sendError(res, "Failed to revoke session", err);
  }
}
