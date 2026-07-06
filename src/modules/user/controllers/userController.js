import bcrypt from "bcrypt";
import {
  deleteCloudinaryAsset,
  encryptedDocumentData,
  uploadEncryptedToCloudinary,
  uploadToCloudinary,
} from '../../../utils/uploadHelper.js';
import {
  extractTextFromUrl,
  extractCNIC,
  extractNTN,
} from '../../../services/ocrService.js';
import { logger } from '../../../utils/logger.js';
import { UserRole, VerificationStatus, KycStage } from '../../../constants/enums.js';
import { sendSuccess, sendError } from '../../../utils/responseHelper.js';
import prisma from '../../../lib/prisma.js';
import { logActivity } from '../../../utils/activityLogger.js';

// Helper to validate allowed transitions
function isValidTransition(currentRole, requestedRole) {
  if (
    currentRole === UserRole.INDIVIDUAL &&
    (requestedRole === UserRole.WAREHOUSE || requestedRole === UserRole.COMPANY)
  )
    return true;
  if (currentRole === UserRole.WAREHOUSE && requestedRole === UserRole.COMPANY)
    return true;
  return false;
}

/**
 * Get user profile
 * GET /api/profile
 */
export async function getProfile(req, res) {
  try {
    const userId = req.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        contactNo: true,
        address: true,
        city: true,
        area: true,
        role: true,
        profileImage: true,
        latitude: true,
        longitude: true,
        locationMethod: true,
        businessName: true,
        companyName: true,
        verificationStatus: true,
        createdAt: true,
        ecoPoints: true,
        currentLevel: true,
        badges: {
          select: {
            badgeName: true,
            earnedAt: true,
          }
        }
      },
    });

    if (!user) {
      return sendError(res, "User not found", null, 404);
    }

    sendSuccess(res, "Profile fetched", user);
  } catch (err) {
    sendError(res, "Failed to fetch profile", err);
  }
}

/**
 * Save the current device FCM token for push notifications.
 * POST /api/user/fcm-token
 */
export async function updateFcmToken(req, res) {
  try {
    const userId = req.user.id;
    const { fcmToken } = req.body;

    if (!fcmToken || typeof fcmToken !== "string") {
      return sendError(res, "fcmToken is required", null, 400);
    }

    await prisma.user.update({
      where: { id: userId },
      data: { fcmToken },
    });

    sendSuccess(res, "FCM token saved successfully", { saved: true });
  } catch (err) {
    sendError(res, "Failed to save FCM token", err);
  }
}

/**
 * Change password
 * PUT /api/profile/password
 */
export async function changePassword(req, res) {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    // Validation
    if (!currentPassword || !newPassword) {
      return sendError(
        res,
        "Current password and new password are required",
        null,
        400,
      );
    }

    if (newPassword.length < 6) {
      return sendError(
        res,
        "New password must be at least 6 characters long",
        null,
        400,
      );
    }

    // Get user with password
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.password) {
      return sendError(res, "User not found", null, 404);
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(
      currentPassword,
      user.password,
    );
    if (!isValidPassword) {
      return sendError(res, "Current password is incorrect", null, 401);
    }

    // Hash new password and update
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: req.user.id },
      data: { password: hashedPassword },
    });

    await logActivity({
      action: "CHANGE_PASSWORD",
      req,
    });

    sendSuccess(res, "Password changed successfully");
  } catch (err) {
    sendError(res, "Failed to change password", err);
  }
}

export async function updateProfile(req, res) {
  try {
    const userId = req.user.id;
    const {
      name,
      email,
      contactNo,
      address,
      city,
      area,
      password,
      latitude,
      longitude,
      locationMethod,
    } = req.body;

    const updates = {};
    if (name) updates.name = name;
    if (email) updates.email = email;
    if (contactNo) updates.contactNo = contactNo;
    if (address) updates.address = address;
    if (city) updates.city = city;
    if (area) updates.area = area;
    if (latitude !== undefined) updates.latitude = parseFloat(latitude);
    if (longitude !== undefined) updates.longitude = parseFloat(longitude);
    if (locationMethod) updates.locationMethod = locationMethod;

    if (password) {
      updates.password = await bcrypt.hash(password, 10);
    }

    if (req.file) {
      const result = await uploadToCloudinary(
        req.file,
        `recyconnect/profile/${userId}`,
      );
      updates.profileImage = result.secure_url;
    }

    if (Object.keys(updates).length === 0) {
      return sendError(res, "No changes provided", null, 400);
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updates,
    });

    await logActivity({
      action: "UPDATE_PROFILE",
      req,
    });

    const { password: _, ...userWithoutPassword } = updatedUser;

    sendSuccess(res, "Profile updated successfully", userWithoutPassword);
  } catch (err) {
    sendError(res, "Failed to update profile", err);
  }
}

export async function requestRoleUpgrade(req, res) {
  try {
    const userId = req.user.id;
    const currentRole = req.user.role;
    const { requestedRole, businessName, companyName, address } = req.body;

    // 1. Validate Transition
    if (!isValidTransition(currentRole, requestedRole)) {
      return sendError(
        res,
        `Invalid role transition from ${currentRole} to ${requestedRole}`,
        null,
        400,
      );
    }

    // 2. Check for pending request
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (
      user.verificationStatus === VerificationStatus.PENDING &&
      user.requestedRole
    ) {
      return sendError(
        res,
        "You already have a pending upgrade request",
        null,
        400,
      );
    }

    // 3. Handle File Uploads & Validation
    const files = req.files || {};
    const documentsData = [];
    let ocrCnic = null;
    let ocrNtn = null;

    // Common Requirements
    if (!address)
      return sendError(res, "Address is required for upgrade", null, 400);

    // Role Specific Requirements
    if (requestedRole === UserRole.WAREHOUSE) {
      if (!businessName)
        return sendError(res, "Business Name is required", null, 400);
      if (!files.cnicFront?.[0] || !files.cnicBack?.[0]) {
        return sendError(res, "CNIC Front and Back are required", null, 400);
      }

      // Upload & OCR CNIC
      const frontFile = files.cnicFront[0];
      const backFile = files.cnicBack[0];

      const ocrFront = await uploadToCloudinary(
        frontFile,
        `recyconnect/kyc-ocr/${userId}`,
      );
      const ocrBack = await uploadToCloudinary(
        backFile,
        `recyconnect/kyc-ocr/${userId}`,
      );

      // OCR Check
      const frontText = await extractTextFromUrl(ocrFront.secure_url);
      const backText = await extractTextFromUrl(ocrBack.secure_url);
      await Promise.all([
        deleteCloudinaryAsset(ocrFront),
        deleteCloudinaryAsset(ocrBack),
      ]);
      ocrCnic = extractCNIC(frontText) || extractCNIC(backText);

      if (!ocrCnic) {
        return sendError(
          res,
          "Could not verify CNIC from uploaded images. Please upload clear images.",
          null,
          400,
        );
      }

      const upFront = await uploadEncryptedToCloudinary(
        frontFile,
        `recyconnect/kyc/${userId}`,
      );
      const upBack = await uploadEncryptedToCloudinary(
        backFile,
        `recyconnect/kyc/${userId}`,
      );

      documentsData.push(
        encryptedDocumentData("CNIC_FRONT", frontFile, upFront),
        encryptedDocumentData("CNIC_BACK", backFile, upBack),
      );
    }

    if (requestedRole === UserRole.COMPANY) {
      if (!companyName)
        return sendError(res, "Company Name is required", null, 400);
      if (!files.ntn?.[0] || !files.registration?.[0]) {
        return sendError(
          res,
          "NTN and Registration Certificate are required",
          null,
          400,
        );
      }

      // Upload & OCR NTN
      const ntnFile = files.ntn[0];
      const regFile = files.registration[0];

      const ocrNtnUpload = await uploadToCloudinary(
        ntnFile,
        `recyconnect/kyc-ocr/${userId}`,
      );

      // OCR Check
      const ntnText = await extractTextFromUrl(ocrNtnUpload.secure_url);
      await deleteCloudinaryAsset(ocrNtnUpload);
      ocrNtn = extractNTN(ntnText);

      if (!ocrNtn) {
        return sendError(
          res,
          "Could not verify NTN from uploaded document.",
          null,
          400,
        );
      }

      const upNtn = await uploadEncryptedToCloudinary(
        ntnFile,
        `recyconnect/kyc/${userId}`,
      );
      const upReg = await uploadEncryptedToCloudinary(
        regFile,
        `recyconnect/kyc/${userId}`,
      );

      documentsData.push(
        encryptedDocumentData("NTN", ntnFile, upNtn),
        encryptedDocumentData("REGISTRATION", regFile, upReg),
      );
    }

    // Utility Bill (Required for both)
    if (files.utility?.[0]) {
      const utilFile = files.utility[0];
      const upUtil = await uploadEncryptedToCloudinary(
        utilFile,
        `recyconnect/kyc/${userId}`,
      );
      documentsData.push(encryptedDocumentData("UTILITY", utilFile, upUtil));
    } else {
      return sendError(res, "Utility Bill is required", null, 400);
    }

    // 4. Update User & Create Documents (Auto-Approve)
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          role: requestedRole,
          requestedRole: null,
          verificationStatus: VerificationStatus.VERIFIED,
          kycStage: KycStage.VERIFIED,
          businessName: businessName || undefined,
          companyName: companyName || undefined,
          address: address,
          cnic: ocrCnic || undefined,
        },
      });

      if (documentsData.length > 0) {
        await tx.userDocument.createMany({
          data: documentsData.map((d) => ({ ...d, userId })),
        });
      }

      // Log OCR Data
      if (ocrCnic || ocrNtn) {
        await tx.ocrData.create({
          data: {
            userId,
            docType: ocrCnic ? "CNIC" : "NTN",
            ocrText: "Extracted during upgrade",
            fileUrl: "N/A",
            extractedData: { cnic: ocrCnic, ntn: ocrNtn },
            isMatch: true,
            confidence: 1.0,
          },
        });
      }

      await tx.activityLog.create({
        data: {
          userId,
          actorRole: currentRole,
          action: "ROLE_UPGRADE_AUTO_APPROVED",
          meta: {
            from: currentRole,
            to: requestedRole,
            reason: "OCR Verified",
          },
        },
      });
    });

    sendSuccess(
      res,
      "Role upgrade approved successfully. Your account has been upgraded.",
    );
  } catch (err) {
    sendError(res, "Failed to process role upgrade request", err);
  }
}

/**
 * Check if CNIC is already registered
 * GET /api/user/check-cnic/:cnic
 */
export async function checkCnic(req, res) {
  try {
    const { cnic } = req.params;

    if (!cnic) {
      return sendError(res, "CNIC is required", null, 400);
    }

    // Clean the CNIC (remove dashes)
    const cleanedCnic = cnic.replace(/-/g, "");

    // Validate format (13 digits)
    if (!/^\d{13}$/.test(cleanedCnic)) {
      return sendError(
        res,
        "Invalid CNIC format. Must be 13 digits.",
        null,
        400,
      );
    }

    // Check if CNIC exists in any user (with or without dashes)
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { cnic: cleanedCnic },
          {
            cnic: `${cleanedCnic.slice(0, 5)}-${cleanedCnic.slice(5, 12)}-${cleanedCnic.slice(12)}`,
          },
        ],
        deletedAt: null,
      },
      select: {
        id: true,
        role: true,
      },
    });

    if (existingUser) {
      return sendSuccess(res, "CNIC check completed", {
        exists: true,
        role: existingUser.role,
      });
    }

    sendSuccess(res, "CNIC check completed", { exists: false });
  } catch (err) {
    sendError(res, "Failed to check CNIC", err);
  }
}

/**
 * Delete user account and all related data
 * DELETE /api/user/account
 */
export async function deleteAccount(req, res) {
  try {
    const userId = req.user.id;
    const { password } = req.body;

    if (!password) {
      return sendError(
        res,
        "Password is required to delete account",
        null,
        400,
      );
    }

    // 1. Verify user exists and password is correct
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.password) {
      return sendError(res, "User not found", null, 404);
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return sendError(res, "Incorrect password", null, 401);
    }

    // 2. Delete all related data in a transaction (respecting FK order)
    await prisma.$transaction(async (tx) => {
      // --- Chat data ---
      // Delete messages in conversations where user is a participant
      const userConversations = await tx.conversation.findMany({
        where: {
          OR: [{ participant1Id: userId }, { participant2Id: userId }],
        },
        select: { id: true },
      });
      const conversationIds = userConversations.map((c) => c.id);

      if (conversationIds.length > 0) {
        await tx.message.deleteMany({
          where: { conversationId: { in: conversationIds } },
        });
        await tx.conversation.deleteMany({
          where: { id: { in: conversationIds } },
        });
      }

      // Delete messages sent by user in other conversations (edge case)
      await tx.message.deleteMany({ where: { senderId: userId } });

      // --- Financial data ---
      await tx.financialTransaction.deleteMany({
        where: { warehouseId: userId },
      });
      await tx.expense.deleteMany({ where: { warehouseId: userId } });

      // --- Inventory data ---
      const userInventory = await tx.warehouseInventory.findMany({
        where: { warehouseId: userId },
        select: { id: true },
      });
      const inventoryIds = userInventory.map((i) => i.id);
      if (inventoryIds.length > 0) {
        await tx.inventoryMovement.deleteMany({
          where: { inventoryId: { in: inventoryIds } },
        });
      }
      await tx.inventoryMovement.deleteMany({ where: { performedBy: userId } });
      await tx.warehouseInventory.deleteMany({
        where: { warehouseId: userId },
      });
      await tx.warehouseInventory.deleteMany({ where: { supplierId: userId } });

      // --- Orders where user is buyer or seller ---
      const userOrders = await tx.order.findMany({
        where: {
          OR: [{ buyerId: userId }, { sellerId: userId }],
        },
        select: { id: true },
      });
      const orderIds = userOrders.map((o) => o.id);

      if (orderIds.length > 0) {
        // Delete financial transactions linked to orders
        await tx.financialTransaction.deleteMany({
          where: { orderId: { in: orderIds } },
        });
        // Delete payments linked to orders
        await tx.payment.deleteMany({
          where: { orderId: { in: orderIds } },
        });
        // Delete reservations linked to orders
        await tx.listingReservation.deleteMany({
          where: { orderId: { in: orderIds } },
        });
        // Delete order items
        await tx.orderItem.deleteMany({
          where: { orderId: { in: orderIds } },
        });
        // Delete orders
        await tx.order.deleteMany({
          where: { id: { in: orderIds } },
        });
      }

      // --- Reservations as buyer (not linked to orders) ---
      await tx.listingReservation.deleteMany({ where: { buyerId: userId } });

      // --- Listings owned by user ---
      const userListings = await tx.listing.findMany({
        where: { userId },
        select: { id: true },
      });
      const listingIds = userListings.map((l) => l.id);
      if (listingIds.length > 0) {
        // Delete reservations on user's listings
        await tx.listingReservation.deleteMany({
          where: { listingId: { in: listingIds } },
        });
        // Delete order items referencing user's listings
        await tx.orderItem.deleteMany({
          where: { listingId: { in: listingIds } },
        });
        // Delete listings
        await tx.listing.deleteMany({ where: { userId } });
      }

      // --- Transactions ---
      await tx.transaction.deleteMany({
        where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
      });

      // --- Items ---
      await tx.item.deleteMany({ where: { sellerId: userId } });

      // --- Auth & profile data ---
      await tx.otp.deleteMany({ where: { userId } });
      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.activityLog.deleteMany({ where: { userId } });
      await tx.ocrData.deleteMany({ where: { userId } });
      await tx.userDocument.deleteMany({ where: { userId } });

      // --- Finally, delete the user ---
      await tx.user.delete({ where: { id: userId } });
    });

    await logActivity({
      action: "ACCOUNT_DELETED",
      meta: { userId, email: user.email, reason: req.body.reason },
      req,
    });

    sendSuccess(res, "Account deleted successfully");
  } catch (err) {
    sendError(res, "Failed to delete account", err);
  }
}
