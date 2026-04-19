import prisma from '../lib/prisma.js';

/**
 * Global Activity Logging Middleware
 * 
 * Automatically logs EVERY API operation (tiny to big) into the ActivityLog table.
 * This runs as response-finish middleware so it captures the final status code.
 * 
 * Skips: health checks, static files, swagger docs, and GET requests to reduce noise
 * (GET reads are optionally logged with LOG_READS=true env var).
 */

// Map HTTP methods + path patterns to human-readable action names
const ACTION_MAP = [
  // Auth
  { method: 'POST', pattern: /\/api\/auth\/register/, action: 'USER_REGISTERED' },
  { method: 'POST', pattern: /\/api\/auth\/login/, action: 'USER_LOGIN' },
  { method: 'POST', pattern: /\/api\/auth\/logout/, action: 'USER_LOGOUT' },
  { method: 'POST', pattern: /\/api\/auth\/verify-otp/, action: 'OTP_VERIFIED' },
  { method: 'POST', pattern: /\/api\/auth\/resend-otp/, action: 'OTP_RESENT' },
  { method: 'POST', pattern: /\/api\/auth\/forgot-password/, action: 'FORGOT_PASSWORD' },
  { method: 'POST', pattern: /\/api\/auth\/reset-password/, action: 'PASSWORD_RESET' },
  { method: 'PUT',  pattern: /\/api\/auth\/change-password/, action: 'PASSWORD_CHANGED' },
  { method: 'POST', pattern: /\/api\/auth\/refresh/, action: 'TOKEN_REFRESHED' },
  { method: 'POST', pattern: /\/api\/auth\/analyze-document/, action: 'DOCUMENT_ANALYZED' },
  { method: 'POST', pattern: /\/api\/auth\/collector/, action: 'COLLECTOR_REGISTERED' },

  // Profile / User
  { method: 'GET',  pattern: /\/api\/auth\/me/, action: 'PROFILE_VIEWED' },
  { method: 'PUT',  pattern: /\/api\/auth\/profile/, action: 'PROFILE_UPDATED' },
  { method: 'PUT',  pattern: /\/api\/user\/profile\/password/, action: 'PASSWORD_CHANGED' },
  { method: 'PUT',  pattern: /\/api\/user\/profile/, action: 'PROFILE_UPDATED' },
  { method: 'POST', pattern: /\/api\/user\/upgrade/, action: 'ROLE_UPGRADE_REQUESTED' },
  { method: 'DELETE', pattern: /\/api\/user\/account/, action: 'ACCOUNT_DELETED' },
  { method: 'GET',  pattern: /\/api\/user\/check-cnic/, action: 'CNIC_CHECKED' },

  // Warehouse
  { method: 'POST', pattern: /\/api\/warehouse\/add-collector/, action: 'COLLECTOR_CREATED' },
  { method: 'GET',  pattern: /\/api\/warehouse\/collectors/, action: 'COLLECTORS_FETCHED' },

  // Collector
  { method: 'GET',  pattern: /\/api\/collector\/dashboard/, action: 'COLLECTOR_DASHBOARD_VIEWED' },

  // Listings
  { method: 'POST', pattern: /\/api\/listings/, action: 'LISTING_CREATED' },
  { method: 'PUT',  pattern: /\/api\/listings\/\d+\/status/, action: 'LISTING_STATUS_UPDATED' },
  { method: 'PUT',  pattern: /\/api\/listings\/\d+/, action: 'LISTING_UPDATED' },
  { method: 'DELETE', pattern: /\/api\/listings\/\d+/, action: 'LISTING_DELETED' },
  { method: 'GET',  pattern: /\/api\/listings\/my/, action: 'MY_LISTINGS_VIEWED' },
  { method: 'GET',  pattern: /\/api\/listings\/marketplace/, action: 'MARKETPLACE_BROWSED' },
  { method: 'GET',  pattern: /\/api\/listings\/\d+/, action: 'LISTING_VIEWED' },
  { method: 'GET',  pattern: /\/api\/listings\/stats/, action: 'LISTING_STATS_VIEWED' },

  // Orders
  { method: 'POST', pattern: /\/api\/orders/, action: 'ORDER_CREATED' },
  { method: 'PUT',  pattern: /\/api\/orders\/\d+\/status/, action: 'ORDER_STATUS_UPDATED' },
  { method: 'PUT',  pattern: /\/api\/orders\/\d+\/cancel/, action: 'ORDER_CANCELLED' },
  { method: 'GET',  pattern: /\/api\/orders\/buyer/, action: 'BUYER_ORDERS_VIEWED' },
  { method: 'GET',  pattern: /\/api\/orders\/seller/, action: 'SELLER_ORDERS_VIEWED' },
  { method: 'GET',  pattern: /\/api\/orders\/\d+/, action: 'ORDER_VIEWED' },

  // Payments
  { method: 'POST', pattern: /\/api\/payments\/intent/, action: 'PAYMENT_INTENT_CREATED' },
  { method: 'POST', pattern: /\/api\/payments\/confirm/, action: 'PAYMENT_CONFIRMED' },
  { method: 'POST', pattern: /\/api\/payments\/cod/, action: 'COD_PAYMENT_CREATED' },

  // Reservations
  { method: 'POST', pattern: /\/api\/reservations/, action: 'RESERVATION_CREATED' },
  { method: 'PUT',  pattern: /\/api\/reservations\/\d+\/cancel/, action: 'RESERVATION_CANCELLED' },

  // Items
  { method: 'POST', pattern: /\/api\/items/, action: 'ITEM_CREATED' },
  { method: 'DELETE', pattern: /\/api\/items\/\d+/, action: 'ITEM_DELETED' },
  { method: 'GET',  pattern: /\/api\/items/, action: 'ITEMS_VIEWED' },

  // Transactions
  { method: 'POST', pattern: /\/api\/transactions/, action: 'TRANSACTION_CREATED' },
  { method: 'PUT',  pattern: /\/api\/transactions\/\d+/, action: 'TRANSACTION_UPDATED' },
  { method: 'GET',  pattern: /\/api\/transactions/, action: 'TRANSACTIONS_VIEWED' },

  // Chat
  { method: 'POST', pattern: /\/api\/chat\/conversations/, action: 'CONVERSATION_STARTED' },
  { method: 'POST', pattern: /\/api\/chat\/messages/, action: 'MESSAGE_SENT' },
  { method: 'GET',  pattern: /\/api\/chat\/conversations/, action: 'CONVERSATIONS_VIEWED' },
  { method: 'GET',  pattern: /\/api\/chat\/messages/, action: 'MESSAGES_VIEWED' },

  // KYC
  { method: 'POST', pattern: /\/api\/kyc\/submit/, action: 'KYC_SUBMITTED' },
  { method: 'PUT',  pattern: /\/api\/kyc\/approve/, action: 'KYC_APPROVED' },
  { method: 'PUT',  pattern: /\/api\/kyc\/reject/, action: 'KYC_REJECTED' },
  { method: 'GET',  pattern: /\/api\/kyc\/status/, action: 'KYC_STATUS_VIEWED' },

  // Admin
  { method: 'GET',  pattern: /\/api\/admin\/users/, action: 'ADMIN_USERS_VIEWED' },
  { method: 'GET',  pattern: /\/api\/admin\/orders/, action: 'ADMIN_ORDERS_VIEWED' },
  { method: 'GET',  pattern: /\/api\/admin\/payments/, action: 'ADMIN_PAYMENTS_VIEWED' },
  { method: 'GET',  pattern: /\/api\/admin\/listings/, action: 'ADMIN_LISTINGS_VIEWED' },
  { method: 'GET',  pattern: /\/api\/admin\/dashboard/, action: 'ADMIN_DASHBOARD_VIEWED' },
  { method: 'GET',  pattern: /\/api\/admin\/kyc/, action: 'ADMIN_KYC_VIEWED' },
  { method: 'GET',  pattern: /\/api\/admin\/logs/, action: 'ADMIN_LOGS_VIEWED' },
  { method: 'PUT',  pattern: /\/api\/admin\/rates/, action: 'RATE_UPDATED' },
  { method: 'POST', pattern: /\/api\/admin\/rates/, action: 'RATE_CREATED' },
  { method: 'DELETE', pattern: /\/api\/admin\/rates/, action: 'RATE_DELETED' },
  { method: 'PUT',  pattern: /\/api\/admin\/users\/\d+\/suspend/, action: 'USER_SUSPENDED' },
  { method: 'POST', pattern: /\/api\/admin\/kyc\/approve/, action: 'KYC_APPROVED_BY_ADMIN' },
  { method: 'POST', pattern: /\/api\/admin\/kyc\/reject/, action: 'KYC_REJECTED_BY_ADMIN' },
  { method: 'GET',  pattern: /\/api\/admin\/reports/, action: 'ADMIN_REPORTS_VIEWED' },
  { method: 'GET',  pattern: /\/api\/admin\/monitoring/, action: 'ADMIN_MONITORING_VIEWED' },

  // Reports
  { method: 'GET',  pattern: /\/api\/reports/, action: 'REPORTS_VIEWED' },

  // App
  { method: 'GET',  pattern: /\/api\/app\/rates/, action: 'RATES_FETCHED' },
  { method: 'GET',  pattern: /\/api\/app\/sync/, action: 'APP_SYNCED' },

  // Batch
  { method: 'GET',  pattern: /\/api\/batch/, action: 'BATCH_DATA_FETCHED' },

  // Logs
  { method: 'POST', pattern: /\/api\/logs/, action: 'CLIENT_LOGS_INGESTED' },
];

// Paths to skip logging entirely (reduce noise)
const SKIP_PATHS = [
  '/health',
  '/api-docs',
  '/favicon.ico',
  '/uploads',
];

function resolveAction(method, path) {
  for (const entry of ACTION_MAP) {
    if (entry.method === method && entry.pattern.test(path)) {
      return entry.action;
    }
  }
  // Fallback: generate action from method + path
  const cleanPath = path.replace(/\/api\//, '').replace(/\/\d+/g, '/:id').replace(/\//g, '_').toUpperCase();
  return `${method}_${cleanPath}`;
}

function extractResourceInfo(path) {
  // Try to extract resource type and ID from path
  const match = path.match(/\/api\/(\w+)(?:\/(\d+))?/);
  if (match) {
    return {
      resourceType: match[1],
      resourceId: match[2] || null,
    };
  }
  return { resourceType: null, resourceId: null };
}

/**
 * Express middleware — attach to app BEFORE routes.
 * It hooks into res.finish to log after the response is sent.
 */
export function activityLogMiddleware(req, res, next) {
  // Skip noise paths
  if (SKIP_PATHS.some(p => req.path.startsWith(p))) {
    return next();
  }

  // Skip GET requests unless LOG_READS is true (to reduce DB writes)
  const logReads = process.env.LOG_READS === 'true';
  if (req.method === 'GET' && !logReads) {
    return next();
  }

  const startTime = Date.now();

  // Hook into response finish
  res.on('finish', async () => {
    try {
      const duration = Date.now() - startTime;
      const action = resolveAction(req.method, req.originalUrl || req.path);
      const { resourceType, resourceId } = extractResourceInfo(req.originalUrl || req.path);
      const isSuccess = res.statusCode >= 200 && res.statusCode < 400;

      // Build meta object with useful context
      const meta = {
        method: req.method,
        path: req.originalUrl || req.path,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        success: isSuccess,
      };

      // Add request body keys (not values for security) for mutation operations
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.body) {
        meta.bodyKeys = Object.keys(req.body);
      }

      // Add query params for GET requests
      if (req.method === 'GET' && req.query && Object.keys(req.query).length > 0) {
        meta.query = req.query;
      }

      await prisma.activityLog.create({
        data: {
          userId: req.user?.id || null,
          actorRole: req.user?.role || 'anonymous',
          action: isSuccess ? action : `FAILED_${action}`,
          resourceType,
          resourceId: resourceId?.toString() || null,
          meta,
          ip: req.ip || req.headers?.['x-forwarded-for'] || req.connection?.remoteAddress,
          userAgent: req.headers?.['user-agent'],
        },
      });
    } catch (err) {
      // Never crash the app because of logging — silently log to console
      console.error('[ACTIVITY_LOG_MIDDLEWARE_ERROR]', err.message);
    }
  });

  next();
}
