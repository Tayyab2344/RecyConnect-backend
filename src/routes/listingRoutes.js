import express from 'express';
import { authenticateToken } from '../middlewares/authMiddleware.js';
import {
    createListing,
    getListings,
    getListingStats,
    exportListings,
    updateListingStatus,
    deleteListing
} from '../controllers/listingController.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

/**
 * @swagger
 * tags:
 *   name: Listings
 *   description: Individual user listing management (selling recyclables)
 */

/**
 * @swagger
 * /api/listings:
 *   post:
 *     summary: Create a new listing
 *     tags: [Listings]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - materialType
 *               - estimatedWeight
 *               - pickupAddress
 *             properties:
 *               materialType:
 *                 type: string
 *                 enum: [plastic, paper, metal, e-waste]
 *               estimatedWeight:
 *                 type: number
 *                 maximum: 10
 *               pickupAddress:
 *                 type: string
 *               latitude:
 *                 type: number
 *               longitude:
 *                 type: number
 *               locationMethod:
 *                 type: string
 *                 enum: [auto, manual]
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Listing created successfully
 *       400:
 *         description: Validation error (weight >10kg or missing location)
 */
router.post('/', createListing);

/**
 * @swagger
 * /api/listings:
 *   get:
 *     summary: Get user's listings with filters and pagination
 *     tags: [Listings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: material
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, COLLECTED, COMPLETED, CANCELLED]
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
 *         name: search
 *         schema:
 *           type: string
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
 *         description: Listings retrieved successfully with pagination
 */
router.get('/', getListings);

/**
 * @swagger
 * /api/listings/stats:
 *   get:
 *     summary: Get user's selling statistics
 *     tags: [Listings]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Statistics retrieved successfully
 */
router.get('/stats', getListingStats);

/**
 * @swagger
 * /api/listings/export:
 *   get:
 *     summary: Export listings as CSV
 *     tags: [Listings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
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
router.get('/export', exportListings);

/**
 * @swagger
 * /api/listings/{id}:
 *   put:
 *     summary: Update listing status
 *     tags: [Listings]
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
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [PENDING, COLLECTED, COMPLETED, CANCELLED]
 *               buyerInfo:
 *                 type: string
 *     responses:
 *       200:
 *         description: Listing updated successfully
 *       404:
 *         description: Listing not found
 */
router.put('/:id', updateListingStatus);

/**
 * @swagger
 * /api/listings/{id}:
 *   delete:
 *     summary: Delete a listing
 *     tags: [Listings]
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
 *         description: Listing deleted successfully
 *       404:
 *         description: Listing not found
 */
router.delete('/:id', deleteListing);

export default router;
