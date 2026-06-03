import { autoExpireReservations } from '../modules/reservation/controllers/reservationController.js';
import { recalculateLeaderboardRanks } from './rewardService.js';

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

    // Sync database leaderboard ranks every 10 minutes
    setInterval(async () => {
        try {
            console.log('[CRON] Syncing database leaderboard ranks...');
            await recalculateLeaderboardRanks();
            console.log('[CRON] Leaderboard ranks synced successfully.');
        } catch (error) {
            console.error(`[CRON] Leaderboard sync failed:`, error.message);
        }
    }, 10 * 60 * 1000);

    // Keep-Alive Ping (only needed on Render Free Tier)
    // Gated behind env var since paid plans don't sleep
    if (process.env.RENDER_FREE_TIER === 'true') {
        setInterval(async () => {
            try {
                const url = process.env.PUBLIC_URL || 'https://recyconnect-backend.onrender.com';
                const response = await fetch(`${url}/health`);
                console.log(`[CRON] Keep-Alive ping: ${response.status} ${response.statusText}`);
            } catch (error) {
                console.error(`[CRON] Keep-Alive failed:`, error.message);
            }
        }, 14 * 60 * 1000);
    }

    // Add other background tasks here in the future
};
