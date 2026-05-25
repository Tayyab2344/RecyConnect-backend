import express from 'express';
import {
  getObservabilityTelemetry,
  getAiLogs,
  nlpQuery,
  triggerSelfHealing
} from '../controllers/observabilityController.js';

const router = express.Router();

// Telemetry & Predictions Dashboard
router.get('/telemetry', getObservabilityTelemetry);

// AI Observability Logs list
router.get('/logs', getAiLogs);

// Natural Language AI Analytics Query
router.post('/query', nlpQuery);

// Manual AIOps Self-Healing triggering
router.post('/heal', triggerSelfHealing);

export default router;
