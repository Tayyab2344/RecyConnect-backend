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

/**
 * Get dynamic market rates (creates default categories if empty)
 * GET /api/app/rates
 */
export const getPublicRates = async (req, res) => {
    try {
        let rates = await prisma.rate.findMany({ orderBy: { category: "asc" } });

        // Auto-seed default categories if empty
        if (rates.length === 0) {
            await prisma.rate.createMany({
                data: [
                    { category: 'Plastic', pricePerUnit: 20, unit: 'kg' },
                    { category: 'Metal', pricePerUnit: 40, unit: 'kg' },
                    { category: 'E-Waste', pricePerUnit: 100, unit: 'kg' },
                    { category: 'Paper', pricePerUnit: 15, unit: 'kg' }
                ],
                skipDuplicates: true
            });
            rates = await prisma.rate.findMany({ orderBy: { category: "asc" } });
        }

        sendSuccess(res, "Rates fetched", rates);
    } catch (error) {
        sendError(res, "Failed to fetch rates", error);
    }
};
