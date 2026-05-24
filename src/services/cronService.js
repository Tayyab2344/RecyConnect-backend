import { autoExpireReservations } from '../modules/reservation/controllers/reservationController.js';

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

    // Keep-Alive Ping (Prevent Render Free Tier from sleeping)
    // Runs every 14 minutes to beat Render's 15-minute inactivity timer
    setInterval(async () => {
        try {
            // Self-ping the external Render URL to keep the instance awake
            const url = process.env.PUBLIC_URL || 'https://recyconnect-backend.onrender.com';
            const response = await fetch(`${url}/health`);
            console.log(`[CRON] Keep-Alive ping: ${response.status} ${response.statusText}`);
        } catch (error) {
            console.error(`[CRON] Keep-Alive failed:`, error.message);
        }
    }, 14 * 60 * 1000);

    // Add other background tasks here in the future
};
