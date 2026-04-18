import prisma from '../lib/prisma.js';
import { ListingStatus, OrderStatus } from '../constants/enums.js';
import { sendSuccess, sendError } from '../utils/responseHelper.js';

/**
 * Get system-wide overview statistics for admin dashboard
 * GET /api/admin/reports/overview
 * 
 * Optimized: Uses aggregate instead of findMany + JS reduce,
 * parallelizes independent queries with Promise.all
 */
export const getSystemOverview = async (req, res) => {
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // Run all independent queries in parallel
        const [
            usersByRole,
            totalListings,
            pendingListings,
            completedListings,
            totalOrders,
            pendingOrders,
            completedOrders,
            totalWeightResult,
            activeUsersFromListings,
            activeUsersFromOrders
        ] = await Promise.all([
            // Total users by role
            prisma.user.groupBy({
                by: ['role'],
                _count: { id: true },
            }),

            prisma.listing.count(),
            prisma.listing.count({ where: { status: ListingStatus.DRAFT } }),
            prisma.listing.count({ where: { status: ListingStatus.SOLD } }),

            prisma.order.count(),
            prisma.order.count({ where: { status: OrderStatus.PENDING } }),
            prisma.order.count({ where: { status: OrderStatus.COMPLETED } }),

            // Total weight recycled — aggregate instead of findMany + reduce
            prisma.orderItem.aggregate({
                _sum: { quantity: true },
                where: {
                    order: { status: OrderStatus.COMPLETED }
                }
            }),

            // Active users from listings (last 30 days)
            prisma.listing.findMany({
                where: { createdAt: { gte: thirtyDaysAgo } },
                select: { userId: true },
                distinct: ['userId']
            }),

            // Active users from orders (last 30 days)
            prisma.order.findMany({
                where: { createdAt: { gte: thirtyDaysAgo } },
                select: { buyerId: true },
                distinct: ['buyerId']
            })
        ]);

        const totalWeightRecycled = totalWeightResult._sum.quantity || 0;

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
 * 
 * Optimized: Uses select for minimal field fetching
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

        // Run both queries in parallel
        const [listings, orders] = await Promise.all([
            // Listings by material — only select needed fields
            prisma.listing.findMany({
                where: dateFilter,
                select: {
                    materialType: true,
                    estimatedWeight: true
                }
            }),

            // Orders by material
            prisma.order.findMany({
                where: {
                    ...dateFilter,
                    status: OrderStatus.COMPLETED
                },
                select: {
                    items: {
                        select: {
                            quantity: true,
                            listing: { select: { materialType: true } }
                        }
                    }
                }
            })
        ]);

        const listingsByMaterial = listings.reduce((acc, listing) => {
            if (!acc[listing.materialType]) {
                acc[listing.materialType] = { count: 0, weight: 0 };
            }
            acc[listing.materialType].count += 1;
            acc[listing.materialType].weight += listing.estimatedWeight;
            return acc;
        }, {});

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
 * 
 * Optimized: Fixed N+1 query problem — batches user lookups and weight calculations
 */
export const getUserActivity = async (req, res) => {
    try {
        const { limit = 10 } = req.query;
        const take = Math.min(parseInt(limit) || 10, 50);

        // Get top sellers and buyers in parallel
        const [sellerStats, buyerStats] = await Promise.all([
            prisma.order.groupBy({
                by: ['sellerId'],
                where: { status: OrderStatus.COMPLETED },
                _count: { id: true },
                orderBy: { _count: { id: 'desc' } },
                take
            }),
            prisma.order.groupBy({
                by: ['buyerId'],
                where: { status: OrderStatus.COMPLETED },
                _count: { id: true },
                orderBy: { _count: { id: 'desc' } },
                take
            })
        ]);

        // Collect all user IDs needed
        const sellerIds = sellerStats.map(s => s.sellerId);
        const buyerIds = buyerStats.map(b => b.buyerId);
        const allUserIds = [...new Set([...sellerIds, ...buyerIds])];

        // Batch fetch all users at once (fixes N+1)
        const users = await prisma.user.findMany({
            where: { id: { in: allUserIds } },
            select: { id: true, name: true, email: true, role: true, businessName: true }
        });
        const userMap = new Map(users.map(u => [u.id, u]));

        // Batch calculate weights for all sellers and buyers using aggregate
        const [sellerWeights, buyerWeights] = await Promise.all([
            Promise.all(sellerIds.map(sellerId =>
                prisma.orderItem.aggregate({
                    _sum: { quantity: true },
                    where: { order: { sellerId, status: OrderStatus.COMPLETED } }
                }).then(r => ({ id: sellerId, weight: r._sum.quantity || 0 }))
            )),
            Promise.all(buyerIds.map(buyerId =>
                prisma.orderItem.aggregate({
                    _sum: { quantity: true },
                    where: { order: { buyerId, status: OrderStatus.COMPLETED } }
                }).then(r => ({ id: buyerId, weight: r._sum.quantity || 0 }))
            ))
        ]);

        const sellerWeightMap = new Map(sellerWeights.map(w => [w.id, w.weight]));
        const buyerWeightMap = new Map(buyerWeights.map(w => [w.id, w.weight]));

        // Build final results without N+1
        const topSellers = sellerStats.map(stat => ({
            user: userMap.get(stat.sellerId) || null,
            ordersCount: stat._count.id,
            totalWeight: parseFloat((sellerWeightMap.get(stat.sellerId) || 0).toFixed(2))
        }));

        const topBuyers = buyerStats.map(stat => ({
            user: userMap.get(stat.buyerId) || null,
            ordersCount: stat._count.id,
            totalWeight: parseFloat((buyerWeightMap.get(stat.buyerId) || 0).toFixed(2))
        }));

        sendSuccess(res, 'User activity fetched', {
            topSellers,
            topBuyers
        });
    } catch (error) {
        sendError(res, 'Failed to fetch user activity', error);
    }
};

/**
 * Get time-series data for admin charts
 * GET /api/admin/reports/timeseries
 * 
 * Optimized: Uses select for minimal fields
 */
export const getTimeSeries = async (req, res) => {
    try {
        const { months = 6 } = req.query;

        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - parseInt(months));

        // Run in parallel with minimal select
        const [listings, orders] = await Promise.all([
            prisma.listing.findMany({
                where: { createdAt: { gte: startDate } },
                select: {
                    createdAt: true,
                    status: true,
                    estimatedWeight: true
                }
            }),

            prisma.order.findMany({
                where: { createdAt: { gte: startDate } },
                select: {
                    createdAt: true,
                    status: true,
                    items: {
                        select: { quantity: true }
                    }
                }
            })
        ]);

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
        // Run in parallel
        const [listingsWithLocation, orders] = await Promise.all([
            prisma.listing.findMany({
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
            }),

            prisma.order.findMany({
                select: {
                    id: true,
                    status: true,
                    items: {
                        select: {
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
            })
        ]);

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
                select: {
                    id: true,
                    materialType: true,
                    estimatedWeight: true,
                    status: true,
                    createdAt: true,
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
                select: {
                    id: true,
                    status: true,
                    createdAt: true,
                    buyer: { select: { name: true, email: true } },
                    seller: { select: { name: true, email: true } },
                    items: {
                        select: {
                            quantity: true,
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
