import express from 'express';
import { reserveListing, releaseReservation } from '../controllers/reservationController.js';
import { authenticateToken } from '../middlewares/authMiddleware.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Reservations
 *   description: Listing inventory reservation management
 */

/**
 * @swagger
 * /api/reservations:
 *   post:
 *     summary: Reserve a specific quantity of a listing
 *     tags: [Reservations]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - listingId
 *               - quantity
 *             properties:
 *               listingId:
 *                 type: integer
 *               quantity:
 *                 type: number
 *                 description: Amount to reserve (in kg/units)
 *     responses:
 *       201:
 *         description: Reservation created successfully
 *       400:
 *         description: Invalid input or insufficient stock
 *       404:
 *         description: Listing not found
 */
router.post('/', authenticateToken, reserveListing);

/**
 * @swagger
 * /api/reservations/{id}/release:
 *   post:
 *     summary: Manually release an active reservation
 *     tags: [Reservations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Reservation ID
 *     responses:
 *       200:
 *         description: Reservation released and stock restored
 *       400:
 *         description: Reservation not found or not active
 */
router.post('/:id/release', authenticateToken, releaseReservation);

export default router;
