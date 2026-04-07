import { OrderStatus, ReservationStatus, ListingStatus, PaymentStatus } from '../constants/enums.js';
import { ErrorCodes } from '../constants/errorCodes.js';
import { buildDateFilter, getPaginationParams } from '../utils/queryHelper.js';
import { sendSuccess, sendPaginated, sendError } from '../utils/responseHelper.js';
import prisma from '../lib/prisma.js';
import { logActivity } from '../utils/activityLogger.js';
import * as stripeService from '../services/stripeService.js';

// Valid state transitions for orders
const VALID_TRANSITIONS = {
    [OrderStatus.CREATED]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
    [OrderStatus.CONFIRMED]: [OrderStatus.COMPLETED, OrderStatus.CANCELLED],
    [OrderStatus.COMPLETED]: [], // Terminal state
    [OrderStatus.CANCELLED]: [], // Terminal state
};

/**
 * Validate state transition
 */
const isValidTransition = (currentStatus, newStatus) => {
    const allowedTransitions = VALID_TRANSITIONS[currentStatus] || [];
    return allowedTransitions.includes(newStatus);
};

/**
 * Create a new order from an ACTIVE reservation
 * POST /api/orders
 */
export const createOrder = async (req, res) => {
    try {
        const { listingId, weight, paymentMethod } = req.body;
        const buyerId = req.user.id;

        if (!listingId) {
            return sendError(res, 'listingId is required', null, 400);
        }

        // Use interactive transaction to ensure atomicity
        const result = await prisma.$transaction(async (tx) => {
            // 1. Fetch and validate listing
            const listing = await tx.listing.findUnique({
                where: { id: parseInt(listingId) },
                include: {
                    user: { select: { id: true, name: true, email: true, contactNo: true, address: true } }
                }
            });

            if (!listing) {
                throw new Error('Listing not found');
            }

            // 2. Validate listing is available (not sold, not draft)
            if (listing.status === ListingStatus.SOLD || listing.status === ListingStatus.CANCELLED) {
                throw new Error('This listing is no longer available');
            }

            // 3. Determine the quantity for this order.
            const availableQty = listing.estimatedWeight > 0 ? listing.estimatedWeight : listing.quantity;
            const requestedWeight = weight ? parseFloat(weight) : availableQty;

            if (requestedWeight <= 0) {
                throw new Error('Requested quantity must be greater than zero');
            }

            if (requestedWeight > availableQty) {
                throw new Error(`Requested quantity (${requestedWeight} kg) exceeds available stock (${availableQty} kg)`);
            }

            // 4. Validate buyer ≠ seller
            const sellerId = listing.userId;
            if (buyerId === sellerId) {
                throw new Error('You cannot create an order for your own listing');
            }

            // 5. Calculate total amount
            const pricePerKg = listing.price > 0 ? listing.price : 20.0; // fallback price
            const totalAmount = pricePerKg * requestedWeight;

            // 6. Create order with status CREATED
            const order = await tx.order.create({
                data: {
                    buyerId,
                    sellerId,
                    status: OrderStatus.CREATED,
                    totalAmount,
                    paymentMethod: paymentMethod || 'cod',
                    items: {
                        create: {
                            listingId: listing.id,
                            quantity: requestedWeight,
                            price: pricePerKg
                        }
                    }
                },
                include: {
                    buyer: { select: { id: true, name: true, email: true, contactNo: true } },
                    seller: { select: { id: true, name: true, email: true, contactNo: true, address: true } },
                    items: { include: { listing: true } }
                }
            });

            // 7. Deduct stock atomically and mark listing as SOLD if fully ordered
            const newQty = availableQty - requestedWeight;
            await tx.listing.update({
                where: { id: listing.id },
                data: {
                    estimatedWeight: newQty,
                    quantity: newQty,
                    status: newQty <= 0 ? ListingStatus.SOLD : listing.status
                }
            });

            return { order };
        });

        await logActivity({
            userId: req.user.id,
            role: req.user.role,
            action: 'CREATE_ORDER',
            resourceType: 'order',
            resourceId: result.order.id,
            meta: { listingId: listingId, totalAmount: result.order.totalAmount },
            req
        });

        sendSuccess(res, 'Order created successfully', result.order, 201);
    } catch (error) {
        sendError(res, error.message || 'Failed to create order', null, 400);
    }
};

/**
 * Confirm an order (seller action)
 * POST /api/orders/:id/confirm
 * Transition: CREATED → CONFIRMED
 */
export const confirmOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const result = await prisma.$transaction(async (tx) => {
            // 1. Fetch order with reservation
            const order = await tx.order.findUnique({
                where: { id: parseInt(id) },
                include: { reservation: true }
            });

            if (!order) {
                throw new Error('Order not found');
            }

            // 2. Validate seller owns this order
            if (order.sellerId !== userId) {
                throw new Error('Only the seller can confirm this order');
            }

            // 3. Validate current status
            if (order.status !== OrderStatus.CREATED) {
                throw new Error(`Cannot confirm order. Current status: ${order.status}`);
            }

            // 4. Validate state transition
            if (!isValidTransition(order.status, OrderStatus.CONFIRMED)) {
                throw new Error('Invalid state transition');
            }

            // 5. Update order status to CONFIRMED
            const updatedOrder = await tx.order.update({
                where: { id: order.id },
                data: { status: OrderStatus.CONFIRMED },
                include: {
                    buyer: { select: { id: true, name: true, email: true, contactNo: true } },
                    seller: { select: { id: true, name: true, email: true, contactNo: true, address: true } },
                    items: { include: { listing: true } },
                    reservation: true
                }
            });

            // 6. Lock reservation permanently (COMPLETED status)
            if (order.reservation) {
                await tx.listingReservation.update({
                    where: { id: order.reservation.id },
                    data: { status: ReservationStatus.COMPLETED }
                });
            }

            return updatedOrder;
        });

        await logActivity({
            userId,
            role: req.user.role,
            action: 'CONFIRM_ORDER',
            resourceType: 'order',
            resourceId: id,
            req
        });

        sendSuccess(res, 'Order confirmed successfully', result);
    } catch (error) {
        sendError(res, error.message || 'Failed to confirm order', null, 400);
    }
};

/**
 * Cancel an order
 * POST /api/orders/:id/cancel
 * Transition: CREATED → CANCELLED or CONFIRMED → CANCELLED
 * Handles payment refunds automatically if payment exists
 */
export const cancelOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const userId = req.user.id;

        const result = await prisma.$transaction(async (tx) => {
            // 1. Fetch order with reservation and payment
            const order = await tx.order.findUnique({
                where: { id: parseInt(id) },
                include: {
                    reservation: true,
                    payment: true
                }
            });

            if (!order) {
                throw new Error('Order not found');
            }

            // 2. Validate user is buyer or seller
            if (order.buyerId !== userId && order.sellerId !== userId) {
                throw new Error('You do not have permission to cancel this order');
            }

            // 3. Validate order can be cancelled (CREATED or CONFIRMED only)
            if (order.status !== OrderStatus.CREATED && order.status !== OrderStatus.CONFIRMED) {
                throw new Error(`Cannot cancel order. Current status: ${order.status}. Only CREATED or CONFIRMED orders can be cancelled.`);
            }

            // 4. Validate state transition
            if (!isValidTransition(order.status, OrderStatus.CANCELLED)) {
                throw new Error('Invalid state transition');
            }

            // 5. Handle payment if exists (for CONFIRMED orders with payment)
            let paymentRefunded = false;
            if (order.payment) {
                const payment = order.payment;

                // Can only refund if payment is AUTHORIZED or CAPTURED (not RELEASED or already REFUNDED)
                if (payment.status === PaymentStatus.RELEASED) {
                    throw new Error('Cannot cancel order. Payment has already been released.');
                }

                if (payment.status === PaymentStatus.REFUNDED) {
                    // Already refunded, continue with cancellation
                    paymentRefunded = true;
                } else if (payment.status === PaymentStatus.AUTHORIZED) {
                    // Cancel the PaymentIntent (no capture happened)
                    await stripeService.cancelPaymentIntent(payment.paymentIntentId);
                    await tx.payment.update({
                        where: { id: payment.id },
                        data: { status: PaymentStatus.FAILED }
                    });
                    paymentRefunded = true;
                } else if (payment.status === PaymentStatus.CAPTURED) {
                    // Issue refund for captured payment
                    await stripeService.createRefund(
                        payment.paymentIntentId,
                        null, // Full refund
                        reason || 'requested_by_customer'
                    );
                    await tx.payment.update({
                        where: { id: payment.id },
                        data: { status: PaymentStatus.REFUNDED }
                    });
                    paymentRefunded = true;
                } else if (payment.status === PaymentStatus.INITIATED) {
                    // Payment initiated but not authorized - just cancel Stripe intent
                    try {
                        await stripeService.cancelPaymentIntent(payment.paymentIntentId);
                    } catch (e) {
                        // Ignore if already cancelled
                    }
                    await tx.payment.update({
                        where: { id: payment.id },
                        data: { status: PaymentStatus.FAILED }
                    });
                }
            }

            // 6. Update order status to CANCELLED
            const updatedOrder = await tx.order.update({
                where: { id: order.id },
                data: { status: OrderStatus.CANCELLED },
                include: {
                    buyer: { select: { id: true, name: true, email: true, contactNo: true } },
                    seller: { select: { id: true, name: true, email: true, contactNo: true, address: true } },
                    items: { include: { listing: true } },
                    reservation: true,
                    payment: true
                }
            });

            // 7. Restore listing quantity directly from order items
            if (updatedOrder.items && updatedOrder.items.length > 0) {
                for (const item of updatedOrder.items) {
                    // Fetch current listing state
                    const currentListing = await tx.listing.findUnique({ where: { id: item.listingId } });
                    if (currentListing) {
                        const restoredQty = (currentListing.estimatedWeight || currentListing.quantity || 0) + item.quantity;
                        await tx.listing.update({
                            where: { id: item.listingId },
                            data: {
                                estimatedWeight: restoredQty,
                                quantity: restoredQty,
                                // If listing was SOLD, restore to PUBLISHED
                                status: currentListing.status === ListingStatus.SOLD ? ListingStatus.PUBLISHED : currentListing.status
                            }
                        });
                    }
                }
            }

            // 8. Legacy: Release reservation if one somehow still exists on this order
            if (order.reservation) {
                // Update reservation status to RELEASED
                await tx.listingReservation.update({
                    where: { id: order.reservation.id },
                    data: {
                        status: ReservationStatus.RELEASED,
                        orderId: null // Unlink from order
                    }
                });
            }

            return { order: updatedOrder, paymentRefunded };
        });

        await logActivity({
            userId,
            role: req.user.role,
            action: 'CANCEL_ORDER',
            resourceType: 'order',
            resourceId: id,
            meta: { paymentRefunded: result.paymentRefunded, reason },
            req
        });

        const message = result.paymentRefunded
            ? 'Order cancelled successfully. Payment refunded and reservation released.'
            : 'Order cancelled successfully. Reservation released and stock restored.';

        sendSuccess(res, message, result.order);
    } catch (error) {
        sendError(res, error.message || 'Failed to cancel order', null, 400, ErrorCodes.ORDER_NOT_CANCELLABLE);
    }
};

/**
 * Complete an order (seller action, after payment captured)
 * POST /api/orders/:id/complete
 * Transition: CONFIRMED → COMPLETED
 * Requires: payment.status = CAPTURED
 */
export const completeOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const result = await prisma.$transaction(async (tx) => {
            // 1. Fetch order with payment
            const order = await tx.order.findUnique({
                where: { id: parseInt(id) },
                include: {
                    payment: true,
                    reservation: true
                }
            });

            if (!order) {
                throw new Error('Order not found');
            }

            // 2. Validate seller owns this order
            if (order.sellerId !== userId) {
                throw new Error('Only the seller can complete this order');
            }

            // 3. Validate current status is CONFIRMED
            if (order.status !== OrderStatus.CONFIRMED) {
                throw new Error(`Cannot complete order. Current status: ${order.status}. Must be CONFIRMED.`);
            }

            // 4. Validate state transition
            if (!isValidTransition(order.status, OrderStatus.COMPLETED)) {
                throw new Error('Invalid state transition');
            }

            // 5. Validate payment is CAPTURED
            if (!order.payment) {
                throw new Error('Cannot complete order. No payment found.');
            }

            if (order.payment.status !== PaymentStatus.CAPTURED) {
                throw new Error(`Cannot complete order. Payment must be CAPTURED. Current payment status: ${order.payment.status}`);
            }

            // 6. Update order status to COMPLETED
            const updatedOrder = await tx.order.update({
                where: { id: order.id },
                data: { status: OrderStatus.COMPLETED },
                include: {
                    buyer: { select: { id: true, name: true, email: true, contactNo: true } },
                    seller: { select: { id: true, name: true, email: true, contactNo: true, address: true } },
                    items: { include: { listing: true } },
                    reservation: true,
                    payment: true
                }
            });

            return updatedOrder;
        });

        await logActivity({
            userId,
            role: req.user.role,
            action: 'COMPLETE_ORDER',
            resourceType: 'order',
            resourceId: id,
            req
        });

        sendSuccess(res, 'Order completed successfully. You can now release the payment.', result);
    } catch (error) {
        sendError(res, error.message || 'Failed to complete order', null, 400, ErrorCodes.INVALID_STATE);
    }
};

/**
 * Get buyer's orders with filters and pagination
 * GET /api/orders/buyer
 */
export const getBuyerOrders = async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            status,
            startDate,
            endDate,
            page = 1,
            limit = 10
        } = req.query;

        // Build filter conditions
        const where = {
            buyerId: userId,
            ...(status && { status }),
            ...buildDateFilter(startDate, endDate)
        };

        // Get total count
        const totalCount = await prisma.order.count({ where });

        // Get paginated orders
        const { skip, take, page: pageNum, limit: limitNum } = getPaginationParams(page, limit);

        const orders = await prisma.order.findMany({
            where,
            include: {
                buyer: { select: { id: true, name: true, email: true, contactNo: true } },
                seller: { select: { id: true, name: true, email: true, contactNo: true, address: true } },
                items: {
                    include: {
                        listing: { select: { id: true, title: true, materialType: true, images: true } }
                    }
                },
                reservation: true
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take
        });

        sendPaginated(res, orders, totalCount, pageNum, limitNum);
    } catch (error) {
        sendError(res, 'Failed to fetch buyer orders', error);
    }
};

/**
 * Get seller's orders with filters and pagination
 * GET /api/orders/seller
 */
export const getSellerOrders = async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            status,
            buyerId,
            startDate,
            endDate,
            page = 1,
            limit = 10
        } = req.query;

        // Build filter conditions
        const where = {
            sellerId: userId,
            ...(status && { status }),
            ...(buyerId && { buyerId: parseInt(buyerId) }),
            ...buildDateFilter(startDate, endDate)
        };

        // Get total count
        const totalCount = await prisma.order.count({ where });

        // Get paginated orders
        const { skip, take, page: pageNum, limit: limitNum } = getPaginationParams(page, limit);

        const orders = await prisma.order.findMany({
            where,
            include: {
                buyer: { select: { id: true, name: true, email: true, contactNo: true } },
                seller: { select: { id: true, name: true, email: true, contactNo: true, address: true } },
                items: {
                    include: {
                        listing: { select: { id: true, title: true, materialType: true, images: true } }
                    }
                },
                reservation: true
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take
        });

        sendPaginated(res, orders, totalCount, pageNum, limitNum);
    } catch (error) {
        sendError(res, 'Failed to fetch seller orders', error);
    }
};

/**
 * Get a single order by ID
 * GET /api/orders/:id
 */
export const getOrderById = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const order = await prisma.order.findUnique({
            where: { id: parseInt(id) },
            include: {
                buyer: { select: { id: true, name: true, email: true, contactNo: true } },
                seller: { select: { id: true, name: true, email: true, contactNo: true, address: true } },
                items: {
                    include: {
                        listing: true
                    }
                },
                reservation: true
            }
        });

        if (!order) {
            return sendError(res, 'Order not found', null, 404);
        }

        // Validate user is buyer or seller
        if (order.buyerId !== userId && order.sellerId !== userId) {
            return sendError(res, 'You do not have permission to view this order', null, 403);
        }

        sendSuccess(res, 'Order fetched successfully', order);
    } catch (error) {
        sendError(res, 'Failed to fetch order', error);
    }
};

/**
 * Get user's orders (as buyer or seller) with filters - Legacy endpoint
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

        if (status) where.status = status;

        // Use helpers for date
        Object.assign(where, buildDateFilter(startDate, endDate));

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
                },
                reservation: true
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

        // Get pending orders count (CREATED status for new flow)
        const pendingCount = await prisma.order.count({
            where: {
                ...(role === 'buyer' ? { buyerId: userId } : { sellerId: userId }),
                status: { in: [OrderStatus.PENDING, OrderStatus.CREATED] }
            }
        });

        // Get confirmed orders count
        const confirmedCount = await prisma.order.count({
            where: {
                ...(role === 'buyer' ? { buyerId: userId } : { sellerId: userId }),
                status: OrderStatus.CONFIRMED
            }
        });

        sendSuccess(res, 'Stats fetched successfully', {
            totalOrders,
            totalWeight: parseFloat(totalWeight.toFixed(2)),
            pendingCount,
            confirmedCount,
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
        const csvHeader = 'ID,Material Type,Weight (kg),Total Amount,Buyer,Seller,Status,Created At\n';
        const csvRows = orders.map(order => {
            const materialTypes = order.items.map(i => i.listing.materialType).join('; ');
            const totalWeight = order.items.reduce((sum, i) => sum + i.quantity, 0);

            return [
                order.id,
                `"${materialTypes}"`,
                totalWeight,
                order.totalAmount,
                `"${order.buyer?.name || 'N/A'}"`,
                `"${order.seller?.name || 'N/A'}"`,
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
 * Update order status - Legacy endpoint with state validation
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

        // Validate state transition
        if (!isValidTransition(order.status, status)) {
            return sendError(res, `Invalid state transition from ${order.status} to ${status}`, null, 400);
        }

        // Update order
        const updated = await prisma.order.update({
            where: { id: parseInt(id) },
            data: { status }
        });

        await logActivity({
            userId,
            role: req.user.role,
            action: 'UPDATE_ORDER_STATUS',
            resourceType: 'order',
            resourceId: id,
            meta: { oldStatus: order.status, newStatus: status },
            req
        });

        sendSuccess(res, 'Order updated successfully', updated);
    } catch (error) {
        sendError(res, 'Failed to update order', error);
    }
};
