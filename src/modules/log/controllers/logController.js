import { logActivity } from '../../../utils/activityLogger.js';
import { sendSuccess, sendError } from '../../../utils/responseHelper.js';

/**
 * Ingests an array of client-side logs (errors, latency metrics, crashes)
 * and writes them to the ActivityLog for admin observability.
 */
export async function ingestClientLogs(req, res) {
  try {
    const { logs } = req.body;

    if (!Array.isArray(logs) || logs.length === 0) {
      return sendSuccess(res, "No logs provided to ingest");
    }

    // Try to get authenticated user if available
    const userId = req.user?.id || null;
    const role = req.user?.role || null;

    // Process each log asynchronously
    const logPromises = logs.map(async (logData) => {
      // Expect logData format: { action: "API_LATENCY", resourceType: "offline_sync", meta: { ... }, ... }
      return logActivity({
        userId,
        role,
        action: logData.action || "CLIENT_OBSERVATION",
        resourceType: logData.resourceType || "client_log",
        meta: logData.meta || {},
        req
      });
    });

    await Promise.all(logPromises);

    sendSuccess(res, "Client logs ingested successfully");
  } catch (err) {
    console.error("[INGEST_LOGS_ERROR]", err);
    sendError(res, "Failed to ingest client logs", err);
  }
}
