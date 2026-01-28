import prisma from '../lib/prisma.js';
import { ListingStatus, OrderStatus } from '../constants/enums.js';
import { sendSuccess, sendError } from '../utils/responseHelper.js';

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
        });

        // Total listings count
        const totalListings = await prisma.listing.count();
        const pendingListings = await prisma.listing.count({
            where: { status: ListingStatus.DRAFT } // Changed from PENDING if DRAFT is initial
        });
        const completedListings = await prisma.listing.count({
            where: { status: ListingStatus.SOLD } // Changed from COMPLETED if SOLD is the terminal status
        });

        // Total orders count
        const totalOrders = await prisma.order.count();
        const pendingOrders = await prisma.order.count({
            where: { status: OrderStatus.PENDING }
        });
        const completedOrders = await prisma.order.count({
            where: { status: OrderStatus.COMPLETED }
        });

        // Total weight recycled (completed orders)
        const completedOrdersData = await prisma.order.findMany({
            where: { status: OrderStatus.COMPLETED },
            include: {
                items: true
            }
        });
        const totalWeightRecycled = completedOrdersData.reduce((sum, order) => {
            const orderWeight = order.items.reduce((iSum, item) => iSum + item.quantity, 0);
            return sum + orderWeight;
        }, 0);

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

        const dateFilter = {
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
            where: dateFilter,
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
            where: {
                ...dateFilter,
                status: OrderStatus.COMPLETED
            },
            include: {
                items: {
                    include: {
                        listing: { select: { materialType: true } }
                    }
                }
            }
        });

        const ordersByMaterial = {};
        orders.forEach(order => {
            order.items.forEach(item => {
                const mType = item.listing.materialType;
                if (!ordersByMaterial[mType]) {
                    ordersByMaterial[mType] = { count: 0, weight: 0 };
                }
                ordersByMaterial[mType].count += 1;
                ordersByMaterial[mType].weight += item.quantity;
            });
        });

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

        // Top sellers (by completed items weight in orders)
        const sellerStats = await prisma.order.groupBy({
            by: ['sellerId'],
            where: { status: OrderStatus.COMPLETED },
            _count: { id: true },
            orderBy: { _count: { id: 'desc' } },
            take: parseInt(limit)
        });

        const topSellersWithInfo = await Promise.all(
            sellerStats.map(async (stat) => {
                const user = await prisma.user.findUnique({
                    where: { id: stat.sellerId },
                    select: { id: true, name: true, email: true, role: true, businessName: true }
                });

                // Calculate total weight for this seller
                const orders = await prisma.order.findMany({
                    where: { sellerId: stat.sellerId, status: OrderStatus.COMPLETED },
                    include: { items: true }
                });
                const totalWeight = orders.reduce((sum, o) => sum + o.items.reduce((iSum, i) => iSum + i.quantity, 0), 0);

                return {
                    user,
                    ordersCount: stat._count.id,
                    totalWeight: parseFloat(totalWeight.toFixed(2))
                };
            })
        );

        // Top buyers (by completed orders weight)
        const buyerStats = await prisma.order.groupBy({
            by: ['buyerId'],
            where: { status: OrderStatus.COMPLETED },
            _count: { id: true },
            orderBy: { _count: { id: 'desc' } },
            take: parseInt(limit)
        });

        const topBuyersWithInfo = await Promise.all(
            buyerStats.map(async (stat) => {
                const user = await prisma.user.findUnique({
                    where: { id: stat.buyerId },
                    select: { id: true, name: true, email: true, role: true }
                });

                // Calculate total weight for this buyer
                const orders = await prisma.order.findMany({
                    where: { buyerId: stat.buyerId, status: OrderStatus.COMPLETED },
                    include: { items: true }
                });
                const totalWeight = orders.reduce((sum, o) => sum + o.items.reduce((iSum, i) => iSum + i.quantity, 0), 0);

                return {
                    user,
                    ordersCount: stat._count.id,
                    totalWeight: parseFloat(totalWeight.toFixed(2))
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
            if (listing.status === ListingStatus.SOLD) {
                acc[month].completed += 1;
                acc[month].weight += listing.estimatedWeight;
            }
            return acc;
        }, {});

        // Orders by month
        const orders = await prisma.order.findMany({
            where: { createdAt: { gte: startDate } },
            include: {
                items: true
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
                const weight = order.items.reduce((sum, i) => sum + i.quantity, 0);
                acc[month].weight += weight;
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
            take: 1000
        });

        // Orders with location data (via their first item's listing)
        const orders = await prisma.order.findMany({
            include: {
                items: {
                    include: {
                        listing: {
                            select: {
                                latitude: true,
                                longitude: true,
                                materialType: true,
                                pickupAddress: true
                            }
                        }
                    },
                    take: 1
                }
            },
            take: 1000
        });

        const ordersWithLocation = orders
            .filter(o => o.items.length > 0 && o.items[0].listing.latitude !== null)
            .map(o => ({
                id: o.id,
                latitude: o.items[0].listing.latitude,
                longitude: o.items[0].listing.longitude,
                materialType: o.items[0].listing.materialType,
                status: o.status,
                pickupAddress: o.items[0].listing.pickupAddress
            }));

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

        const dateFilter = {
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
                where: dateFilter,
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
                where: dateFilter,
                include: {
                    buyer: { select: { name: true, email: true } },
                    seller: { select: { name: true, email: true } },
                    items: {
                        include: {
                            listing: { select: { materialType: true } }
                        }
                    }
                },
                orderBy: { createdAt: 'desc' }
            });

            csv = 'ID,Buyer Name,Buyer Email,Seller Name,Seller Email,Materials,Total Weight (kg),Status,Created At\n';
            csv += orders.map(o => {
                const materials = o.items.map(i => i.listing.materialType).join('; ');
                const totalWeight = o.items.reduce((sum, i) => sum + i.quantity, 0);
                return [
                    o.id,
                    `"${o.buyer?.name || 'N/A'}"`,
                    `"${o.buyer?.email || 'N/A'}"`,
                    `"${o.seller?.name || 'N/A'}"`,
                    `"${o.seller?.email || 'N/A'}"`,
                    `"${materials}"`,
                    totalWeight,
                    o.status,
                    new Date(o.createdAt).toISOString()
                ].join(',');
            }).join('\n');
        }

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="system_${type}_export.csv"`);
        res.send(csv);
    } catch (error) {
        sendError(res, 'Failed to export report', error);
    }
};
