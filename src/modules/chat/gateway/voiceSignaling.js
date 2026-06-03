import { logger } from '../../../utils/logger.js';

/**
 * Mount voice signaling events on the Socket.io server.
 * (No-op since WebRTC voice calling is not used).
 *
 * @param {object} io - SocketGateway instance
 */
export function initVoiceSignaling(io) {
  logger.info('[VOICE] WebRTC voice signaling disabled (no-op)');
}
