import { PrismaClient } from '@prisma/client';
import { ListingStatus, OrderStatus } from '../constants/enums.js';
import { sendSuccess, sendError } from '../utils/responseHelper.js';

const prisma = new PrismaClient();

/**
 * Get system-wide overview statistics for admin dashboard
 * GET /api/admin/reports/overview
 */
export const getSystemOverview = async (req, res) => {
    try {
        // Total users by role
        const usersByRole = await prisma.user.groupBy({
            by: ['role'],
            _count: { id: true },
            where: { deletedAt: null }
        });

        // Total listings count
        const totalListings = await prisma.listing.count();
        const pendingListings = await prisma.listing.count({
            where: { status: ListingStatus.PENDING }
        });
        const completedListings = await prisma.listing.count({
            where: { status: ListingStatus.COMPLETED }
        });

        // Total orders count
        const totalOrders = await prisma.order.count();
        const pendingOrders = await prisma.order.count({
            where: { status: OrderStatus.PENDING }
        });
        const completedOrders = await prisma.order.count({
            where: { status: OrderStatus.COMPLETED }
        });

        // Total weight recycled (completed listings)
        const completedListingsData = await prisma.listing.findMany({
            where: { status: ListingStatus.COMPLETED },
            select: { estimatedWeight: true }
        });
        const totalWeightRecycled = completedListingsData.reduce(
            (sum, listing) => sum + listing.estimatedWeight,
            0
        );

        // Active users (users with listings or orders in last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const activeUsersFromListings = await prisma.listing.findMany({
            where: { createdAt: { gte: thirtyDaysAgo } },
            select: { userId: true },
            distinct: ['userId']
        });

        const activeUsersFromOrders = await prisma.order.findMany({
            where: { createdAt: { gte: thirtyDaysAgo } },
            select: { buyerId: true },
            distinct: ['buyerId']
        });

        const uniqueActiveUsers = new Set([
            ...activeUsersFromListings.map(l => l.userId),
            ...activeUsersFromOrders.map(o => o.buyerId)
        ]);

        sendSuccess(res, 'System overview fetched', {
            users: {
                total: usersByRole.reduce((sum, role) => sum + role._count.id, 0),
                byRole: usersByRole.reduce((acc, role) => {
                    acc[role.role] = role._count.id;
                    return acc;
                }, {}),
                activeInLast30Days: uniqueActiveUsers.size
            },
            listings: {
                total: totalListings,
                pending: pendingListings,
                completed: completedListings
            },
            orders: {
                total: totalOrders,
                pending: pendingOrders,
                completed: completedOrders
            },
            recycling: {
                totalWeightRecycled: parseFloat(totalWeightRecycled.toFixed(2)),
                unit: 'kg'
            }
        });
    } catch (error) {
        sendError(res, 'Failed to fetch system overview', error);
    }
};

/**
 * Get material-wise breakdown for admin
 * GET /api/admin/reports/materials
 */
export const getMaterialBreakdown = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        const where = {
            status: ListingStatus.COMPLETED,
            ...(startDate || endDate
                ? {
                    createdAt: {
                        ...(startDate && { gte: new Date(startDate) }),
                        ...(endDate && { lte: new Date(endDate) })
                    }
                }
                : {})
        };

        // Listings by material
        const listings = await prisma.listing.findMany({
            where,
            select: {
                materialType: true,
                estimatedWeight: true
            }
        });

        const listingsByMaterial = listings.reduce((acc, listing) => {
            if (!acc[listing.materialType]) {
                acc[listing.materialType] = { count: 0, weight: 0 };
            }
            acc[listing.materialType].count += 1;
            acc[listing.materialType].weight += listing.estimatedWeight;
            return acc;
        }, {});

        // Orders by material
        const orders = await prisma.order.findMany({
            where,
            select: {
                materialType: true,
                weight: true
            }
        });

        const ordersByMaterial = orders.reduce((acc, order) => {
            if (!acc[order.materialType]) {
                acc[order.materialType] = { count: 0, weight: 0 };
            }
            acc[order.materialType].count += 1;
            acc[order.materialType].weight += order.weight;
            return acc;
        }, {});

        sendSuccess(res, 'Material breakdown fetched', {
            listings: listingsByMaterial,
            orders: ordersByMaterial
        });
    } catch (error) {
        sendError(res, 'Failed to fetch material breakdown', error);
    }
};

/**
 * Get user activity statistics for admin
 * GET /api/admin/reports/user-activity
 */
export const getUserActivity = async (req, res) => {
    try {
        const { limit = 10 } = req.query;

        // Top sellers (by completed listings count)
        const topSellers = await prisma.listing.groupBy({
            by: ['userId'],
            where: { status: ListingStatus.COMPLETED },
            _count: { id: true },
            _sum: { estimatedWeight: true },
            orderBy: { _count: { id: 'desc' } },
            take: parseInt(limit)
        });

        const topSellersWithInfo = await Promise.all(
            topSellers.map(async (seller) => {
                const user = await prisma.user.findUnique({
                    where: { id: seller.userId },
                    select: { id: true, name: true, email: true, role: true }
                });
                return {
                    user,
                    listingsCount: seller._count.id,
                    totalWeight: parseFloat((seller._sum.estimatedWeight || 0).toFixed(2))
                };
            })
        );

        // Top buyers (by completed orders count)
        const topBuyers = await prisma.order.groupBy({
            by: ['buyerId'],
            where: { status: OrderStatus.COMPLETED },
            _count: { id: true },
            _sum: { weight: true },
            orderBy: { _count: { id: 'desc' } },
            take: parseInt(limit)
        });

        const topBuyersWithInfo = await Promise.all(
            topBuyers.map(async (buyer) => {
                const user = await prisma.user.findUnique({
                    where: { id: buyer.buyerId },
                    select: { id: true, name: true, email: true, role: true }
                });
                return {
                    user,
                    ordersCount: buyer._count.id,
                    totalWeight: parseFloat((buyer._sum.weight || 0).toFixed(2))
                };
            })
        );

        sendSuccess(res, 'User activity fetched', {
            topSellers: topSellersWithInfo,
            topBuyers: topBuyersWithInfo
        });
    } catch (error) {
        sendError(res, 'Failed to fetch user activity', error);
    }
};

/**
 * Get time-series data for admin charts
 * GET /api/admin/reports/timeseries
 */
export const getTimeSeries = async (req, res) => {
    try {
        const { months = 6 } = req.query;

        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - parseInt(months));

        // Listings by month
        const listings = await prisma.listing.findMany({
            where: { createdAt: { gte: startDate } },
            select: {
                createdAt: true,
                status: true,
                estimatedWeight: true
            }
        });

        const listingsByMonth = listings.reduce((acc, listing) => {
            const month = new Date(listing.createdAt).toISOString().slice(0, 7);
            if (!acc[month]) {
                acc[month] = { total: 0, completed: 0, weight: 0 };
            }
            acc[month].total += 1;
            if (listing.status === ListingStatus.COMPLETED) {
                acc[month].completed += 1;
                acc[month].weight += listing.estimatedWeight;
            }
            return acc;
        }, {});

        // Orders by month
        const orders = await prisma.order.findMany({
            where: { createdAt: { gte: startDate } },
            select: {
                createdAt: true,
                status: true,
                weight: true
            }
        });

        const ordersByMonth = orders.reduce((acc, order) => {
            const month = new Date(order.createdAt).toISOString().slice(0, 7);
            if (!acc[month]) {
                acc[month] = { total: 0, completed: 0, weight: 0 };
            }
            acc[month].total += 1;
            if (order.status === OrderStatus.COMPLETED) {
                acc[month].completed += 1;
                acc[month].weight += order.weight;
            }
            return acc;
        }, {});

        sendSuccess(res, 'Time series data fetched', {
            listingsByMonth,
            ordersByMonth
        });
    } catch (error) {
        sendError(res, 'Failed to fetch time series data', error);
    }
};

/**
 * Get location-based analytics for admin
 * GET /api/admin/reports/locations
 */
export const getLocationAnalytics = async (req, res) => {
    try {
        // Listings with location data
        const listingsWithLocation = await prisma.listing.findMany({
            where: {
                latitude: { not: null },
                longitude: { not: null }
            },
            select: {
                latitude: true,
                longitude: true,
                materialType: true,
                status: true,
                pickupAddress: true
            },
            take: 1000 // Limit to prevent overload
        });

        // Orders with location data
        const ordersWithLocation = await prisma.order.findMany({
            where: {
                latitude: { not: null },
                longitude: { not: null }
            },
            select: {
                latitude: true,
                longitude: true,
                materialType: true,
                status: true,
                pickupAddress: true
            },
            take: 1000
        });

        sendSuccess(res, 'Location analytics fetched', {
            listings: listingsWithLocation,
            orders: ordersWithLocation,
            totalListingsWithLocation: listingsWithLocation.length,
            totalOrdersWithLocation: ordersWithLocation.length
        });
    } catch (error) {
        sendError(res, 'Failed to fetch location analytics', error);
    }
};

/**
 * Export system-wide report as CSV
 * GET /api/admin/reports/export
 */
export const exportSystemReport = async (req, res) => {
    try {
        const { type = 'listings', startDate, endDate } = req.query;

        const where = {
            ...(startDate || endDate
                ? {
                    createdAt: {
                        ...(startDate && { gte: new Date(startDate) }),
                        ...(endDate && { lte: new Date(endDate) })
                    }
                }
                : {})
        };

        let csv = '';

        if (type === 'listings') {
            const listings = await prisma.listing.findMany({
                where,
                include: {
                    user: {
                        select: { name: true, email: true, role: true }
                    }
                },
                orderBy: { createdAt: 'desc' }
            });

            csv = 'ID,User Name,User Email,User Role,Material,Weight (kg),Status,Created At\n';
            csv += listings.map(l =>
                [
                    l.id,
                    `"${l.user?.name || 'N/A'}"`,
                    `"${l.user?.email || 'N/A'}"`,
                    l.user?.role || 'N/A',
                    l.materialType,
                    l.estimatedWeight,
                    l.status,
                    new Date(l.createdAt).toISOString()
                ].join(',')
            ).join('\n');
        } else if (type === 'orders') {
            const orders = await prisma.order.findMany({
                where,
                include: {
                    buyer: {
                        select: { name: true, email: true }
                    },
                    seller: {
                        select: { name: true, email: true }
                    }
                },
                orderBy: { createdAt: 'desc' }
            });

            csv = 'ID,Buyer Name,Buyer Email,Seller Name,Seller Email,Material,Weight (kg),Payment,Status,Created At\n';
            csv += orders.map(o =>
                [
                    o.id,
                    `"${o.buyer?.name || 'N/A'}"`,
                    `"${o.buyer?.email || 'N/A'}"`,
                    `"${o.seller?.name || 'N/A'}"`,
                    `"${o.seller?.email || 'N/A'}"`,
                    o.materialType,
                    o.weight,
                    o.paymentMethod,
                    o.status,
                    new Date(o.createdAt).toISOString()
                ].join(',')
            ).join('\n');
        }

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="system_${type}_export.csv"`);
        res.send(csv);
    } catch (error) {
        sendError(res, 'Failed to export report', error);
    }
};
