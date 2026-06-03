import pusher from '../../../lib/pusher.js';
import { logger } from '../../../utils/logger.js';

/**
 * Initialize Pusher Gateway.
 * (Acts as a no-op for the local HTTP socket server since Pusher handles connections).
 *
 * @param {import('http').Server} httpServer - Node HTTP server instance
 * @returns {null}
 */
export function initSocketGateway(httpServer) {
  logger.info('[PUSHER] Gateway initialized (Adapter Mode)');
  return null;
}

/**
 * Get a Socket.io-compatible wrapper instance for Pusher broadcasting.
 *
 * @returns {object|null}
 */
export function getIO() {
  if (!pusher) return null;
  return {
    to: (room) => {
      return {
        emit: (event, data) => {
          let channel = room;
          // Translate Socket.io rooms to Pusher channel names
          // Socket.io 'user:123' -> Pusher 'private-user-123'
          // Socket.io 'task:456' -> Pusher 'private-task-456'
          if (typeof room === 'string') {
            if (room.startsWith('user:')) {
              channel = `private-user-${room.split(':')[1]}`;
            } else if (room.startsWith('warehouse:')) {
              channel = `private-warehouse-${room.split(':')[1]}`;
            } else if (room.startsWith('task:')) {
              channel = `private-task-${room.split(':')[1]}`;
            } else if (room.startsWith('trip:')) {
              channel = `private-trip-${room.split(':')[1]}`;
            } else if (room.startsWith('chat:')) {
              channel = `private-chat-${room.split(':')[1]}`;
            }
          }
          
          pusher.trigger(channel, event, data).catch((err) => {
            logger.error(`[PUSHER] Trigger failed for channel ${channel}, event ${event}:`, err.message);
          });
        }
      };
    }
  };
}

/**
 * Check if a user is currently online by querying Pusher's presence-online channel.
 *
 * @param {number} userId
 * @returns {Promise<boolean>}
 */
export async function isUserOnline(userId) {
  if (!pusher) return false;
  try {
    const presence = await pusher.get({ path: '/channels/presence-online/users' });
    if (presence && presence.users) {
      return presence.users.some(u => parseInt(u.id) === parseInt(userId));
    }
  } catch (err) {
    logger.warn(`[PUSHER] Failed to check online status for user ${userId}:`, err.message);
  }
  return false;
}
