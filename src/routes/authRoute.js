import express from "express";
import { body } from "express-validator";
import multer from "multer";
import {
  register,
  verifyOtpController,
  login,
  forgotPassword,
  resetPassword,
  changePassword,
  registerCollector,
  createCollector,
  me,
  updateProfile,
  logout,
  refreshToken,
  resendOtp,
  analyzeDocument
} from '../controllers/authController.js'
import { authenticateToken } from "../middlewares/authMiddleware.js";

const upload = multer({ dest: "tmp/" });
const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: User authentication and profile management endpoints
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         name:
 *           type: string
 *         email:
 *           type: string
 *         role:
 *           type: string
 *           enum: [individual, warehouse, company, collector, admin]
 *         profileImage:
 *           type: string
 *         collectorId:
 *           type: string
 *         businessName:
 *           type: string
 *         companyName:
 *           type: string
 *         emailVerified:
 *           type: boolean
 *         createdAt:
 *           type: string
 *           format: date-time
 *     Error:
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
 */

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     description: Register individual, warehouse, or company. Warehouse/company require document uploads (CNIC, utility, NTN). OTP sent to email for verification.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - role
 *               - email
 *               - password
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [individual, warehouse, company]
 *               name:
 *                 type: string
 *                 description: Required for individual
 *               businessName:
 *                 type: string
 *                 description: Required for warehouse
 *               companyName:
 *                 type: string
 *                 description: Required for company
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 6
 *               profileImage:
 *                 type: string
 *                 format: binary
 *                 description: Optional for individual
 *               cnic:
 *                 type: string
 *                 format: binary
 *                 description: Required for warehouse and company
 *               utility:
 *                 type: string
 *                 format: binary
 *                 description: Required for company
 *               ntn:
 *                 type: string
 *                 format: binary
 *                 description: Required for company
 *               extraDocs:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       201:
 *         description: User registered, OTP sent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */

/**
 * @swagger
 * /api/auth/verify-otp:
 *   post:
 *     summary: Verify email with OTP
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - otp
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               otp:
 *                 type: string
 *                 minLength: 4
 *     responses:
 *       200:
 *         description: Email verified
 *       400:
 *         description: Invalid OTP
 *       404:
 *         description: User not found
 */

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login with email/collectorId and password
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - identifier
 *               - password
 *             properties:
 *               identifier:
 *                 type: string
 *                 description: Email or Collector ID
 *               password:
 *                 type: string
 *                 minLength: 6
 *     responses:
 *       200:
 *         description: Login successful
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
 *                     accessToken:
 *                       type: string
 *                     refreshToken:
 *                       type: string
 *                     role:
 *                       type: string
 *                     name:
 *                       type: string
 *                     collectorId:
 *                       type: string
 *       400:
 *         description: Invalid credentials
 *       403:
 *         description: Email not verified
 */

/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     summary: Request password reset OTP
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: OTP sent if account exists
 */

/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     summary: Reset password with OTP
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - otp
 *               - newPassword
 *             properties:
 *               email:
 *                 type: string
 *               otp:
 *                 type: string
 *               newPassword:
 *                 type: string
 *                 minLength: 6
 *     responses:
 *       200:
 *         description: Password reset successfully
 *       400:
 *         description: Invalid OTP
 */

/**
 * @swagger
 * /api/auth/change-password:
 *   post:
 *     summary: Change password (authenticated)
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currentPassword
 *               - newPassword
 *             properties:
 *               currentPassword:
 *                 type: string
 *               newPassword:
 *                 type: string
 *                 minLength: 6
 *     responses:
 *       200:
 *         description: Password changed
 *       400:
 *         description: Current password incorrect
 *       401:
 *         description: Unauthorized
 */

/**
 * @swagger
 * /api/auth/register-collector:
 *   post:
 *     summary: Complete collector registration
 *     description: Collectors use warehouse-provided ID to set password and complete registration
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - collectorId
 *               - password
 *             properties:
 *               collectorId:
 *                 type: string
 *               password:
 *                 type: string
 *                 minLength: 6
 *               name:
 *                 type: string
 *     responses:
 *       200:
 *         description: Collector registered
 *       400:
 *         description: Already registered
 *       404:
 *         description: Invalid collector ID
 */

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get current user profile
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 *   put:
 *     summary: Update user profile
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               businessName:
 *                 type: string
 *               companyName:
 *                 type: string
 *               profileImage:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Profile updated
 *       400:
 *         description: No changes provided
 *       401:
 *         description: Unauthorized
 */

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Logout user
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out
 *       401:
 *         description: Unauthorized
 */

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Refresh access token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: New tokens generated
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
 *                     accessToken:
 *                       type: string
 *                     refreshToken:
 *                       type: string
 *       401:
 *         description: Invalid refresh token
 */

// Enhanced validation rules
const passwordValidation = body("password")
  .isLength({ min: 8 })
  .withMessage("Password must be at least 8 characters long")
  .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
  .withMessage("Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character");

const emailValidation = body("email")
  .isEmail()
  .withMessage("Please provide a valid email address")
  .normalizeEmail();

const nameValidation = body("name")
  .optional()
  .trim()
  .isLength({ min: 2, max: 50 })
  .withMessage("Name must be between 2 and 50 characters")
  .matches(/^[a-zA-Z\s]+$/)
  .withMessage("Name can only contain letters and spaces");

const businessNameValidation = body("businessName")
  .optional()
  .trim()
  .isLength({ min: 2, max: 100 })
  .withMessage("Business name must be between 2 and 100 characters")
  .matches(/^[a-zA-Z0-9\s&.-]+$/)
  .withMessage("Business name contains invalid characters");

const companyNameValidation = body("companyName")
  .optional()
  .trim()
  .isLength({ min: 2, max: 100 })
  .withMessage("Company name must be between 2 and 100 characters")
  .matches(/^[a-zA-Z0-9\s&.-]+$/)
  .withMessage("Company name contains invalid characters");

const roleValidation = body("role")
  .isIn(["individual", "warehouse", "company"])
  .withMessage("Role must be individual, warehouse, or company");

const otpValidation = body("otp")
  .isLength({ min: 6, max: 6 })
  .withMessage("OTP must be exactly 6 digits")
  .isNumeric()
  .withMessage("OTP must contain only numbers");

const collectorIdValidation = body("collectorId")
  .trim()
  .isLength({ min: 3, max: 20 })
  .withMessage("Collector ID must be between 3 and 20 characters")
  .matches(/^[a-zA-Z0-9_-]+$/)
  .withMessage("Collector ID can only contain letters, numbers, hyphens, and underscores");

router.post(
  "/register",
  upload.fields([
    { name: "profileImage" },
    { name: "cnic" },
    { name: "utility" },
    { name: "ntn" },
    { name: "extraDocs" },
  ]),
  [
    roleValidation,
    emailValidation,
    passwordValidation,
    nameValidation,
    businessNameValidation,
    companyNameValidation
  ],
  register
);

router.post(
  "/analyze-document",
  upload.single("document"),
  analyzeDocument
);

router.post(
  "/verify-otp",
  [emailValidation, otpValidation],
  verifyOtpController
);
router.post(
  "/login",
  [
    body("identifier")
      .trim()
      .notEmpty()
      .withMessage("Email or Collector ID is required"),
    body("password")
      .notEmpty()
      .withMessage("Password is required")
  ],
  login
);
router.post(
  "/forgot-password",
  [emailValidation],
  forgotPassword
);

router.post(
  "/reset-password",
  [
    emailValidation,
    otpValidation,
    body("newPassword")
      .isLength({ min: 8 })
      .withMessage("New password must be at least 8 characters long")
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .withMessage("New password must contain at least one uppercase letter, one lowercase letter, one number, and one special character")
  ],
  resetPassword
);

router.post(
  "/change-password",
  authenticateToken,
  [
    body("currentPassword")
      .notEmpty()
      .withMessage("Current password is required"),
    body("newPassword")
      .isLength({ min: 8 })
      .withMessage("New password must be at least 8 characters long")
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .withMessage("New password must contain at least one uppercase letter, one lowercase letter, one number, and one special character")
  ],
  changePassword
);

router.post(
  "/register-collector",
  [
    collectorIdValidation,
    passwordValidation,
    nameValidation.notEmpty().withMessage("Name is required for collector registration")
  ],
  registerCollector
);
router.get("/me", authenticateToken, me);
router.put("/me", authenticateToken, upload.single("profileImage"), updateProfile);
router.post("/logout", authenticateToken, logout);
router.post("/refresh", body("refreshToken").notEmpty(), refreshToken);
router.post(
  "/resend-otp",
  [emailValidation],
  resendOtp
);

router.post(
  "/create-collector",
  authenticateToken,
  [
    body("name").notEmpty().withMessage("Collector name is required"),
    body("collectorId").optional().trim().matches(/^[a-zA-Z0-9_-]+$/).withMessage("Invalid ID format")
  ],
  createCollector
);

export default router;
