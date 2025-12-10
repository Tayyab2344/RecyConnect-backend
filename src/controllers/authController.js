import { validationResult } from "express-validator";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import fs from "fs/promises";
import cloudinary from "../config/cloudinary.js";
import { sendEmail } from "../services/emailService.js";
import { createOtpForUser, verifyOtp } from "../services/otpService.js";
import {
  signAccessToken,
  signRefreshToken,
  saveRefreshToken,
  revokeRefreshTokens,
  validateRefreshToken,
} from "../services/tokenService.js";
import { extractTextFromUrl, extractCNIC, extractNTN } from "../services/ocrService.js";
import { logger } from "../utils/logger.js";
import { UserRole, VerificationStatus, KycStage } from "../constants/enums.js";
import { sendSuccess, sendError } from "../utils/responseHelper.js";

const prisma = new PrismaClient();

// Helper to upload to Cloudinary (Supports both Disk Storage & Memory Storage)
const uploadToCloudinary = (file, folder) => {
  return new Promise((resolve, reject) => {
    // 1. If we have a file path (Disk Storage)
    if (file.path) {
      cloudinary.uploader.upload(file.path, { folder })
        .then((result) => {
          // Try to clean up local file
          fs.unlink(file.path).catch((err) => logger.warn(`Failed to delete local file: ${err.message}`));
          resolve(result);
        })
        .catch((err) => reject(err));
    } 
    // 2. If we have a buffer (Memory Storage)
    else if (file.buffer) {
      const stream = cloudinary.uploader.upload_stream(
        { folder },
        (error, result) => {
          if (error) return reject(error);
          resolve(result);
        }
      );
      stream.end(file.buffer);
    } 
    // 3. Fallback / Error
    else {
      reject(new Error("File upload failed: No path or buffer found"));
    }
  });
};

function validateRequest(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    sendError(res, "Validation failed", errors.array(), 400);
    return false;
  }
  return true;
}

function safeUserResponse(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    profileImage: user.profileImage,
    collectorId: user.collectorId,
    businessName: user.businessName,
    companyName: user.companyName,
    emailVerified: user.emailVerified,
    address: user.address,
    city: user.city,
    contactNo: user.contactNo,
    latitude: user.latitude,
    longitude: user.longitude,
    locationMethod: user.locationMethod,
    locationPermission: user.locationPermission,
    addressUpdatedAt: user.addressUpdatedAt,
    createdAt: user.createdAt,
    documents: user.documents,
  };
}

export async function register(req, res) {
  try {
    if (!validateRequest(req, res)) return;

    const { role, email, password, name, businessName, companyName, address, contactNo } = req.body;

    // 1. Strict Role Validation
    if (![UserRole.INDIVIDUAL, UserRole.WAREHOUSE, UserRole.COMPANY].includes(role)) {
      return sendError(res, "Invalid role", null, 400);
    }

    // 2. Check for existing VERIFIED user only (allow re-registration if OTP not verified)
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing && existing.emailVerified) {
      return sendError(res, "User already exists", null, 400);
    }

    if (req.body.cnic) {
      const existingCnic = await prisma.user.findUnique({ where: { cnic: req.body.cnic } });
      if (existingCnic) {
        return sendError(res, "CNIC already registered", null, 400);
      }
    }

    // 3. Role-Specific Field Validation
    if (role === UserRole.INDIVIDUAL) {
      if (!name?.trim()) return sendError(res, "Name is required", null, 400);
    } else if (role === UserRole.WAREHOUSE) {
      if (!businessName?.trim()) return sendError(res, "Business name is required", null, 400);
    } else if (role === UserRole.COMPANY) {
      if (!companyName?.trim()) return sendError(res, "Company name is required", null, 400);
    }

    // 4. Profile Picture Upload (Mandatory for non-individuals)
    let profileImageUrl = null;
    if (req.files?.profileImage?.[0]) {
      const file = req.files.profileImage[0];
      const uploaded = await uploadToCloudinary(file, `recyconnect/profile/${email}`);
      profileImageUrl = uploaded.secure_url;
    } else if (role !== UserRole.INDIVIDUAL) {
      return sendError(res, "Profile picture is mandatory", null, 400);
    }

    // 5. Document Upload & Store URLs (Warehouse/Company)
    const documentsData = [];
    if (role === UserRole.WAREHOUSE || role === UserRole.COMPANY) {
      const files = req.files || {};
      if (!files.cnic || !files.cnic[0]) {
        return sendError(res, "CNIC is required", null, 400);
      }

      // Upload CNIC
      const cnicFile = files.cnic[0];
      const upCnic = await uploadToCloudinary(cnicFile, `recyconnect/docs/${email}`);
      documentsData.push({ docType: "CNIC", fileUrl: upCnic.secure_url, fileName: cnicFile.originalname });

      if (role === UserRole.COMPANY) {
        if (!files.ntn?.[0] || !files.utility?.[0]) {
          return sendError(res, "NTN and Utility Bill required", null, 400);
        }
        const ntnFile = files.ntn[0];
        const utilFile = files.utility[0];
        const upNtn = await uploadToCloudinary(ntnFile, `recyconnect/docs/${email}`);
        const upUtil = await uploadToCloudinary(utilFile, `recyconnect/docs/${email}`);

        documentsData.push(
          { docType: "NTN", fileUrl: upNtn.secure_url, fileName: ntnFile.originalname },
          { docType: "UTILITY", fileUrl: upUtil.secure_url, fileName: utilFile.originalname }
        );
      }
    }

    // 6. Hash password for storage in metadata
    const hashed = await bcrypt.hash(password, parseInt(process.env.BCRYPT_SALT_ROUNDS || "10"));

    // 7. Prepare registration metadata
    const registrationData = {
      name: role === UserRole.INDIVIDUAL ? name : undefined,
      businessName: role === UserRole.WAREHOUSE ? businessName : undefined,
      companyName: role === UserRole.COMPANY ? companyName : undefined,
      email,
      password: hashed,
      role,
      address,
      contactNo,
      profileImage: profileImageUrl,
      documents: documentsData,
      cnic: req.body.cnic, // Store CNIC in metadata
      // Don't store verificationStatus/kycStage - they will be set to VERIFIED after OTP
    };

    // 8. Delete any existing unused OTPs for this email (from previous attempts)
    await prisma.otp.deleteMany({
      where: {
        email,
        purpose: "email_verification",
        used: false,
      }
    });

    // 9. Create OTP with registration metadata (NO user created yet)
    const otp = await createOtpForUser(null, "email_verification", email, registrationData);

    // 10. Send OTP email
    await sendEmail({
      to: email,
      subject: "Verify your RecyConnect email",
      text: `Your OTP: ${otp}`,
    });

    sendSuccess(res, "Registration initiated. Please verify your email.", { email }, 201);
  } catch (err) {
    sendError(res, "Registration failed", err);
  }
}

export async function analyzeDocument(req, res) {
  try {
    if (!req.file) {
      return sendError(res, "No document provided", null, 400);
    }

    const uploaded = await uploadToCloudinary(req.file, "recyconnect/temp_analysis");

    logger.info(`Analyzing document: ${uploaded.secure_url}`);
    const text = await extractTextFromUrl(uploaded.secure_url);
    logger.info(`OCR extracted text (${text.length} chars): ${text.substring(0, 200)}...`);

    // Attempt to extract structured data based on common patterns
    const cnic = extractCNIC(text);
    const ntn = extractNTN(text);

    logger.info(`Extracted CNIC: ${cnic || 'null'}, NTN: ${ntn || 'null'}`);

    sendSuccess(res, "Document analyzed", {
      text,
      extracted: {
        cnic,
        ntn
      },
      imageUrl: uploaded.secure_url
    });
  } catch (err) {
    logger.error(`Document analysis error: ${err.message}`);
    sendError(res, "Document analysis failed", err);
  }
}

export async function verifyOtpController(req, res) {
  try {
    if (!validateRequest(req, res)) return;
    const { email, otp } = req.body;

    // Verify OTP (works for both email-based and user-based)
    const otpRecord = await verifyOtp(email, otp, "email_verification");
    if (!otpRecord) {
      return sendError(res, "Invalid or expired OTP", null, 400);
    }

    // Check if this is a NEW registration (has metadata) or existing user verification
    if (otpRecord.metadata && otpRecord.metadata.email) {
      // NEW REGISTRATION: Create user from OTP metadata
      const regData = otpRecord.metadata;

      // Double-check user doesn't already exist
      const existing = await prisma.user.findUnique({ where: { email: regData.email } });
      if (existing) {
        return sendError(res, "User already exists", null, 400);
      }

      // Create user from metadata
      const user = await prisma.user.create({
        data: {
          name: regData.name,
          businessName: regData.businessName,
          companyName: regData.companyName,
          email: regData.email,
          password: regData.password, // Already hashed
          role: regData.role,
          address: regData.address,
          contactNo: regData.contactNo,
          profileImage: regData.profileImage,
          emailVerified: true, // Immediately verified since they just verified OTP
          verificationStatus: VerificationStatus.VERIFIED, // Always VERIFIED after OTP
          kycStage: KycStage.VERIFIED, // Always VERIFIED after OTP
          documents: {
            create: regData.documents || []
          },
          cnic: regData.cnic,
        }
      });

      // Trigger OCR if documents exist (Async)
      if (regData.documents && regData.documents.length > 0) {
        try {
          for (const doc of regData.documents) {
            if (doc.docType === "CNIC" || doc.docType === "NTN") {
              const text = await extractTextFromUrl(doc.fileUrl);
              let extractedData = {};

              if (doc.docType === "CNIC") {
                const cnic = extractCNIC(text);
                extractedData = { cnic };
              } else if (doc.docType === "NTN") {
                const ntn = extractNTN(text);
                extractedData = { ntn };
              }

              await prisma.ocrData.create({
                data: {
                  userId: user.id,
                  docType: doc.docType,
                  ocrText: text,
                  fileUrl: doc.fileUrl,
                  extractedData,
                  isMatch: false
                }
              });
            }
          }
        } catch (ocrErr) {
          logger.error("OCR Error during verification: " + ocrErr.message);
        }
      }

      await prisma.activityLog.create({
        data: { userId: user.id, actorRole: user.role, action: "EMAIL_VERIFIED_AND_REGISTERED" },
      });

      sendSuccess(res, "Email verified successfully. You can now login.");

    } else {
      // EXISTING USER: Just update verification status
      const user = await prisma.user.findUnique({ where: { email }, include: { documents: true } });
      if (!user) {
        return sendError(res, "User not found", null, 404);
      }

      // Update user status
      const updateData = { emailVerified: true };

      // Auto-approve warehouse, company, AND individual accounts after email verification
      if ([UserRole.WAREHOUSE, UserRole.COMPANY, UserRole.INDIVIDUAL].includes(user.role)) {
        updateData.verificationStatus = VerificationStatus.VERIFIED;
        updateData.kycStage = KycStage.VERIFIED;
      }

      await prisma.user.update({
        where: { id: user.id },
        data: updateData
      });

      // Trigger OCR if documents exist (Async)
      if (user.documents.length > 0) {
        try {
          for (const doc of user.documents) {
            if (doc.docType === "CNIC" || doc.docType === "NTN") {
              const text = await extractTextFromUrl(doc.fileUrl);
              let extractedData = {};
              let isMatch = false;

              if (doc.docType === "CNIC") {
                const cnic = extractCNIC(text);
                extractedData = { cnic };
              } else if (doc.docType === "NTN") {
                const ntn = extractNTN(text);
                extractedData = { ntn };
              }

              await prisma.ocrData.create({
                data: {
                  userId: user.id,
                  docType: doc.docType,
                  ocrText: text,
                  fileUrl: doc.fileUrl,
                  extractedData,
                  isMatch
                }
              });
            }
          }
        } catch (ocrErr) {
          logger.error("OCR Error during verification: " + ocrErr.message);
        }
      }

      await prisma.activityLog.create({
        data: { userId: user.id, actorRole: user.role, action: "EMAIL_VERIFIED" },
      });

      sendSuccess(res, "Email verified successfully. You can now login.");
    }
  } catch (err) {
    sendError(res, "Verification failed", err);
  }
}

export async function login(req, res) {
  try {
    if (!validateRequest(req, res)) return;
    const { identifier, password } = req.body;
    console.log(`[LOGIN DEBUG] Login attempt for: ${identifier}`);

    // Allow login with email OR collectorId
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: identifier }, { collectorId: identifier }],
      },
    });

    if (!user) {
      console.log(`[LOGIN DEBUG] User NOT found for: ${identifier}`);
      return sendError(res, "Invalid credentials", null, 401);
    }

    if (!user.password) {
      console.log(`[LOGIN DEBUG] User found but has NO password: ${user.email}`);
      return sendError(res, "Invalid credentials", null, 401);
    }

    console.log(`[LOGIN DEBUG] User found: ${user.email}, Role: ${user.role}, Hash: ${user.password.substring(0, 10)}...`);

    const match = await bcrypt.compare(password, user.password);
    console.log(`[LOGIN DEBUG] Password match result: ${match}`);

    if (!match) {
      return sendError(res, "Invalid credentials", null, 401);
    }

    // Skip verification checks for admin users
    if (user.role !== UserRole.ADMIN) {
      // Check Verification Status
      if (user.verificationStatus === VerificationStatus.BLOCKED) {
        return sendError(res, "Account blocked", null, 403);
      }

      if (user.verificationStatus === VerificationStatus.REJECTED) {
        return sendSuccess(res, "Account rejected", {
          verificationStatus: VerificationStatus.REJECTED,
          rejectionReason: user.rejectionReason,
          kycStage: user.kycStage,
          role: user.role
        });
      }

      if (user.verificationStatus === VerificationStatus.PENDING && user.role !== UserRole.INDIVIDUAL) {
        return sendSuccess(res, "Account pending verification", {
          verificationStatus: VerificationStatus.PENDING,
          kycStage: user.kycStage,
          role: user.role
        });
      }

      // Check Email Verification (for individuals mostly, but good for all)
      if (!user.emailVerified && user.role === UserRole.INDIVIDUAL) {
        return sendError(res, "Email not verified", null, 403);
      }
    }

    // Generate Tokens
    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);
    await saveRefreshToken(user.id, refreshToken);

    await prisma.activityLog.create({
      data: { userId: user.id, actorRole: user.role, action: "LOGIN" },
    });

    sendSuccess(res, "Login successful", {
      accessToken,
      refreshToken,
      user: safeUserResponse(user),
      verificationStatus: user.verificationStatus,
      kycStage: user.kycStage
    });
  } catch (err) {
    sendError(res, "Login failed", err);
  }
}

export async function forgotPassword(req, res) {
  try {
    if (!validateRequest(req, res)) return;
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return sendSuccess(res, "If an account exists, OTP sent");
    }

    const otp = await createOtpForUser(user.id, "password_reset");
    await sendEmail({
      to: email,
      subject: "RecyConnect password reset OTP",
      text: `Your OTP: ${otp}`,
    });

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        actorRole: user.role,
        action: "FORGOT_PASSWORD",
      },
    });

    sendSuccess(res, "If an account exists, OTP sent");
  } catch (err) {
    sendError(res, "Forgot password failed", err);
  }
}

export async function resetPassword(req, res) {
  try {
    if (!validateRequest(req, res)) return;
    const { email, otp, newPassword } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return sendError(res, "Invalid request", null, 400);
    }

    const ok = await verifyOtp(user.id, otp, "password_reset");
    if (!ok) {
      return sendError(res, "Invalid or expired OTP", null, 400);
    }

    const hashed = await bcrypt.hash(
      newPassword,
      parseInt(process.env.BCRYPT_SALT_ROUNDS || "10")
    );

    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashed },
    });

    await revokeRefreshTokens(user.id);

    await prisma.activityLog.create({
      data: { userId: user.id, actorRole: user.role, action: "PASSWORD_RESET" },
    });

    sendSuccess(res, "Password reset successfully");
  } catch (err) {
    sendError(res, "Reset password failed", err);
  }
}

export async function changePassword(req, res) {
  try {
    if (!validateRequest(req, res)) return;
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user || !user.password) {
      return sendError(res, "Invalid user", null, 400);
    }

    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) {
      return sendError(res, "Current password incorrect", null, 400);
    }

    const hashed = await bcrypt.hash(
      newPassword,
      parseInt(process.env.BCRYPT_SALT_ROUNDS || "10")
    );

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashed },
    });

    await revokeRefreshTokens(user.id);

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        actorRole: user.role,
        action: "PASSWORD_CHANGED",
      },
    });

    sendSuccess(res, "Password changed");
  } catch (err) {
    sendError(res, "Change password failed", err);
  }
}

export async function registerCollector(req, res) {
  try {
    if (!validateRequest(req, res)) return;
    const { collectorId, password, name, contactNo, address } = req.body;
    const user = await prisma.user.findUnique({ where: { collectorId } });

    if (!user) {
      return sendError(res, "Collector ID invalid", null, 404);
    }

    if (user.password) {
      return sendError(res, "Collector already registered", null, 400);
    }

    const hashed = await bcrypt.hash(
      password,
      parseInt(process.env.BCRYPT_SALT_ROUNDS || "10")
    );

    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashed, name, contactNo, address },
    });

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        actorRole: UserRole.COLLECTOR,
        action: "COLLECTOR_REGISTERED",
      },
    });

    sendSuccess(res, "Collector registered. You can login with your ID and password.");
  } catch (err) {
    sendError(res, "Collector registration failed", err);
  }
}

export async function me(req, res) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { documents: true, ocrDatas: true },
    });

    if (!user) {
      return sendError(res, "User not found", null, 404);
    }

    await prisma.activityLog.create({
      data: { userId: user.id, actorRole: user.role, action: "FETCH_ME" },
    });

    sendSuccess(res, "Profile fetched", safeUserResponse(user));
  } catch (err) {
    sendError(res, "Fetch profile failed", err);
  }
}

export async function updateProfile(req, res) {
  try {
    const userId = req.user.id;
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      return sendError(res, "User not found", null, 404);
    }

    // collect allowed updates
    const updates = {};
    const allowed = ["name", "businessName", "companyName", "address", "city", "contactNo", "latitude", "longitude", "locationMethod", "locationPermission"];
    for (const k of allowed) {
      if (req.body[k] !== undefined) {
        updates[k] = req.body[k];
      }
    }

    // Track address updates
    if (updates.address || updates.city || updates.latitude || updates.longitude) {
      updates.addressUpdatedAt = new Date();
    }

    if (req.file) {
      const uploaded = await uploadToCloudinary(req.file, `recyconnect/profile/${userId}`);
      updates.profileImage = uploaded.secure_url;

      await prisma.activityLog.create({
        data: {
          userId,
          actorRole: user.role,
          action: "PROFILE_IMAGE_UPDATED",
          meta: { fileUrl: uploaded.secure_url },
        },
      });
    }

    if (Object.keys(updates).length === 0) {
      return sendError(res, "No changes provided", null, 400);
    }

    const before = {
      name: user.name,
      businessName: user.businessName,
      companyName: user.companyName,
    };

    const updated = await prisma.user.update({
      where: { id: userId },
      data: updates,
    });

    await prisma.activityLog.create({
      data: {
        userId,
        actorRole: user.role,
        action: "PROFILE_UPDATED",
        meta: { before, after: updates },
      },
    });

    sendSuccess(res, "Profile updated", safeUserResponse(updated));
  } catch (err) {
    sendError(res, "Update profile failed", err);
  }
}

export async function logout(req, res) {
  try {
    const userId = req.user.id;
    await revokeRefreshTokens(userId);

    await prisma.activityLog.create({
      data: { userId, actorRole: req.user.role, action: "LOGOUT" },
    });

    sendSuccess(res, "Logged out");
  } catch (err) {
    sendError(res, "Logout failed", err);
  }
}

export async function refreshToken(req, res) {
  try {
    if (!validateRequest(req, res)) return;
    const { refreshToken } = req.body;
    const payload = await validateRefreshToken(refreshToken);

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
    });

    if (!user) {
      return sendError(res, "Invalid token", null, 401);
    }

    const access = signAccessToken(user);
    const newRefresh = signRefreshToken(user);
    await saveRefreshToken(user.id, newRefresh);

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        actorRole: user.role,
        action: "REFRESH_TOKEN_ROTATED",
      },
    });

    sendSuccess(res, "Token refreshed", { accessToken: access, refreshToken: newRefresh });
  } catch (err) {
    sendError(res, "Refresh token failed", err);
  }
}

export async function resendOtp(req, res) {
  try {
    if (!validateRequest(req, res)) return;
    const { email } = req.body;

    // Check if there's a pending registration OTP (user not created yet)
    const pendingOtp = await prisma.otp.findFirst({
      where: {
        email,
        purpose: "email_verification",
        used: false,
      },
      orderBy: { createdAt: 'desc' }
    });

    if (pendingOtp && pendingOtp.metadata) {
      // This is a pending registration - delete old OTP and create new one with same metadata
      await prisma.otp.deleteMany({
        where: {
          email,
          purpose: "email_verification",
          used: false,
        }
      });

      const otp = await createOtpForUser(null, "email_verification", email, pendingOtp.metadata);
      await sendEmail({
        to: email,
        subject: "Verify your RecyConnect email",
        text: `Your OTP: ${otp}`,
      });

      return sendSuccess(res, "OTP sent successfully");
    }

    // Otherwise, check for existing user
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return sendError(res, "No registration found for this email", null, 404);
    }

    if (user.emailVerified) {
      return sendError(res, "Email already verified", null, 400);
    }

    const otp = await createOtpForUser(user.id, "email_verification");
    await sendEmail({
      to: email,
      subject: "Verify your RecyConnect email",
      text: `Your OTP: ${otp}`,
    });

    sendSuccess(res, "OTP sent successfully");
  } catch (err) {
    sendError(res, "Resend OTP failed", err);
  }
}

export async function checkEmailExistence(req, res) {
  try {
    if (!validateRequest(req, res)) return;
    const { email } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (user && user.emailVerified) {
      return sendSuccess(res, "Email exists", { exists: true });
    }

    // Also check if there's a pending OTP verification (optional, but good practice)
    // For now, we only block if fully registered/verified.
    // If they have a pending OTP but not verified, we allow them to continue (it will resend OTP)

    sendSuccess(res, "Email available", { exists: false });
  } catch (err) {
    sendError(res, "Email check failed", err);
  }
}

export async function createCollector(req, res) {
  try {
    // Warehouse/Company Admin only
    const { name, collectorId } = req.body;
    const adminId = req.user.id;

    // Verify admin role
    const admin = await prisma.user.findUnique({ where: { id: adminId } });
    if (![UserRole.WAREHOUSE, UserRole.COMPANY, UserRole.ADMIN].includes(admin.role)) {
      return sendError(res, "Unauthorized", null, 403);
    }

    // Generate ID if not provided
    const finalCollectorId = collectorId || `COL-${Date.now().toString().slice(-6)}`;

    // Check uniqueness
    const existing = await prisma.user.findUnique({ where: { collectorId: finalCollectorId } });
    if (existing) {
      return sendError(res, "Collector ID already exists", null, 400);
    }

    // Create placeholder user
    const user = await prisma.user.create({
      data: {
        name: name || "New Collector",
        role: UserRole.COLLECTOR,
        collectorId: finalCollectorId,
        assignedWarehouseId: adminId, // Link to creator
        verificationStatus: VerificationStatus.VERIFIED,
        emailVerified: true,
        // No password yet, they will register
      }
    });

    await prisma.activityLog.create({
      data: { userId: adminId, actorRole: admin.role, action: "CREATED_COLLECTOR", meta: { collectorId: finalCollectorId } }
    });

    sendSuccess(res, "Collector ID created", { collectorId: finalCollectorId });
  } catch (err) {
    sendError(res, "Create collector failed", err);
  }
}
