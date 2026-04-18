import prisma from '../lib/prisma.js';
import { sendSuccess, sendError } from '../utils/responseHelper.js';
import { OrderStatus, ListingStatus } from '../constants/enums.js';

/**
 * Get unified app initial data payload
 * GET /api/app/bootstrap
 * 
 * Reduces API noise: combines user profile, dashboard stats,
 * and key notifications into a single rapid fetch to achieve
 * "1 optimized response instead of 5".
 */
export const syncAppInit = async (req, res) => {
    try {
        const userId = req.user.id;

        // Fetch everything in parallel
        const [
            user,
            unreadMessages,
            dashboardStats
        ] = await Promise.all([
            // 1. User Profile Data
            prisma.user.findUnique({
                where: { id: userId },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                    profileImage: true,
                    businessName: true,
                    contactNo: true,
                    verificationStatus: true,
                    city: true,
                    area: true
                }
            }),

            // 2. Unread Messages / Notifications
            prisma.message.count({
                where: {
                    conversation: {
                        OR: [
                            { participant1Id: userId },
                            { participant2Id: userId }
                        ]
                    },
                    senderId: { not: userId },
                    isRead: false
                }
            }),

            // 3. Quick Dashboard Stats (Optimized Aggregate)
            req.user.role === 'buyer' 
                ? prisma.order.count({ where: { buyerId: userId, status: OrderStatus.PENDING } })
                : prisma.listing.count({ where: { userId: userId, status: ListingStatus.DRAFT } })
        ]);

        if (!user) {
            return sendError(res, 'User not found', null, 404);
        }

        sendSuccess(res, 'App bootstrap data synced', {
            user,
            activity: {
                unreadMessages,
                pendingActionCount: dashboardStats
            },
            serverTime: new Date()
        });
    } catch (error) {
        sendError(res, 'Failed to sync app data', error);
    }
};
