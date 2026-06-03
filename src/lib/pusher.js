import Pusher from 'pusher';
import { logger } from '../utils/logger.js';

let pusher = null;

const PUSHER_APP_ID = process.env.PUSHER_APP_ID;
const PUSHER_KEY = process.env.PUSHER_KEY;
const PUSHER_SECRET = process.env.PUSHER_SECRET;
const PUSHER_CLUSTER = process.env.PUSHER_CLUSTER;

if (PUSHER_APP_ID && PUSHER_KEY && PUSHER_SECRET && PUSHER_CLUSTER) {
  try {
    pusher = new Pusher({
      appId: PUSHER_APP_ID,
      key: PUSHER_KEY,
      secret: PUSHER_SECRET,
      cluster: PUSHER_CLUSTER,
      useTLS: true,
    });
    logger.info('[PUSHER] Client initialized successfully');
  } catch (err) {
    logger.error('[PUSHER] Initialization failed:', err.message);
  }
} else {
  logger.warn('[PUSHER] Missing environment variables. Real-time broadcasting disabled.');
}

export default pusher;
