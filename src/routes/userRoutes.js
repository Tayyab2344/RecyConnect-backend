import express from "express";
import { getProfile, changePassword, updateProfile, requestRoleUpgrade, checkCnic } from "../controllers/userController.js";
import { authenticateToken } from "../middlewares/authMiddleware.js";
import multer from "multer";

const upload = multer({ dest: "tmp/" });
const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: User
 *   description: User profile and role management
 */

/**
 * @swagger
 * /api/user/profile:
 *   get:
 *     summary: Get user profile
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profile retrieved successfully
 */
router.get("/profile", authenticateToken, getProfile);

/**
 * @swagger
 * /api/user/profile/password:
 *   put:
 *     summary: Change user password
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
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
 *     responses:
 *       200:
 *         description: Password changed successfully
 */
router.put("/profile/password", authenticateToken, changePassword);

/**
 * @swagger
 * /api/user/profile:
 *   put:
 *     summary: Update user profile
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *               contactNo:
 *                 type: string
 *               address:
 *                 type: string
 *               latitude:
 *                 type: number
 *               longitude:
 *                 type: number
 *               locationMethod:
 *                 type: string
 *               password:
 *                 type: string
 *               profileImage:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Profile updated
 */
router.put(
    "/profile",
    authenticateToken,
    upload.single("profileImage"),
    updateProfile
);

/**
 * @swagger
 * /api/user/upgrade-role:
 *   post:
 *     summary: Request role upgrade
 *     description: Upgrade from Individual to Warehouse/Company or Warehouse to Company. Requires documents.
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - requestedRole
 *               - address
 *             properties:
 *               requestedRole:
 *                 type: string
 *                 enum: [warehouse, company]
 *               businessName:
 *                 type: string
 *               companyName:
 *                 type: string
 *               address:
 *                 type: string
 *               cnicFront:
 *                 type: string
 *                 format: binary
 *               cnicBack:
 *                 type: string
 *                 format: binary
 *               ntn:
 *                 type: string
 *                 format: binary
 *               registration:
 *                 type: string
 *                 format: binary
 *               utility:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Upgrade request submitted
 */
router.post(
    "/upgrade-role",
    authenticateToken,
    upload.fields([
        { name: "cnicFront", maxCount: 1 },
        { name: "cnicBack", maxCount: 1 },
        { name: "ntn", maxCount: 1 },
        { name: "registration", maxCount: 1 },
        { name: "utility", maxCount: 1 }
    ]),
    requestRoleUpgrade
);

/**
 * @swagger
 * /api/user/check-cnic/{cnic}:
 *   get:
 *     summary: Check if CNIC is already registered
 *     tags: [User]
 *     parameters:
 *       - in: path
 *         name: cnic
 *         required: true
 *         schema:
 *           type: string
 *         description: CNIC number (13 digits, with or without dashes)
 *     responses:
 *       200:
 *         description: CNIC check result
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
 *                     exists:
 *                       type: boolean
 *                     role:
 *                       type: string
 */
router.get("/check-cnic/:cnic", checkCnic);

export default router;
