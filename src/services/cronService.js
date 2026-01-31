import { autoExpireReservations } from '../controllers/reservationController.js';

/**
 * Simple cron-like service to handle background maintenance tasks
 */
export const initCronJobs = () => {
    console.log('[CRON] Initializing background tasks...');

    // Run reservation expiration check every 2 minutes
    // A 2-minute interval is frequent enough for a 20-minute TTL
    setInterval(async () => {
        const result = await autoExpireReservations();
        if (result.count > 0) {
            console.log(`[CRON] Auto-expired ${result.count} reservations.`);
        }
    }, 2 * 60 * 1000);

    // Add other background tasks here in the future
};
