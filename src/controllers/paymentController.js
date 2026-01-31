import { PaymentStatus, PaymentProvider, OrderStatus } from '../constants/enums.js';
import { sendSuccess, sendError } from '../utils/responseHelper.js';
import prisma from '../lib/prisma.js';
import { logActivity } from '../utils/activityLogger.js';
import * as stripeService from '../services/stripeService.js';

// Valid payment state transitions
const VALID_TRANSITIONS = {
    [PaymentStatus.INITIATED]: [PaymentStatus.AUTHORIZED, PaymentStatus.FAILED],
    [PaymentStatus.AUTHORIZED]: [PaymentStatus.CAPTURED, PaymentStatus.REFUNDED],
    [PaymentStatus.CAPTURED]: [PaymentStatus.RELEASED, PaymentStatus.REFUNDED],
    [PaymentStatus.RELEASED]: [], // Terminal state - no refund after release
    [PaymentStatus.REFUNDED]: [], // Terminal state
    [PaymentStatus.FAILED]: [] // Terminal state
};

/**
 * Validate payment state transition
 */
const isValidTransition = (currentStatus, newStatus) => {
    const allowedTransitions = VALID_TRANSITIONS[currentStatus] || [];
    return allowedTransitions.includes(newStatus);
};

/**
 * Create a Stripe PaymentIntent for a confirmed order
 * POST /api/payments/create-intent
 */
export const createPaymentIntent = async (req, res) => {
    try {
        const { orderId } = req.body;
        const userId = req.user.id;

        if (!orderId) {
            return sendError(res, 'Order ID is required', null, 400);
        }

        // Use transaction to ensure atomicity
        const result = await prisma.$transaction(async (tx) => {
            // 1. Fetch order
            const order = await tx.order.findUnique({
                where: { id: parseInt(orderId) },
                include: { payment: true }
            });

            if (!order) {
                throw new Error('Order not found');
            }

            // 2. Validate user is the buyer
            if (order.buyerId !== userId) {
                throw new Error('Only the buyer can initiate payment');
            }

            // 3. Validate order status is CONFIRMED
            if (order.status !== OrderStatus.CONFIRMED) {
                throw new Error(`Cannot create payment. Order status must be CONFIRMED. Current status: ${order.status}`);
            }

            // 4. Check if payment already exists
            if (order.payment) {
                throw new Error('Payment already exists for this order. Use existing PaymentIntent.');
            }

            // 5. Create Stripe PaymentIntent
            const paymentIntent = await stripeService.createPaymentIntent(
                order.totalAmount,
                process.env.STRIPE_CURRENCY || 'pkr',
                {
                    orderId: order.id.toString(),
                    buyerId: order.buyerId.toString(),
                    sellerId: order.sellerId.toString()
                },
                true // Manual capture mode
            );

            // 6. Create Payment record
            const payment = await tx.payment.create({
                data: {
                    orderId: order.id,
                    amount: order.totalAmount,
                    currency: process.env.STRIPE_CURRENCY || 'PKR',
                    provider: PaymentProvider.STRIPE,
                    status: PaymentStatus.INITIATED,
                    paymentIntentId: paymentIntent.id
                }
            });

            return {
                payment,
                clientSecret: paymentIntent.client_secret,
                paymentIntentId: paymentIntent.id
            };
        });

        await logActivity({
            userId,
            role: req.user.role,
            action: 'CREATE_PAYMENT_INTENT',
            resourceType: 'payment',
            resourceId: result.payment.id,
            meta: { orderId, paymentIntentId: result.paymentIntentId },
            req
        });

        sendSuccess(res, 'PaymentIntent created successfully', {
            paymentId: result.payment.id,
            clientSecret: result.clientSecret,
            paymentIntentId: result.paymentIntentId,
            amount: result.payment.amount,
            currency: result.payment.currency
        }, 201);
    } catch (error) {
        sendError(res, error.message || 'Failed to create PaymentIntent', null, 400);
    }
};

/**
 * Authorize payment (verify PaymentIntent status from Stripe)
 * POST /api/payments/:id/authorize
 * Transition: INITIATED → AUTHORIZED
 */
export const authorizePayment = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const result = await prisma.$transaction(async (tx) => {
            // 1. Fetch payment with order
            const payment = await tx.payment.findUnique({
                where: { id: parseInt(id) },
                include: { order: true }
            });

            if (!payment) {
                throw new Error('Payment not found');
            }

            // 2. Validate user is the buyer
            if (payment.order.buyerId !== userId) {
                throw new Error('Only the buyer can authorize payment');
            }

            // 3. Validate current status
            if (payment.status !== PaymentStatus.INITIATED) {
                throw new Error(`Cannot authorize payment. Current status: ${payment.status}`);
            }

            // 4. Verify PaymentIntent status from Stripe
            const paymentIntent = await stripeService.retrievePaymentIntent(payment.paymentIntentId);

            // 5. Check if payment is authorized (requires_capture means card was authorized)
            if (paymentIntent.status !== 'requires_capture') {
                // Map Stripe status to our status
                const mappedStatus = stripeService.mapStripeStatusToPaymentStatus(paymentIntent.status);

                if (paymentIntent.status === 'canceled') {
                    await tx.payment.update({
                        where: { id: payment.id },
                        data: { status: PaymentStatus.FAILED }
                    });
                    throw new Error('Payment was cancelled');
                }

                throw new Error(`Payment not yet authorized. Stripe status: ${paymentIntent.status}`);
            }

            // 6. Update payment status to AUTHORIZED
            const updatedPayment = await tx.payment.update({
                where: { id: payment.id },
                data: {
                    status: PaymentStatus.AUTHORIZED,
                    paymentMethod: paymentIntent.payment_method_types?.[0] || 'card'
                },
                include: { order: true }
            });

            return updatedPayment;
        });

        await logActivity({
            userId,
            role: req.user.role,
            action: 'AUTHORIZE_PAYMENT',
            resourceType: 'payment',
            resourceId: id,
            req
        });

        sendSuccess(res, 'Payment authorized successfully', result);
    } catch (error) {
        sendError(res, error.message || 'Failed to authorize payment', null, 400);
    }
};

/**
 * Capture payment (capture funds from authorized payment)
 * POST /api/payments/:id/capture
 * Transition: AUTHORIZED → CAPTURED
 */
export const capturePayment = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const result = await prisma.$transaction(async (tx) => {
            // 1. Fetch payment with order
            const payment = await tx.payment.findUnique({
                where: { id: parseInt(id) },
                include: { order: true }
            });

            if (!payment) {
                throw new Error('Payment not found');
            }

            // 2. Validate user is the seller (seller captures payment)
            if (payment.order.sellerId !== userId) {
                throw new Error('Only the seller can capture payment');
            }

            // 3. Validate current status
            if (payment.status !== PaymentStatus.AUTHORIZED) {
                throw new Error(`Cannot capture payment. Current status: ${payment.status}. Must be AUTHORIZED.`);
            }

            // 4. Idempotency check - verify Stripe status
            const existingIntent = await stripeService.retrievePaymentIntent(payment.paymentIntentId);
            if (existingIntent.status === 'succeeded') {
                // Already captured, just update our status
                const updatedPayment = await tx.payment.update({
                    where: { id: payment.id },
                    data: { status: PaymentStatus.CAPTURED },
                    include: { order: true }
                });
                return updatedPayment;
            }

            // 5. Capture PaymentIntent in Stripe
            const capturedIntent = await stripeService.capturePaymentIntent(payment.paymentIntentId);

            if (capturedIntent.status !== 'succeeded') {
                throw new Error(`Failed to capture payment. Stripe status: ${capturedIntent.status}`);
            }

            // 6. Update payment status to CAPTURED
            const updatedPayment = await tx.payment.update({
                where: { id: payment.id },
                data: { status: PaymentStatus.CAPTURED },
                include: { order: true }
            });

            return updatedPayment;
        });

        await logActivity({
            userId,
            role: req.user.role,
            action: 'CAPTURE_PAYMENT',
            resourceType: 'payment',
            resourceId: id,
            req
        });

        sendSuccess(res, 'Payment captured successfully', result);
    } catch (error) {
        sendError(res, error.message || 'Failed to capture payment', null, 400);
    }
};

/**
 * Release payment (mark as settled after order completion)
 * POST /api/payments/:id/release
 * Transition: CAPTURED → RELEASED
 */
export const releasePayment = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const result = await prisma.$transaction(async (tx) => {
            // 1. Fetch payment with order
            const payment = await tx.payment.findUnique({
                where: { id: parseInt(id) },
                include: { order: true }
            });

            if (!payment) {
                throw new Error('Payment not found');
            }

            // 2. Validate user is the seller
            if (payment.order.sellerId !== userId) {
                throw new Error('Only the seller can release payment');
            }

            // 3. Validate order status is COMPLETED
            if (payment.order.status !== OrderStatus.COMPLETED) {
                throw new Error(`Cannot release payment. Order status must be COMPLETED. Current: ${payment.order.status}`);
            }

            // 4. Validate current payment status
            if (payment.status !== PaymentStatus.CAPTURED) {
                throw new Error(`Cannot release payment. Current status: ${payment.status}. Must be CAPTURED.`);
            }

            // 5. Update payment status to RELEASED
            const updatedPayment = await tx.payment.update({
                where: { id: payment.id },
                data: { status: PaymentStatus.RELEASED },
                include: { order: true }
            });

            return updatedPayment;
        });

        await logActivity({
            userId,
            role: req.user.role,
            action: 'RELEASE_PAYMENT',
            resourceType: 'payment',
            resourceId: id,
            req
        });

        sendSuccess(res, 'Payment released and settled', result);
    } catch (error) {
        sendError(res, error.message || 'Failed to release payment', null, 400);
    }
};

/**
 * Refund payment
 * POST /api/payments/:id/refund
 * Transition: CAPTURED/AUTHORIZED → REFUNDED
 */
export const refundPayment = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const userId = req.user.id;

        const result = await prisma.$transaction(async (tx) => {
            // 1. Fetch payment with order
            const payment = await tx.payment.findUnique({
                where: { id: parseInt(id) },
                include: { order: true }
            });

            if (!payment) {
                throw new Error('Payment not found');
            }

            // 2. Validate user is buyer or seller
            if (payment.order.buyerId !== userId && payment.order.sellerId !== userId) {
                throw new Error('Only the buyer or seller can request a refund');
            }

            // 3. Validate order status is CANCELLED
            if (payment.order.status !== OrderStatus.CANCELLED) {
                throw new Error(`Cannot refund payment. Order must be CANCELLED. Current: ${payment.order.status}`);
            }

            // 4. Validate current payment status (cannot refund after RELEASED)
            if (payment.status === PaymentStatus.RELEASED) {
                throw new Error('Cannot refund payment after it has been released');
            }

            if (payment.status !== PaymentStatus.CAPTURED && payment.status !== PaymentStatus.AUTHORIZED) {
                throw new Error(`Cannot refund payment. Current status: ${payment.status}. Must be CAPTURED or AUTHORIZED.`);
            }

            // 5. If AUTHORIZED (not captured), cancel the PaymentIntent instead
            if (payment.status === PaymentStatus.AUTHORIZED) {
                await stripeService.cancelPaymentIntent(payment.paymentIntentId);
            } else {
                // 6. Create refund in Stripe for captured payments
                await stripeService.createRefund(
                    payment.paymentIntentId,
                    null, // Full refund
                    reason || 'requested_by_customer'
                );
            }

            // 7. Update payment status to REFUNDED
            const updatedPayment = await tx.payment.update({
                where: { id: payment.id },
                data: { status: PaymentStatus.REFUNDED },
                include: { order: true }
            });

            return updatedPayment;
        });

        await logActivity({
            userId,
            role: req.user.role,
            action: 'REFUND_PAYMENT',
            resourceType: 'payment',
            resourceId: id,
            meta: { reason },
            req
        });

        sendSuccess(res, 'Payment refunded successfully', result);
    } catch (error) {
        sendError(res, error.message || 'Failed to refund payment', null, 400);
    }
};

/**
 * Get payment status by order ID
 * GET /api/payments/order/:orderId
 */
export const getPaymentStatus = async (req, res) => {
    try {
        const { orderId } = req.params;
        const userId = req.user.id;

        // Fetch payment with order
        const payment = await prisma.payment.findUnique({
            where: { orderId: parseInt(orderId) },
            include: {
                order: {
                    include: {
                        buyer: { select: { id: true, name: true, email: true } },
                        seller: { select: { id: true, name: true, email: true } }
                    }
                }
            }
        });

        if (!payment) {
            return sendError(res, 'Payment not found for this order', null, 404);
        }

        // Validate user is buyer or seller
        if (payment.order.buyerId !== userId && payment.order.sellerId !== userId) {
            return sendError(res, 'You do not have permission to view this payment', null, 403);
        }

        // Optionally sync with Stripe for latest status
        let stripeStatus = null;
        if (payment.paymentIntentId && payment.status === PaymentStatus.INITIATED) {
            try {
                const paymentIntent = await stripeService.retrievePaymentIntent(payment.paymentIntentId);
                stripeStatus = paymentIntent.status;

                // Auto-update if status changed
                const mappedStatus = stripeService.mapStripeStatusToPaymentStatus(paymentIntent.status);
                if (mappedStatus !== payment.status && mappedStatus !== PaymentStatus.INITIATED) {
                    await prisma.payment.update({
                        where: { id: payment.id },
                        data: { status: mappedStatus }
                    });
                    payment.status = mappedStatus;
                }
            } catch (stripeError) {
                console.error('Failed to sync with Stripe:', stripeError);
            }
        }

        sendSuccess(res, 'Payment status retrieved', {
            ...payment,
            stripeStatus
        });
    } catch (error) {
        sendError(res, error.message || 'Failed to get payment status', null, 400);
    }
};

/**
 * Get payment by ID
 * GET /api/payments/:id
 */
export const getPaymentById = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const payment = await prisma.payment.findUnique({
            where: { id: parseInt(id) },
            include: {
                order: {
                    include: {
                        buyer: { select: { id: true, name: true, email: true } },
                        seller: { select: { id: true, name: true, email: true } }
                    }
                }
            }
        });

        if (!payment) {
            return sendError(res, 'Payment not found', null, 404);
        }

        // Validate user is buyer or seller
        if (payment.order.buyerId !== userId && payment.order.sellerId !== userId) {
            return sendError(res, 'You do not have permission to view this payment', null, 403);
        }

        sendSuccess(res, 'Payment retrieved', payment);
    } catch (error) {
        sendError(res, error.message || 'Failed to get payment', null, 400);
    }
};
