/**
 * Admin Log Controller
 *
 * Provides system activity log retrieval for admin oversight.
 *
 * @module modules/admin/controllers/logController
 */

import { sendSuccess, sendPaginated, sendError } from "../../../utils/responseHelper.js";
import { getPaginationParams } from "../../../utils/queryHelper.js";
import prisma from "../../../lib/prisma.js";

/**
 * Fetch system activity logs with optional filters and pagination.
 *
 * @param {import('express').Request} req - Express request with optional `query.role`, `query.action`, `query.userId`
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>}
 */
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
      include: { actor: { select: { name: true, email: true, role: true } } },
    });

    sendPaginated(res, logs, totalCount, pageNum, limitNum);
  } catch (err) {
    sendError(res, "Failed to fetch system logs", err);
  }
}

/**
 * Fetch a single activity log entry by ID.
 *
 * @param {import('express').Request} req - Express request with `params.id`
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>}
 */
export async function getLogById(req, res) {
  try {
    const { id } = req.params;
    const log = await prisma.activityLog.findUnique({
      where: { id: parseInt(id) },
      include: { actor: { select: { name: true, email: true, role: true } } },
    });

    if (!log) return sendError(res, "Log not found", null, 404);

    sendSuccess(res, "Log fetched", log);
  } catch (err) {
    sendError(res, "Failed to fetch log", err);
  }
}
