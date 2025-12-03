import { PrismaClient } from '@prisma/client';
import { ListingStatus, OrderStatus } from '../constants/enums.js';
import { sendSuccess, sendError } from '../utils/responseHelper.js';

const prisma = new PrismaClient();

/**
 * Get dashboard statistics
 * GET /api/reports/dashboard
 */
export const getDashboardStats = async (req, res) => {
    try {
        const userId = req.user.id;

        // Get listing stats
        const totalListings = await prisma.listing.count({
            where: { userId }
        });

        const pendingListings = await prisma.listing.count({
            where: { userId, status: ListingStatus.PENDING }
        });

        const completedListings = await prisma.listing.count({
            where: { userId, status: ListingStatus.COMPLETED }
        });

        // Get order stats (as buyer)
        const totalBuyerOrders = await prisma.order.count({
            where: { buyerId: userId }
        });

        const pendingBuyerOrders = await prisma.order.count({
            where: { buyerId: userId, status: OrderStatus.PENDING }
        });

        // Get order stats (as seller)
        const totalSellerOrders = await prisma.order.count({
            where: { sellerId: userId }
        });

        // Get total weight sold
        const soldListings = await prisma.listing.findMany({
            where: { userId, status: ListingStatus.COMPLETED },
            select: { estimatedWeight: true }
        });

        const totalWeightSold = soldListings.reduce(
            (sum, listing) => sum + listing.estimatedWeight,
            0
        );

        // Get total weight purchased
        const purchasedOrders = await prisma.order.findMany({
            where: { buyerId: userId, status: OrderStatus.COMPLETED },
            select: { weight: true }
        });

        const totalWeightPurchased = purchasedOrders.reduce(
            (sum, order) => sum + order.weight,
            0
        );

        sendSuccess(res, 'Dashboard stats fetched', {
            selling: {
                totalListings,
                pendingListings,
                completedListings,
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
 */
export const getActivity = async (req, res) => {
    try {
        const userId = req.user.id;
        const { limit = 10 } = req.query;

        // Get recent listings
        const recentListings = await prisma.listing.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: parseInt(limit) / 2,
            select: {
                id: true,
                materialType: true,
                estimatedWeight: true,
                status: true,
                createdAt: true
            }
        });

        // Get recent orders (as buyer)
        const recentOrders = await prisma.order.findMany({
            where: { buyerId: userId },
            orderBy: { createdAt: 'desc' },
            take: parseInt(limit) / 2,
            include: {
                seller: {
                    select: {
                        name: true,
                        email: true
                    }
                }
            }
        });

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
            ...recentOrders.map(order => ({
                id: `order-${order.id}`,
                type: 'ORDER',
                action: 'Placed order',
                details: `${order.materialType} - ${order.weight}kg from ${order.seller?.name || 'Unknown'}`,
                status: order.status,
                timestamp: order.createdAt
            }))
        ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, parseInt(limit));

        sendSuccess(res, 'Activity feed fetched', activities);
    } catch (error) {
        sendError(res, 'Failed to fetch activity feed', error);
    }
};

/**
 * Get trend analysis
 * GET /api/reports/trends
 */
export const getTrends = async (req, res) => {
    try {
        const userId = req.user.id;
        const { months = 6 } = req.query;

        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - parseInt(months));

        // Get listings by month
        const listings = await prisma.listing.findMany({
            where: {
                userId,
                createdAt: { gte: startDate }
            },
            select: {
                materialType: true,
                estimatedWeight: true,
                status: true,
                createdAt: true
            }
        });

        // Get orders by month
        const orders = await prisma.order.findMany({
            where: {
                buyerId: userId,
                createdAt: { gte: startDate }
            },
            select: {
                materialType: true,
                weight: true,
                status: true,
                createdAt: true
            }
        });

        // Group by month and material
        const listingsByMonth = listings.reduce((acc, listing) => {
            const month = new Date(listing.createdAt).toISOString().slice(0, 7); // YYYY-MM
            if (!acc[month]) {
                acc[month] = {};
            }
            if (!acc[month][listing.materialType]) {
                acc[month][listing.materialType] = { count: 0, weight: 0 };
            }
            acc[month][listing.materialType].count += 1;
            acc[month][listing.materialType].weight += listing.estimatedWeight;
            return acc;
        }, {});

        const ordersByMonth = orders.reduce((acc, order) => {
            const month = new Date(order.createdAt).toISOString().slice(0, 7); // YYYY-MM
            if (!acc[month]) {
                acc[month] = {};
            }
            if (!acc[month][order.materialType]) {
                acc[month][order.materialType] = { count: 0, weight: 0 };
            }
            acc[month][order.materialType].count += 1;
            acc[month][order.materialType].weight += order.weight;
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
