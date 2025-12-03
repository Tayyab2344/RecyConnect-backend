
import express from 'express';
import { registerKyc, getKycStatus, approveKyc, rejectKyc } from '../controllers/kycController.js';
import { authenticateToken } from '../middlewares/authMiddleware.js';
import { permit } from '../middlewares/roleMiddleware.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: KYC
 *   description: Automatic OCR-based KYC verification system
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     KYCApprovalResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: "KYC approved! Your documents have been verified successfully."
 *         status:
 *           type: string
 *           enum: [APPROVED]
 *           example: APPROVED
 *         cnic:
 *           type: string
 *           example: "12345-1234567-1"
 *     
 *     KYCRejectionResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         error:
 *           type: object
 *           properties:
 *             message:
 *               type: string
 *               example: "OCR failed to extract valid CNIC from uploaded documents. Please ensure images are clear and readable."
 *             status:
 *               type: string
 *               enum: [REJECTED]
 *               example: REJECTED
 *     
 *     KYCStatusResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         kycStatus:
 *           type: string
 *           enum: [PENDING, APPROVED, REJECTED, BLOCKED]
 *           example: APPROVED
 *         kycStage:
 *           type: string
 *           enum: [REGISTERED, DOCUMENTS_UPLOADED, OCR_VERIFIED, APPROVED, REJECTED]
 *           example: APPROVED
 *         cnic:
 *           type: string
 *           nullable: true
 *           example: "12345-1234567-1"
 *         rejectionReason:
 *           type: string
 *           nullable: true
 *           example: null
 */

/**
 * @swagger
 * /api/kyc/register:
 *   post:
 *     summary: Submit KYC documents for automatic verification
 *     description: |
 *       Upload KYC documents for automatic OCR-based verification. The system will:
 *       1. Extract CNIC from uploaded images using OCR
 *       2. Validate CNIC format (13 digits)
 *       3. Check CNIC uniqueness (no duplicates)
 *       4. For companies: Extract and validate NTN (8 digits)
 *       5. **Automatically approve or reject** based on validation results
 *       
 *       **Auto-Approval Criteria:**
 *       - CNIC successfully extracted and valid
 *       - CNIC is unique (not already registered)
 *       - For companies: NTN successfully extracted and valid
 *       
 *       **Auto-Rejection Reasons:**
 *       - OCR extraction failed
 *       - Invalid CNIC/NTN format
 *       - Duplicate CNIC
 *       - Missing required documents
 *     tags: [KYC]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - frontCnic
 *               - backCnic
 *             properties:
 *               frontCnic:
 *                 type: string
 *                 format: binary
 *                 description: Front side of CNIC (clear, high-quality image)
 *               backCnic:
 *                 type: string
 *                 format: binary
 *                 description: Back side of CNIC (clear, high-quality image)
 *               ntn:
 *                 type: string
 *                 format: binary
 *                 description: NTN certificate (required for companies only)
 *               utilityBill:
 *                 type: string
 *                 format: binary
 *                 description: Recent utility bill (optional)
 *               profilePicture:
 *                 type: string
 *                 format: binary
 *                 description: Profile picture (optional)
 *     responses:
 *       200:
 *         description: KYC automatically approved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/KYCApprovalResponse'
 *       400:
 *         description: KYC automatically rejected with reason
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/KYCStatusResponse'
 *             examples:
 *               approved:
 *                 summary: Approved KYC
 *                 value:
 *                   success: true
 *                   kycStatus: APPROVED
 *                   kycStage: APPROVED
 *                   cnic: "12345-1234567-1"
 *                   rejectionReason: null
 *               rejected:
 *                 summary: Rejected KYC
 *                 value:
 *                   success: true
 *                   kycStatus: REJECTED
 *                   kycStage: REJECTED
 *                   cnic: null
 *                   rejectionReason: "OCR failed to extract valid CNIC from uploaded documents. Please ensure images are clear and readable."
 *       401:
 *         description: Unauthorized - Invalid or missing token
 */
router.post('/register', authenticateToken, permit('warehouse', 'company', 'collector'), registerKyc);

/**
 * @swagger
 * /api/kyc/status:
 *   get:
 *     summary: Get current user's KYC status
 *     description: Retrieve the current KYC verification status, stage, and rejection reason (if any)
 *     tags: [KYC]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: KYC status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/KYCStatusResponse'
 *             examples:
 *               approved:
 *                 summary: Approved KYC
 *                 value:
 *                   success: true
 *                   kycStatus: APPROVED
 *                   kycStage: APPROVED
 *                   cnic: "12345-1234567-1"
 *                   rejectionReason: null
 *               rejected:
 *                 summary: Rejected KYC
 *                 value:
 *                   success: true
 *                   kycStatus: REJECTED
 *                   kycStage: REJECTED
 *                   cnic: null
 *                   rejectionReason: "OCR failed to extract valid CNIC from uploaded documents. Please ensure images are clear and readable."
 *       401:
 *         description: Unauthorized - Invalid or missing token
 */
router.get('/status', authenticateToken, getKycStatus);

/**
 * @swagger
 * /api/kyc/approve/{userId}:
 *   post:
 *     summary: Manually approve user's KYC (Admin only)
 *     description: Admin can manually override automatic OCR decision and approve KYC
 *     tags: [KYC]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *         description: User ID to approve
 *         example: 123
 *     responses:
 *       200:
 *         description: KYC approved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "KYC approved"
 *       401:
 *         description: Unauthorized - Invalid or missing token
 *       403:
 *         description: Forbidden - Admin access required
 */
router.post('/approve/:userId', authenticateToken, permit('admin'), approveKyc);

/**
 * @swagger
 * /api/kyc/reject/{userId}:
 *   post:
 *     summary: Manually reject user's KYC (Admin only)
 *     description: Admin can manually override automatic OCR decision and reject KYC with custom reason
 *     tags: [KYC]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *         description: User ID to reject
 *         example: 123
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Reason for rejection
 *                 example: "Documents do not match user information"
 *     responses:
 *       200:
 *         description: KYC rejected successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "KYC rejected"
 *       401:
 *         description: Unauthorized - Invalid or missing token
 *       403:
 *         description: Forbidden - Admin access required
 */
router.post('/reject/:userId', authenticateToken, permit('admin'), rejectKyc);

export default router;
