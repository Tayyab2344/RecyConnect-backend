import prisma from '../lib/prisma.js';
import { sendSuccess, sendError } from '../utils/responseHelper.js';

/**
 * Get Analytics Snapshot for Admin Dashboard
 * GET /api/admin/monitoring/analytics
 */
export const getAnalyticsSnapshot = async (req, res) => {
    try {
        // Run all queries in parallel for maximum speed
        const [
            totalUsers,
            activeListings,
            totalSystemErrors,
            totalApiRequests,
            slowQueries
        ] = await Promise.all([
            prisma.user.count({ where: { deletedAt: null } }),
            prisma.listing.count({ where: { status: 'PUBLISHED' } }),
            prisma.systemLog.count({ where: { level: 'error' } }),
            prisma.systemLog.count({ where: { type: 'API' } }),
            prisma.systemLog.count({
                where: {
                    type: 'API',
                    message: { contains: 'SLOW API' }
                }
            })
        ]);

        sendSuccess(res, 'System analytics retrieved', {
            users: { total: totalUsers },
            marketplace: { activeListings },
            health: {
                totalSystemErrors,
                totalApiRequests,
                slowQueriesCount: slowQueries
            }
        });
    } catch (error) {
        sendError(res, 'Failed to fetch analytics', error);
    }
};

/**
 * Get Recent System Errors directly from DB
 * GET /api/admin/monitoring/errors
 */
export const getRecentErrors = async (req, res) => {
    try {
        const errors = await prisma.systemLog.findMany({
            where: { level: 'error' },
            orderBy: { createdAt: 'desc' },
            take: 50
        });

        sendSuccess(res, 'Recent errors retrieved', errors);
    } catch (error) {
        sendError(res, 'Failed to fetch system errors', error);
    }
};

/**
 * Get Slow Endpoint Traces
 * GET /api/admin/monitoring/slow-endpoints
 */
export const getSlowEndpoints = async (req, res) => {
    try {
        const slowLogs = await prisma.systemLog.findMany({
            where: {
                type: 'API',
                message: { contains: 'SLOW' }
            },
            orderBy: { createdAt: 'desc' },
            take: 50
        });

        sendSuccess(res, 'Slow endpoint traces retrieved', slowLogs);
    } catch (error) {
        sendError(res, 'Failed to fetch slow endpoints', error);
    }
};
