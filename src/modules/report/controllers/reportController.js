import prisma from '../../../lib/prisma.js';
import { ListingStatus, OrderStatus } from '../../../constants/enums.js';
import { sendSuccess, sendError } from '../../../utils/responseHelper.js';

/**
 * Get dashboard statistics
 * GET /api/reports/dashboard
 * 
 * Optimized: Uses aggregate/count instead of findMany + JS reduce
 */
export const getDashboardStats = async (req, res) => {
    try {
        const userId = req.user.id;

        // Run all independent queries in parallel
        const [
            totalListings,
            totalBuyerOrders,
            pendingBuyerOrders,
            totalSellerOrders,
            soldWeight,
            purchasedWeight
        ] = await Promise.all([
            // Get listing count
            prisma.listing.count({ where: { userId } }),

            // Get buyer order count
            prisma.order.count({ where: { buyerId: userId } }),

            // Get pending buyer orders
            prisma.order.count({ where: { buyerId: userId, status: OrderStatus.PENDING } }),

            // Get seller order count
            prisma.order.count({ where: { sellerId: userId } }),

            // Get total weight SOLD — use aggregate on OrderItem instead of findMany
            prisma.orderItem.aggregate({
                _sum: { quantity: true },
                where: {
                    order: { sellerId: userId, status: OrderStatus.COMPLETED }
                }
            }),

            // Get total weight PURCHASED — use aggregate on OrderItem
            prisma.orderItem.aggregate({
                _sum: { quantity: true },
                where: {
                    order: { buyerId: userId, status: OrderStatus.COMPLETED }
                }
            })
        ]);

        const totalWeightSold = soldWeight._sum.quantity || 0;
        const totalWeightPurchased = purchasedWeight._sum.quantity || 0;

        sendSuccess(res, 'Dashboard stats fetched', {
            selling: {
                totalListings,
                totalWeightSold: parseFloat(totalWeightSold.toFixed(2))
            },
            buying: {
                totalOrders: totalBuyerOrders,
                pendingOrders: pendingBuyerOrders,
                totalWeightPurchased: parseFloat(totalWeightPurchased.toFixed(2))
            },
            asSellerOrders: totalSellerOrders
        });
    } catch (error) {
        sendError(res, 'Failed to fetch dashboard statistics', error);
    }
};

/**
 * Get recent activity feed
 * GET /api/reports/activity
 * 
 * Optimized: Uses select instead of full record fetch
 */
export const getActivity = async (req, res) => {
    try {
        const userId = req.user.id;
        const { limit = 10 } = req.query;
        const take = Math.min(parseInt(limit) || 10, 50);

        // Run listing & order queries in parallel
        const [recentListings, recentOrders] = await Promise.all([
            // Get recent listings with minimal fields
            prisma.listing.findMany({
                where: { userId },
                orderBy: { createdAt: 'desc' },
                take: Math.ceil(take / 2),
                select: {
                    id: true,
                    materialType: true,
                    estimatedWeight: true,
                    status: true,
                    createdAt: true
                }
            }),

            // Get recent orders with minimal includes
            prisma.order.findMany({
                where: { buyerId: userId },
                orderBy: { createdAt: 'desc' },
                take: Math.ceil(take / 2),
                select: {
                    id: true,
                    status: true,
                    createdAt: true,
                    seller: {
                        select: { name: true, businessName: true }
                    },
                    items: {
                        select: {
                            quantity: true,
                            listing: { select: { materialType: true } }
                        }
                    }
                }
            })
        ]);

        // Combine and format activities
        const activities = [
            ...recentListings.map(listing => ({
                id: `listing-${listing.id}`,
                type: 'LISTING',
                action: 'Created listing',
                details: `${listing.materialType} - ${listing.estimatedWeight}kg`,
                status: listing.status,
                timestamp: listing.createdAt
            })),
            ...recentOrders.map(order => {
                const materialTypes = order.items.map(i => i.listing.materialType).join(', ');
                const totalWeight = order.items.reduce((sum, i) => sum + i.quantity, 0);
                return {
                    id: `order-${order.id}`,
                    type: 'ORDER',
                    action: 'Placed order',
                    details: `${materialTypes} - ${totalWeight}kg from ${order.seller?.businessName || order.seller?.name || 'Unknown'}`,
                    status: order.status,
                    timestamp: order.createdAt
                };
            })
        ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, take);

        sendSuccess(res, 'Activity feed fetched', activities);
    } catch (error) {
        sendError(res, 'Failed to fetch activity feed', error);
    }
};

/**
 * Get trend analysis
 * GET /api/reports/trends
 * 
 * Optimized: Uses select to only fetch needed fields + limits data volume
 */
export const getTrends = async (req, res) => {
    try {
        const userId = req.user.id;
        const { months = 6 } = req.query;

        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - parseInt(months));

        // Run queries in parallel with minimal field selection
        const [listings, orders] = await Promise.all([
            prisma.listing.findMany({
                where: {
                    userId,
                    createdAt: { gte: startDate }
                },
                select: {
                    materialType: true,
                    estimatedWeight: true,
                    createdAt: true
                }
            }),

            prisma.order.findMany({
                where: {
                    buyerId: userId,
                    createdAt: { gte: startDate }
                },
                select: {
                    createdAt: true,
                    items: {
                        select: {
                            quantity: true,
                            listing: { select: { materialType: true } }
                        }
                    }
                }
            })
        ]);

        // Group by month and material
        const listingsByMonth = listings.reduce((acc, listing) => {
            const month = new Date(listing.createdAt).toISOString().slice(0, 7); // YYYY-MM
            if (!acc[month]) acc[month] = {};
            if (!acc[month][listing.materialType]) {
                acc[month][listing.materialType] = { count: 0, weight: 0 };
            }
            acc[month][listing.materialType].count += 1;
            acc[month][listing.materialType].weight += listing.estimatedWeight;
            return acc;
        }, {});

        const ordersByMonth = orders.reduce((acc, order) => {
            const month = new Date(order.createdAt).toISOString().slice(0, 7); // YYYY-MM
            if (!acc[month]) acc[month] = {};

            order.items.forEach(item => {
                const mType = item.listing.materialType;
                if (!acc[month][mType]) {
                    acc[month][mType] = { count: 0, weight: 0 };
                }
                acc[month][mType].count += 1;
                acc[month][mType].weight += item.quantity;
            });
            return acc;
        }, {});

        sendSuccess(res, 'Trends fetched', {
            listingsByMonth,
            ordersByMonth
        });
    } catch (error) {
        sendError(res, 'Failed to fetch trends', error);
    }
};
