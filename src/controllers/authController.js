import { validationResult } from "express-validator";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import fs from "fs/promises";
import cloudinary from "../config/cloudinary.js";
import { sendEmail } from "../services/emailService.js";
import { createOtpForUser, verifyOtp } from "../services/otpService.js";
import { extractTextFromUrl } from "../services/ocrService.js";
import {
  signAccessToken,
  signRefreshToken,
  saveRefreshToken,
  revokeRefreshTokens,
  validateRefreshToken,
} from "../services/tokenService.js";
import { logger } from "../utils/logger.js";
const prisma = new PrismaClient();

function validationErrors(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map((error) => ({
      field: error.path,
      message: error.msg,
      value: error.value,
    }));
    const err = new Error("Validation failed");
    err.status = 400;
    err.details = errorMessages;
    throw err;
  }
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
    createdAt: user.createdAt,
  };
}

export async function register(req, res, next) {
  try {
    validationErrors(req);
    const { role } = req.body;

    // Role-specific field validation
    if (role === "individual") {
      const { name, email, password } = req.body;
      if (!name?.trim()) {
        return res.status(400).json({
          success: false,
          error: { message: "Name is required for individual registration" },
        });
      }
    } else if (role === "warehouse") {
      const { businessName, email, password } = req.body;
      if (!businessName?.trim()) {
        return res.status(400).json({
          success: false,
          error: {
            message: "Business name is required for warehouse registration",
          },
        });
      }
    } else if (role === "company") {
      const { companyName, email, password } = req.body;
      if (!companyName?.trim()) {
        return res.status(400).json({
          success: false,
          error: {
            message: "Company name is required for company registration",
          },
        });
      }
    }

    if (role === "individual") {
      const { name, email, password, address, contactNo } = req.body;
      if (!name || !email || !password)
        return res
          .status(400)
          .json({ success: false, error: { message: "Missing fields" } });

      // Check if user already exists
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing)
        return res
          .status(400)
          .json({ success: false, error: { message: "User exists" } });

      const hashed = await bcrypt.hash(
        password,
        parseInt(process.env.BCRYPT_SALT_ROUNDS || "10")
      );

      let profileImageUrl = null;
      if (req.files?.profileImage?.[0]) {
        const file = req.files.profileImage[0];
        const uploaded = await cloudinary.uploader.upload(file.path, {
          folder: `recyconnect/pending`,
        });
        profileImageUrl = uploaded.secure_url;
        await fs.unlink(file.path);
      }

      // Store registration data temporarily (in memory or cache)
      const registrationData = {
        name,
        email,
        password: hashed,
        role,
        profileImage: profileImageUrl,
        address,
        contactNo,
        timestamp: Date.now(),
      };

      // Store in a temporary cache/session (you can use Redis or in-memory store)
      global.pendingRegistrations = global.pendingRegistrations || new Map();
      global.pendingRegistrations.set(email, registrationData);

      // Set expiry for pending registration (24 hours)
      setTimeout(() => {
        global.pendingRegistrations?.delete(email);
      }, 24 * 60 * 60 * 1000);

      const otp = await createOtpForUser(email, "email_verification"); // Modified to use email instead of userId
      await sendEmail({
        to: email,
        subject: "Verify your RecyConnect email",
        text: `Your OTP: ${otp}`,
      });

      return res.status(201).json({
        success: true,
        message:
          "Registration initiated. Check email for OTP to complete registration.",
      });
    }

    if (role === "warehouse" || role === "company") {
      const { email, password, address, contactNo } = req.body;
      const nameField = role === "warehouse" ? "businessName" : "companyName";
      const nameVal = req.body[nameField];
      if (!nameVal || !email || !password)
        return res
          .status(400)
          .json({ success: false, error: { message: "Missing fields" } });

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing)
        return res
          .status(400)
          .json({ success: false, error: { message: "User exists" } });

      const hashed = await bcrypt.hash(
        password,
        parseInt(process.env.BCRYPT_SALT_ROUNDS || "10")
      );

      const files = req.files || {};
      if (!files.cnic || !files.cnic[0]) {
        return res
          .status(400)
          .json({ success: false, error: { message: "CNIC is required" } });
      }

      // Upload documents to temporary folder
      const cnicFile = files.cnic[0];
      const uploadedCnic = await cloudinary.uploader.upload(cnicFile.path, {
        folder: `recyconnect/pending/${email}`,
      });
      await fs.unlink(cnicFile.path);

      let documentsData = [
        {
          docType: "CNIC",
          fileUrl: uploadedCnic.secure_url,
          fileName: cnicFile.originalname,
        },
      ];

      if (role === "company") {
        if (
          !files.utility ||
          !files.utility[0] ||
          !files.ntn ||
          !files.ntn[0]
        ) {
          return res.status(400).json({
            success: false,
            error: { message: "Utility and NTN required for company" },
          });
        }
        const utilFile = files.utility[0];
        const ntnFile = files.ntn[0];
        const up1 = await cloudinary.uploader.upload(utilFile.path, {
          folder: `recyconnect/pending/${email}`,
        });
        const up2 = await cloudinary.uploader.upload(ntnFile.path, {
          folder: `recyconnect/pending/${email}`,
        });
        await fs.unlink(utilFile.path);
        await fs.unlink(ntnFile.path);

        documentsData.push(
          {
            docType: "UTILITY",
            fileUrl: up1.secure_url,
            fileName: utilFile.originalname,
          },
          {
            docType: "NTN",
            fileUrl: up2.secure_url,
            fileName: ntnFile.originalname,
          }
        );
      }

      // Store registration data temporarily
      const registrationData = {
        [nameField]: nameVal,
        email,
        password: hashed,
        role,
        address,
        contactNo,
        documents: documentsData,
        timestamp: Date.now(),
      };

      global.pendingRegistrations = global.pendingRegistrations || new Map();
      global.pendingRegistrations.set(email, registrationData);

      setTimeout(() => {
        global.pendingRegistrations?.delete(email);
      }, 24 * 60 * 60 * 1000);

      const otp = await createOtpForUser(email, "email_verification");
      await sendEmail({
        to: email,
        subject: "Verify your RecyConnect email",
        text: `Your OTP: ${otp}`,
      });

      return res.status(201).json({
        success: true,
        message:
          "Registration initiated. Check email for OTP to complete registration.",
      });
    }

    return res
      .status(400)
      .json({ success: false, error: { message: "Invalid role" } });
  } catch (err) {
    if (err.details) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Validation failed",
          details: err.details,
        },
      });
    }
    next(err);
  }
}

export async function verifyOtpController(req, res, next) {
  try {
    validationErrors(req);
    const { email, otp } = req.body;

    // Check if this is for pending registration
    global.pendingRegistrations = global.pendingRegistrations || new Map();
    const pendingData = global.pendingRegistrations.get(email);

    if (pendingData) {
      // This is a pending registration
      const ok = await verifyOtp(email, otp, "email_verification");
      if (!ok)
        return res.status(400).json({
          success: false,
          error: { message: "Invalid or expired OTP" },
        });

      // Create the actual user now
      const userData = {
        name: pendingData.name,
        email: pendingData.email,
        password: pendingData.password,
        role: pendingData.role,
        businessName: pendingData.businessName,
        companyName: pendingData.companyName,
        profileImage: pendingData.profileImage,
        address: pendingData.address,
        contactNo: pendingData.contactNo,
        emailVerified: true,
      };

      const user = await prisma.user.create({ data: userData });

      // Handle documents if any
      if (pendingData.documents) {
        for (const doc of pendingData.documents) {
          await prisma.userDocument.create({
            data: {
              userId: user.id,
              docType: doc.docType,
              fileUrl: doc.fileUrl,
              fileName: doc.fileName,
            },
          });

          // Perform OCR for CNIC and NTN
          if (doc.docType === "CNIC" || doc.docType === "NTN") {
            const ocrText = await extractTextFromUrl(doc.fileUrl);
            await prisma.ocrData.create({
              data: {
                userId: user.id,
                docType: doc.docType,
                ocrText,
                fileUrl: doc.fileUrl,
              },
            });
          }
        }
      }

      // Clean up pending registration
      global.pendingRegistrations.delete(email);

      await prisma.activityLog.create({
        data: {
          userId: user.id,
          actorRole: user.role,
          action: "EMAIL_VERIFIED_AND_REGISTERED",
        },
      });

      return res.json({
        success: true,
        message: "Email verified and registration completed successfully!",
      });
    } else {
      // This is for existing user email verification
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user)
        return res
          .status(404)
          .json({ success: false, error: { message: "User not found" } });

      const ok = await verifyOtp(user.id, otp, "email_verification");
      if (!ok)
        return res.status(400).json({
          success: false,
          error: { message: "Invalid or expired OTP" },
        });

      await prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: true },
      });
      await prisma.activityLog.create({
        data: { userId: user.id, actorRole: user.role, action: "OTP_VERIFIED" },
      });

      return res.json({
        success: true,
        message: "Email verified. You can now login.",
      });
    }
  } catch (err) {
    next(err);
  }
}

export async function login(req, res, next) {
  try {
    validationErrors(req);
    const { identifier, password } = req.body;

    console.log("Login attempt:", {
      identifier,
      password: password ? "[PROVIDED]" : "[MISSING]",
    });

    let user = await prisma.user.findUnique({ where: { email: identifier } });
    if (!user)
      user = await prisma.user.findUnique({
        where: { collectorId: identifier },
      });

    console.log(
      "User found:",
      user
        ? {
            id: user.id,
            email: user.email,
            role: user.role,
            hasPassword: !!user.password,
          }
        : "NOT FOUND"
    );

    if (!user)
      return res
        .status(400)
        .json({ success: false, error: { message: "Invalid credentials" } });
    if (!user.password)
      return res.status(400).json({
        success: false,
        error: { message: "Account not registered yet" },
      });

    const match = await bcrypt.compare(password, user.password);
    console.log("Password match:", match);

    if (!match) {
      await prisma.activityLog.create({
        data: {
          userId: user.id,
          actorRole: user.role,
          action: "LOGIN_FAILED",
          meta: { identifier },
        },
      });
      return res
        .status(400)
        .json({ success: false, error: { message: "Invalid credentials" } });
    }
    if (
      user.role !== "collector" &&
      user.role !== "admin" &&
      !user.emailVerified
    ) {
      return res
        .status(403)
        .json({ success: false, error: { message: "Email not verified" } });
    }
    const access = signAccessToken(user);
    const refresh = signRefreshToken(user);
    await saveRefreshToken(user.id, refresh);
    await prisma.activityLog.create({
      data: { userId: user.id, actorRole: user.role, action: "LOGIN_SUCCESS" },
    });
    return res.json({
      success: true,
      data: {
        accessToken: access,
        refreshToken: refresh,
        role: user.role,
        name: user.name || user.businessName || user.companyName,
        collectorId: user.collectorId,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function forgotPassword(req, res, next) {
  try {
    validationErrors(req);
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user)
      return res
        .status(200)
        .json({ success: true, message: "If an account exists, OTP sent" });
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
    return res.json({
      success: true,
      message: "If an account exists, OTP sent",
    });
  } catch (err) {
    next(err);
  }
}

export async function resetPassword(req, res, next) {
  try {
    validationErrors(req);
    const { email, otp, newPassword } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user)
      return res
        .status(400)
        .json({ success: false, error: { message: "Invalid request" } });
    const ok = await verifyOtp(user.id, otp, "password_reset");
    if (!ok)
      return res
        .status(400)
        .json({ success: false, error: { message: "Invalid or expired OTP" } });
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
    return res.json({ success: true, message: "Password reset successfully" });
  } catch (err) {
    next(err);
  }
}

export async function changePassword(req, res, next) {
  try {
    validationErrors(req);
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.password)
      return res
        .status(400)
        .json({ success: false, error: { message: "Invalid user" } });
    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok)
      return res.status(400).json({
        success: false,
        error: { message: "Current password incorrect" },
      });
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
    return res.json({ success: true, message: "Password changed" });
  } catch (err) {
    next(err);
  }
}

export async function registerCollector(req, res, next) {
  try {
    validationErrors(req);
    const { collectorId, password, name, contactNo, address } = req.body;
    const user = await prisma.user.findUnique({ where: { collectorId } });
    if (!user)
      return res
        .status(404)
        .json({ success: false, error: { message: "Collector ID invalid" } });
    if (user.password)
      return res.status(400).json({
        success: false,
        error: { message: "Collector already registered" },
      });
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
        actorRole: "collector",
        action: "COLLECTOR_REGISTERED",
      },
    });
    return res.json({
      success: true,
      message: "Collector registered. You can login with your ID and password.",
    });
  } catch (err) {
    next(err);
  }
}

export async function me(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { documents: true, ocrDatas: true },
    });
    if (!user)
      return res
        .status(404)
        .json({ success: false, error: { message: "User not found" } });
    await prisma.activityLog.create({
      data: { userId: user.id, actorRole: user.role, action: "FETCH_ME" },
    });
    return res.json({ success: true, data: safeUserResponse(user) });
  } catch (err) {
    next(err);
  }
}

export async function updateProfile(req, res, next) {
  try {
    const userId = req.user.id;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user)
      return res
        .status(404)
        .json({ success: false, error: { message: "User not found" } });
    // collect allowed updates
    const updates = {};
    const allowed = ["name", "businessName", "companyName"];
    for (const k of allowed) if (req.body[k]) updates[k] = req.body[k];
    if (req.file) {
      const uploaded = await cloudinary.uploader.upload(req.file.path, {
        folder: `recyconnect/profile/${userId}`,
      });
      await fs.unlink(req.file.path);
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
    if (Object.keys(updates).length === 0)
      return res
        .status(400)
        .json({ success: false, error: { message: "No changes provided" } });
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
    return res.json({ success: true, data: safeUserResponse(updated) });
  } catch (err) {
    next(err);
  }
}

export async function logout(req, res, next) {
  try {
    const userId = req.user.id;
    await revokeRefreshTokens(userId);
    await prisma.activityLog.create({
      data: { userId, actorRole: req.user.role, action: "LOGOUT" },
    });
    return res.json({ success: true, message: "Logged out" });
  } catch (err) {
    next(err);
  }
}

export async function refreshToken(req, res, next) {
  try {
    validationErrors(req);
    const { refreshToken } = req.body;
    const payload = await validateRefreshToken(refreshToken);
    // In production, verify hashed token exists and not revoked
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
    });
    if (!user)
      return res
        .status(401)
        .json({ success: false, error: { message: "Invalid token" } });
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
    return res.json({
      success: true,
      data: { accessToken: access, refreshToken: newRefresh },
    });
  } catch (err) {
    next(err);
  }
}

export async function resendOtp(req, res, next) {
  try {
    validationErrors(req);
    const { email } = req.body;

    // Check if there's a pending registration
    global.pendingRegistrations = global.pendingRegistrations || new Map();
    const pendingData = global.pendingRegistrations.get(email);

    if (pendingData) {
      // This is for pending registration
      const otp = await createOtpForUser(email, "email_verification");
      await sendEmail({
        to: email,
        subject: "Verify your RecyConnect email",
        text: `Your OTP: ${otp}`,
      });

      return res.json({
        success: true,
        message: "OTP sent successfully",
      });
    } else {
      // Check if user exists for regular email verification
      const user = await prisma.user.findUnique({ where: { email } });
      if (user && !user.emailVerified) {
        const otp = await createOtpForUser(user.id, "email_verification");
        await sendEmail({
          to: email,
          subject: "Verify your RecyConnect email",
          text: `Your OTP: ${otp}`,
        });

        return res.json({
          success: true,
          message: "OTP sent successfully",
        });
      }

      return res.status(400).json({
        success: false,
        error: { message: "No pending registration or unverified user found" },
      });
    }
  } catch (err) {
    next(err);
  }
}
