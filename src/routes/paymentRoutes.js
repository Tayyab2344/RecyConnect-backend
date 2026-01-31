import express from 'express';
import { authenticateToken } from '../middlewares/authMiddleware.js';
import {
    createPaymentIntent,
    authorizePayment,
    capturePayment,
    releasePayment,
    refundPayment,
    getPaymentStatus,
    getPaymentById
} from '../controllers/paymentController.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

/**
 * @swagger
 * tags:
 *   name: Payments
 *   description: Stripe payment management with PaymentIntents
 */

/**
 * @swagger
 * /api/payments/create-intent:
 *   post:
 *     summary: Create a Stripe PaymentIntent for a confirmed order
 *     description: Creates a PaymentIntent and returns client_secret for frontend payment confirmation. Only allowed for CONFIRMED orders.
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - orderId
 *             properties:
 *               orderId:
 *                 type: integer
 *                 description: ID of the confirmed order
 *     responses:
 *       201:
 *         description: PaymentIntent created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     paymentId:
 *                       type: integer
 *                     clientSecret:
 *                       type: string
 *                       description: Stripe client_secret for frontend use
 *                     paymentIntentId:
 *                       type: string
 *                     amount:
 *                       type: number
 *                     currency:
 *                       type: string
 *       400:
 *         description: Order not confirmed or payment already exists
 *       404:
 *         description: Order not found
 */
router.post('/create-intent', createPaymentIntent);

/**
 * @swagger
 * /api/payments/order/{orderId}:
 *   get:
 *     summary: Get payment status by order ID
 *     description: Retrieves payment details and syncs with Stripe for latest status
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Payment status retrieved
 *       403:
 *         description: Not authorized to view this payment
 *       404:
 *         description: Payment not found
 */
router.get('/order/:orderId', getPaymentStatus);

/**
 * @swagger
 * /api/payments/{id}:
 *   get:
 *     summary: Get payment by ID
 *     tags: [Payments]
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
 *         description: Payment retrieved
 *       403:
 *         description: Not authorized
 *       404:
 *         description: Payment not found
 */
router.get('/:id', getPaymentById);

/**
 * @swagger
 * /api/payments/{id}/authorize:
 *   post:
 *     summary: Authorize a payment
 *     description: Verifies PaymentIntent status from Stripe and transitions payment from INITIATED to AUTHORIZED
 *     tags: [Payments]
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
 *         description: Payment authorized successfully
 *       400:
 *         description: Invalid state transition or payment not ready
 */
router.post('/:id/authorize', authorizePayment);

/**
 * @swagger
 * /api/payments/{id}/capture:
 *   post:
 *     summary: Capture an authorized payment
 *     description: Captures funds from an authorized PaymentIntent. Transitions AUTHORIZED to CAPTURED. Seller only.
 *     tags: [Payments]
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
 *         description: Payment captured successfully
 *       400:
 *         description: Payment not in AUTHORIZED status
 */
router.post('/:id/capture', capturePayment);

/**
 * @swagger
 * /api/payments/{id}/release:
 *   post:
 *     summary: Release a captured payment
 *     description: Marks payment as settled after order completion. Transitions CAPTURED to RELEASED. Seller only. Order must be COMPLETED.
 *     tags: [Payments]
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
 *         description: Payment released and settled
 *       400:
 *         description: Order not completed or payment not captured
 */
router.post('/:id/release', releasePayment);

/**
 * @swagger
 * /api/payments/{id}/refund:
 *   post:
 *     summary: Refund a payment
 *     description: Issues a refund via Stripe. Only allowed if order is CANCELLED and payment is CAPTURED or AUTHORIZED. Cannot refund after RELEASED.
 *     tags: [Payments]
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
 *                 enum: [duplicate, fraudulent, requested_by_customer]
 *                 default: requested_by_customer
 *     responses:
 *       200:
 *         description: Payment refunded successfully
 *       400:
 *         description: Cannot refund (order not cancelled, payment already released, etc.)
 */
router.post('/:id/refund', refundPayment);

export default router;
