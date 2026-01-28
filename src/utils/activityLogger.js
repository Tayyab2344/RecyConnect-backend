import prisma from '../lib/prisma.js';

/**
 * Logs a user activity to the database.
 * 
 * @param {Object} params - Logging parameters
 * @param {number} [params.userId] - ID of the user performing the action
 * @param {string} [params.role] - Role of the user at the time of the action
 * @param {string} params.action - Action performed (e.g., 'LOGIN', 'CREATE_LISTING')
 * @param {string} [params.resourceType] - Type of resource (e.g., 'LISTING', 'ORDER')
 * @param {string|number} [params.resourceId] - ID of the resource being acted upon
 * @param {Object} [params.meta] - Additional metadata for the action
 * @param {Object} [params.req] - Express request object to extract IP and UserAgent
 */
export const logActivity = async ({
    userId,
    role,
    action,
    resourceType,
    resourceId,
    meta = {},
    req = null
}) => {
    try {
        const data = {
            action,
            userId: userId || (req?.user?.id),
            actorRole: role || (req?.user?.role),
            resourceType,
            resourceId: resourceId?.toString(),
            meta: meta || {},
            ip: req?.ip || req?.headers?.['x-forwarded-for'] || req?.connection?.remoteAddress,
            userAgent: req?.headers?.['user-agent']
        };

        await prisma.activityLog.create({
            data
        });
    } catch (error) {
        // We don't want to crash the request if logging fails, but we should log it to the console
        console.error('[ACTIVITY_LOGGER_ERROR]', error);
    }
};

export default logActivity;
