import { logger } from '../utils/logger.js';

/**
 * Performance Monitoring Middleware
 * 
 * Intercepts HTTP requests to measure response time exactly when the response finishes.
 * Automatically dumps slow requests (>300ms) or errors (>=400) directly into the
 * Neon database via the Winston Prisma Transport.
 */
export const performanceMonitor = (req, res, next) => {
    // Record start time using high-resolution time
    const startHrTime = process.hrtime();

    res.on('finish', () => {
        const elapsedHrTime = process.hrtime(startHrTime);
        const elapsedMs = (elapsedHrTime[0] * 1000 + elapsedHrTime[1] / 1000000).toFixed(2);
        
        const statusCode = res.statusCode;
        const endpoint = req.originalUrl || req.url;
        const method = req.method;

        // Extract potential user from auth middleware
        const userId = req.user?.id || 'anonymous';
        const ip = req.ip || req.connection?.remoteAddress || 'unknown';

        const meta = {
            type: 'API',
            endpoint,
            method,
            statusCode,
            responseTime: `${elapsedMs}ms`,
            userId,
            ip,
            traceId: req.traceId
        };

        const message = `[API] ${method} ${endpoint} - ${statusCode} - ${elapsedMs}ms`;

        if (statusCode >= 500) {
            // Server Errors
            logger.error(message, meta);
        } else if (statusCode >= 400) {
            // Client Errors
            logger.warn(message, meta);
        } else if (parseFloat(elapsedMs) > 300) {
            // Slow Requests Warning
            logger.warn(`[SLOW API] ${message}`, meta);
        }
        
        // Note: We deliberately DO NOT log every successful 200/201 response to the DB 
        // to prevent Postgres disk bloat on high traffic public loops. We only store anomalies.
    });

    next();
};
