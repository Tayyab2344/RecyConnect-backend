import express from 'express';
import { authenticateToken } from '../../../middlewares/authMiddleware.js';
import { cacheResponse } from '../../../middlewares/cacheMiddleware.js';
import {
    createOrder,
    confirmOrder,
    cancelOrder,
    completeOrder,
    getBuyerOrders,
    getSellerOrders,
    getOrderById,
    getOrders,
    getOrderStats,
    exportOrders,
    updateOrderStatus
} from '../controllers/orderController.js';
import { submitOrderReview } from '../../rewards/controllers/rewardsController.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

/**
 * @swagger
 * tags:
 *   name: Orders
 *   description: Order management - Create orders from reservations with controlled state transitions
 */

/**
 * @swagger
 * /api/orders:
 *   post:
 *     summary: Create a new order from an ACTIVE reservation
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reservationId
 *             properties:
 *               reservationId:
 *                 type: integer
 *                 description: ID of an ACTIVE reservation
 *     responses:
 *       201:
 *         description: Order created successfully with status CREATED
 *       400:
 *         description: Validation error (invalid reservation, buyer=seller, etc.)
 *       404:
 *         description: Reservation not found
 */
router.post('/', createOrder);

/**
 * @swagger
 * /api/orders/buyer:
 *   get:
 *     summary: Get buyer's orders with filters and pagination
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [CREATED, CONFIRMED, PENDING, PROCESSING, SHIPPED, DELIVERED, CANCELLED, COMPLETED]
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Buyer orders retrieved successfully with pagination
 */
router.get('/buyer', cacheResponse(60), getBuyerOrders);

/**
 * @swagger
 * /api/orders/seller:
 *   get:
 *     summary: Get seller's orders with filters and pagination
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [CREATED, CONFIRMED, PENDING, PROCESSING, SHIPPED, DELIVERED, CANCELLED, COMPLETED]
 *       - in: query
 *         name: buyerId
 *         schema:
 *           type: integer
 *         description: Filter by specific buyer
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Seller orders retrieved successfully with pagination
 */
router.get('/seller', cacheResponse(60), getSellerOrders);

/**
 * @swagger
 * /api/orders/stats:
 *   get:
 *     summary: Get user's buying/selling statistics
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [buyer, seller]
 *           default: buyer
 *     responses:
 *       200:
 *         description: Statistics retrieved successfully
 */
router.get('/stats', cacheResponse(300), getOrderStats);

/**
 * @swagger
 * /api/orders/export:
 *   get:
 *     summary: Export orders as CSV
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [buyer, seller]
 *       - in: query
 *         name: material
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: CSV file download
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 */
router.get('/export', exportOrders);

/**
 * @swagger
 * /api/orders:
 *   get:
 *     summary: Get user's orders with filters and pagination (legacy endpoint)
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [buyer, seller]
 *         description: Filter by buyer or seller role
 *       - in: query
 *         name: material
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [CREATED, CONFIRMED, PENDING, PROCESSING, SHIPPED, DELIVERED, CANCELLED, COMPLETED]
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Orders retrieved successfully with pagination
 */
router.get('/', cacheResponse(60), getOrders);

/**
 * @swagger
 * /api/orders/{id}:
 *   get:
 *     summary: Get a single order by ID
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Order retrieved successfully
 *       403:
 *         description: Not authorized to view this order
 *       404:
 *         description: Order not found
 */
router.get('/:id', cacheResponse(60), getOrderById);

/**
 * @swagger
 * /api/orders/{id}/confirm:
 *   post:
 *     summary: Confirm an order (seller action)
 *     description: Transition order from CREATED to CONFIRMED. Locks reservation permanently.
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Order confirmed successfully
 *       400:
 *         description: Invalid state transition or not authorized
 *       404:
 *         description: Order not found
 */
router.post('/:id/confirm', confirmOrder);

/**
 * @swagger
 * /api/orders/{id}/cancel:
 *   post:
 *     summary: Cancel an order
 *     description: |
 *       Transition order from CREATED or CONFIRMED to CANCELLED.
 *       - Releases reservation and restores listing quantity
 *       - If payment exists, automatically triggers refund (CAPTURED) or cancellation (AUTHORIZED)
 *       - Cannot cancel if payment has been RELEASED
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Reason for cancellation (used for Stripe refund)
 *     responses:
 *       200:
 *         description: Order cancelled successfully, reservation released, payment refunded if applicable
 *       400:
 *         description: Invalid state transition or payment already released
 *       404:
 *         description: Order not found
 */
router.post('/:id/cancel', cancelOrder);

/**
 * @swagger
 * /api/orders/{id}/complete:
 *   post:
 *     summary: Complete an order (seller action)
 *     description: |
 *       Transition order from CONFIRMED to COMPLETED.
 *       Requires payment to be CAPTURED first.
 *       After completion, seller can release the payment.
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Order completed successfully
 *       400:
 *         description: Payment not captured or invalid state transition
 *       404:
 *         description: Order not found
 */
router.post('/:id/complete', completeOrder);
router.post('/:id/review', submitOrderReview);

/**
 * @swagger
 * /api/orders/{id}/status:
 *   put:
 *     summary: Update order status (legacy endpoint with state validation)
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [CREATED, CONFIRMED, PENDING, PROCESSING, SHIPPED, DELIVERED, CANCELLED, COMPLETED]
 *     responses:
 *       200:
 *         description: Order updated successfully
 *       400:
 *         description: Invalid state transition
 *       404:
 *         description: Order not found
 */
router.put('/:id/status', updateOrderStatus);

export default router;
