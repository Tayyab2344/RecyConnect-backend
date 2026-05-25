import { sendSuccess, sendError } from '../../../utils/responseHelper.js';
import prisma from '../../../lib/prisma.js';
import {
  getSystemTelemetry,
  getFailurePredictions,
  getSustainabilityFootprint,
  getFraudRiskList,
  askObservabilityAssistant,
  executeAIOpsHeal
} from '../../../services/aiObservabilityService.js';

/**
 * Get comprehensive AI observability telemetry and health.
 */
export async function getObservabilityTelemetry(req, res) {
  try {
    const [telemetry, predictions, sustainability, fraudRisk] = await Promise.all([
      getSystemTelemetry(),
      getFailurePredictions(),
      getSustainabilityFootprint(),
      getFraudRiskList()
    ]);

    sendSuccess(res, 'AI Observability telemetry fetched successfully', {
      telemetry,
      predictions,
      sustainability,
      fraudRisk
    });
  } catch (err) {
    sendError(res, 'Failed to fetch observability telemetry', err);
  }
}

/**
 * Get recent AI event activity logs.
 */
export async function getAiLogs(req, res) {
  try {
    const logs = await prisma.systemLog.findMany({
      where: { type: 'AI' },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    sendSuccess(res, 'AI activity logs retrieved', logs);
  } catch (err) {
    sendError(res, 'Failed to fetch AI activity logs', err);
  }
}

/**
 * Execute a Natural Language Intelligence query about the platform state.
 */
export async function nlpQuery(req, res) {
  try {
    const { message } = req.body;
    if (!message) {
      return sendError(res, 'Query message is required', null, 400);
    }

    const result = await askObservabilityAssistant(message);
    sendSuccess(res, 'Query processed successfully', result);
  } catch (err) {
    sendError(res, 'AI observability query failed', err);
  }
}

/**
 * Trigger an automated self-healing execution event (AIOps).
 */
export async function triggerSelfHealing(req, res) {
  try {
    const { actionName, details } = req.body;
    if (!actionName) {
      return sendError(res, 'AIOps actionName is required', null, 400);
    }

    const result = await executeAIOpsHeal(actionName, details || {});
    sendSuccess(res, 'AIOps self-healing action executed and logged', result);
  } catch (err) {
    sendError(res, 'Failed to execute AIOps self-healing action', err);
  }
}
