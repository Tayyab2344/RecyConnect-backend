import { sendError } from '../utils/responseHelper.js'
import { logger } from '../utils/logger.js'

export function errorHandler(err, req, res, next) {
  const status = err.status || 500
  const message = err.message || 'Internal Server Error'
  
  // Dump stack trace to the Database via Winston PrismaTransport
  logger.error(`[CRASH] ${message}`, {
    stack: err.stack,
    path: req.originalUrl || req.url,
    method: req.method,
    ip: req.ip || req.connection?.remoteAddress || 'unknown'
  });

  if (process.env.NODE_ENV !== 'production') {
    console.error(err);
  }
  sendError(res, message, null, status)
}
