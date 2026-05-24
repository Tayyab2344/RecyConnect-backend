/**
 * Admin User Management Controller
 *
 * Provides admin-level user management operations including
 * listing users with filters, and suspending/activating accounts.
 *
 * @module modules/admin/controllers/userManagementController
 */

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
