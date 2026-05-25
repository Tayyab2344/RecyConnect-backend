/**
 * Admin Monitoring Controller
 *
 * System health monitoring — analytics snapshots, error tracking,
 * and slow endpoint detection for the admin control panel.
 *
 * @module modules/admin/controllers/monitoringController
 */

import prisma from "../../../lib/prisma.js";
import { sendSuccess, sendError } from "../../../utils/responseHelper.js";

/**
 * Get a comprehensive analytics snapshot including user counts,
 * marketplace activity, and system health indicators.
 *
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>}
 */
export const getAnalyticsSnapshot = async (req, res) => {
  try {
    const [
      totalUsers,
      activeListings,
      totalSystemErrors,
      totalApiRequests,
      slowQueries,
    ] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.listing.count({ where: { status: "PUBLISHED" } }),
      prisma.systemLog.count({ where: { level: "error" } }),
      prisma.systemLog.count({ where: { type: "API" } }),
      prisma.systemLog.count({
        where: {
          type: "API",
          message: { contains: "SLOW API" },
        },
      }),
    ]);

    sendSuccess(res, "System analytics retrieved", {
      users: { total: totalUsers },
      marketplace: { activeListings },
      health: {
        totalSystemErrors,
        totalApiRequests,
        slowQueriesCount: slowQueries,
      },
    });
  } catch (error) {
    sendError(res, "Failed to fetch analytics", error);
  }
};

/**
 * Retrieve the most recent system errors from the database.
 *
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>}
 */
export const getRecentErrors = async (req, res) => {
  try {
    const errors = await prisma.systemLog.findMany({
      where: { level: "error" },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    sendSuccess(res, "Recent errors retrieved", errors);
  } catch (error) {
    sendError(res, "Failed to fetch system errors", error);
  }
};

/**
 * Retrieve API endpoint traces that exceeded acceptable response times.
 *
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>}
 */
export const getSlowEndpoints = async (req, res) => {
  try {
    const slowLogs = await prisma.systemLog.findMany({
      where: {
        type: "API",
        message: { contains: "SLOW" },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    sendSuccess(res, "Slow endpoint traces retrieved", slowLogs);
  } catch (error) {
    sendError(res, "Failed to fetch slow endpoints", error);
  }
};
