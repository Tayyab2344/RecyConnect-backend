import { OrderStatus, PaymentMethod } from '../constants/enums.js';
import { buildDateFilter, buildSearchFilter, getPaginationParams } from '../utils/queryHelper.js';
import { sendSuccess, sendPaginated, sendError } from '../utils/responseHelper.js';
import prisma from '../lib/prisma.js';
import { logActivity } from '../utils/activityLogger.js';

/**
 * Create a new order
 * POST /api/orders
 */
export const createOrder = async (req, res) => {
    try {
        const {
            sellerId,
            materialType,
            weight,
            pickupAddress,
            latitude,
            longitude,
            locationMethod,
            paymentMethod
        } = req.body;

        const buyerId = req.user.id;

        // Validation: location is required
        if (!pickupAddress) {
            return sendError(res, 'Pickup address is required', null, 400);
        }

        // Validation: weight must be positive
        if (weight <= 0) {
            return sendError(res, 'Weight must be greater than 0', null, 400);
        }

        // Check if listing exists
        const listingId = req.body.listingId;
        const listing = await prisma.listing.findUnique({
            where: { id: parseInt(listingId) }
        });

        if (!listing) {
            return sendError(res, 'Listing not found', null, 404);
        }

        // Create order
        const order = await prisma.order.create({
            data: {
                buyerId,
                sellerId: listing.userId,
                status: OrderStatus.PENDING,
                totalAmount: listing.price * (parseFloat(weight) || 1),
                items: {
                    create: {
                        listingId: listing.id,
                        quantity: parseFloat(weight) || 1,
                        price: listing.price
                    }
                }
            },
            include: {
                buyer: {
                    select: { id: true, name: true, email: true, contactNo: true }
                },
                seller: {
                    select: { id: true, name: true, email: true, contactNo: true, address: true }
                },
                items: {
                    include: { listing: true }
                }
            }
        });

        await logActivity({
            userId: req.user.id,
            role: req.user.role,
            action: "CREATE_ORDER",
            resourceType: "order",
            resourceId: order.id,
            meta: { sellerId, materialType, weight, totalAmount: order.totalAmount },
            req
        });

        sendSuccess(res, 'Order created successfully', order, 201);
    } catch (error) {
        sendError(res, 'Failed to create order', error);
    }
};

/**
 * Get user's orders (as buyer or seller) with filters
 * GET /api/orders
 */
export const getOrders = async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            role, // 'buyer' or 'seller'
            material,
            status,
            startDate,
            endDate,
            search,
            page = 1,
            limit = 10
        } = req.query;

        // Build filter conditions based on role
        const where = {
            ...(role === 'buyer' ? { buyerId: userId } :
                role === 'seller' ? { sellerId: userId } :
                    {
                        OR: [
                            { buyerId: userId },
                            { sellerId: userId }
                        ]
                    }),
        };

        if (material) where.materialType = material;
        if (status) where.status = status;

        // Use helpers for date and search
        Object.assign(where, buildDateFilter(startDate, endDate));

        if (search) {
            Object.assign(where, buildSearchFilter(search, ['materialType', 'pickupAddress']));
        }

        // Get total count
        const totalCount = await prisma.order.count({ where });

        // Get paginated orders
        const { skip, take, page: pageNum, limit: limitNum } = getPaginationParams(page, limit);

        const orders = await prisma.order.findMany({
            where: {
                ...where,
                ...(material && {
                    items: {
                        some: {
                            listing: {
                                materialType: { equals: material, mode: 'insensitive' }
                            }
                        }
                    }
                })
            },
            include: {
                buyer: { select: { id: true, name: true, email: true, contactNo: true } },
                seller: { select: { id: true, name: true, email: true, contactNo: true, address: true } },
                items: {
                    include: {
                        listing: { select: { materialType: true } }
                    }
                }
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take
        });

        sendPaginated(res, orders, totalCount, pageNum, limitNum);
    } catch (error) {
        sendError(res, 'Failed to fetch orders', error);
    }
};

/**
 * Get user's buying statistics
 * GET /api/orders/stats
 */
export const getOrderStats = async (req, res) => {
    try {
        const userId = req.user.id;
        const { role = 'buyer' } = req.query;

        // Get total orders count
        const totalOrders = await prisma.order.count({
            where: role === 'buyer' ? { buyerId: userId } : { sellerId: userId }
        });

        // Get total weight (completed orders)
        const completedOrders = await prisma.order.findMany({
            where: {
                ...(role === 'buyer' ? { buyerId: userId } : { sellerId: userId }),
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

        let totalWeight = 0;
        const byMaterial = {};

        completedOrders.forEach(order => {
            order.items.forEach(item => {
                const weight = item.quantity;
                const material = item.listing.materialType;

                totalWeight += weight;

                if (!byMaterial[material]) {
                    byMaterial[material] = { count: 0, weight: 0 };
                }
                byMaterial[material].count += 1;
                byMaterial[material].weight += weight;
            });
        });

        // Get pending orders count
        const pendingCount = await prisma.order.count({
            where: {
                ...(role === 'buyer' ? { buyerId: userId } : { sellerId: userId }),
                status: OrderStatus.PENDING
            }
        });

        sendSuccess(res, 'Stats fetched successfully', {
            totalOrders,
            totalWeight: parseFloat(totalWeight.toFixed(2)),
            pendingCount,
            byMaterial
        });
    } catch (error) {
        sendError(res, 'Failed to fetch statistics', error);
    }
};

/**
 * Export orders as CSV
 * GET /api/orders/export
 */
export const exportOrders = async (req, res) => {
    try {
        const userId = req.user.id;
        const { role, material, status, startDate, endDate } = req.query;

        // Build filter conditions
        const where = {
            ...(role === 'buyer' ? { buyerId: userId } :
                role === 'seller' ? { sellerId: userId } :
                    {
                        OR: [
                            { buyerId: userId },
                            { sellerId: userId }
                        ]
                    }),
            ...(material && { materialType: material }),
            ...(status && { status }),
            ...buildDateFilter(startDate, endDate)
        };

        const orders = await prisma.order.findMany({
            where: {
                ...where,
                ...(material && {
                    items: {
                        some: {
                            listing: {
                                materialType: { equals: material, mode: 'insensitive' }
                            }
                        }
                    }
                })
            },
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

        // Generate CSV
        const csvHeader = 'ID,Material Type,Weight (kg),Buyer,Seller,Pickup Address,Payment Method,Status,Created At\n';
        const csvRows = orders.map(order => {
            const materialTypes = order.items.map(i => i.listing.materialType).join('; ');
            const totalWeight = order.items.reduce((sum, i) => sum + i.quantity, 0);

            return [
                order.id,
                `"${materialTypes}"`,
                totalWeight,
                `"${order.buyer?.name || 'N/A'}"`,
                `"${order.seller?.name || 'N/A'}"`,
                `"${order.pickupAddress || 'N/A'}"`,
                'N/A', // Payment Method
                order.status,
                new Date(order.createdAt).toISOString()
            ].join(',');
        }).join('\n');

        const csv = csvHeader + csvRows;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="orders_export.csv"');
        res.send(csv);
    } catch (error) {
        sendError(res, 'Failed to export orders', error);
    }
};

/**
 * Update order status
 * PUT /api/orders/:id/status
 */
export const updateOrderStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const userId = req.user.id;

        // Check if order belongs to the user (as buyer or seller)
        const order = await prisma.order.findFirst({
            where: {
                id: parseInt(id),
                OR: [
                    { buyerId: userId },
                    { sellerId: userId }
                ]
            }
        });

        if (!order) {
            return sendError(res, 'Order not found', null, 404);
        }

        // Update order
        const updated = await prisma.order.update({
            where: { id: parseInt(id) },
            data: { status }
        });

        await logActivity({
            action: "UPDATE_ORDER_STATUS",
            resourceType: "order",
            resourceId: id,
            meta: { status },
            req
        });

        sendSuccess(res, 'Order updated successfully', updated);
    } catch (error) {
        sendError(res, 'Failed to update order', error);
    }
};
