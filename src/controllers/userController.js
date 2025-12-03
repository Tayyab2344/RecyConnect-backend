import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import fs from 'fs/promises';
import cloudinary from '../config/cloudinary.js';
import { extractTextFromUrl, extractCNIC, extractNTN } from '../services/ocrService.js';
import { logger } from '../utils/logger.js';
import { UserRole, VerificationStatus, KycStage } from '../constants/enums.js';
import { sendSuccess, sendError } from '../utils/responseHelper.js';

const prisma = new PrismaClient();

// Helper to validate allowed transitions
function isValidTransition(currentRole, requestedRole) {
    if (currentRole === UserRole.INDIVIDUAL && (requestedRole === UserRole.WAREHOUSE || requestedRole === UserRole.COMPANY)) return true;
    if (currentRole === UserRole.WAREHOUSE && requestedRole === UserRole.COMPANY) return true;
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
                role: true,
                profileImage: true,
                latitude: true,
                longitude: true,
                locationMethod: true,
                businessName: true,
                companyName: true,
                verificationStatus: true,
                createdAt: true
            }
        });

        if (!user) {
            return sendError(res, 'User not found', null, 404);
        }

        sendSuccess(res, 'Profile fetched', user);
    } catch (err) {
        sendError(res, 'Failed to fetch profile', err);
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
            return sendError(res, 'Current password and new password are required', null, 400);
        }

        if (newPassword.length < 6) {
            return sendError(res, 'New password must be at least 6 characters long', null, 400);
        }

        // Get user with password
        const user = await prisma.user.findUnique({
            where: { id: userId }
        });

        if (!user || !user.password) {
            return sendError(res, 'User not found', null, 404);
        }

        // Verify current password
        const isValidPassword = await bcrypt.compare(currentPassword, user.password);
        if (!isValidPassword) {
            return sendError(res, 'Current password is incorrect', null, 401);
        }

        // Hash new password and update
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await prisma.user.update({
            where: { id: userId },
            data: { password: hashedPassword }
        });

        sendSuccess(res, 'Password changed successfully');
    } catch (err) {
        sendError(res, 'Failed to change password', err);
    }
}

export async function updateProfile(req, res) {
    try {
        const userId = req.user.id;
        const { name, email, contactNo, address, password, latitude, longitude, locationMethod } = req.body;

        const updates = {};
        if (name) updates.name = name;
        if (email) updates.email = email;
        if (contactNo) updates.contactNo = contactNo;
        if (address) updates.address = address;
        if (latitude !== undefined) updates.latitude = parseFloat(latitude);
        if (longitude !== undefined) updates.longitude = parseFloat(longitude);
        if (locationMethod) updates.locationMethod = locationMethod;

        if (password) {
            updates.password = await bcrypt.hash(password, 10);
        }

        if (req.file) {
            const uploaded = await cloudinary.uploader.upload(req.file.path, {
                folder: `recyconnect/profile/${userId}`,
            });
            updates.profileImage = uploaded.secure_url;
            await fs.unlink(req.file.path);
        }

        if (Object.keys(updates).length === 0) {
            return sendError(res, 'No changes provided', null, 400);
        }

        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: updates,
        });

        const { password: _, ...userWithoutPassword } = updatedUser;

        sendSuccess(res, 'Profile updated successfully', userWithoutPassword);
    } catch (err) {
        sendError(res, 'Failed to update profile', err);
    }
}

export async function requestRoleUpgrade(req, res) {
    try {
        const userId = req.user.id;
        const currentRole = req.user.role;
        const { requestedRole, businessName, companyName, address } = req.body;

        // 1. Validate Transition
        if (!isValidTransition(currentRole, requestedRole)) {
            return sendError(res, `Invalid role transition from ${currentRole} to ${requestedRole}`, null, 400);
        }

        // 2. Check for pending request
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (user.verificationStatus === VerificationStatus.PENDING && user.requestedRole) {
            return sendError(res, 'You already have a pending upgrade request', null, 400);
        }

        // 3. Handle File Uploads & Validation
        const files = req.files || {};
        const documentsData = [];
        let ocrCnic = null;
        let ocrNtn = null;

        // Common Requirements
        if (!address) return sendError(res, 'Address is required for upgrade', null, 400);

        // Role Specific Requirements
        if (requestedRole === UserRole.WAREHOUSE) {
            if (!businessName) return sendError(res, 'Business Name is required', null, 400);
            if (!files.cnicFront?.[0] || !files.cnicBack?.[0]) {
                return sendError(res, 'CNIC Front and Back are required', null, 400);
            }

            // Upload & OCR CNIC
            const frontFile = files.cnicFront[0];
            const backFile = files.cnicBack[0];

            const upFront = await cloudinary.uploader.upload(frontFile.path, { folder: `recyconnect/kyc/${userId}` });
            const upBack = await cloudinary.uploader.upload(backFile.path, { folder: `recyconnect/kyc/${userId}` });

            await fs.unlink(frontFile.path);
            await fs.unlink(backFile.path);

            documentsData.push(
                { docType: "CNIC_FRONT", fileUrl: upFront.secure_url, fileName: frontFile.originalname },
                { docType: "CNIC_BACK", fileUrl: upBack.secure_url, fileName: backFile.originalname }
            );

            // OCR Check
            const frontText = await extractTextFromUrl(upFront.secure_url);
            const backText = await extractTextFromUrl(upBack.secure_url);
            ocrCnic = extractCNIC(frontText) || extractCNIC(backText);

            if (!ocrCnic) {
                return sendError(res, 'Could not verify CNIC from uploaded images. Please upload clear images.', null, 400);
            }
        }

        if (requestedRole === UserRole.COMPANY) {
            if (!companyName) return sendError(res, 'Company Name is required', null, 400);
            if (!files.ntn?.[0] || !files.registration?.[0]) {
                return sendError(res, 'NTN and Registration Certificate are required', null, 400);
            }

            // Upload & OCR NTN
            const ntnFile = files.ntn[0];
            const regFile = files.registration[0];

            const upNtn = await cloudinary.uploader.upload(ntnFile.path, { folder: `recyconnect/kyc/${userId}` });
            const upReg = await cloudinary.uploader.upload(regFile.path, { folder: `recyconnect/kyc/${userId}` });

            await fs.unlink(ntnFile.path);
            await fs.unlink(regFile.path);

            documentsData.push(
                { docType: "NTN", fileUrl: upNtn.secure_url, fileName: ntnFile.originalname },
                { docType: "REGISTRATION", fileUrl: upReg.secure_url, fileName: regFile.originalname }
            );

            // OCR Check
            const ntnText = await extractTextFromUrl(upNtn.secure_url);
            ocrNtn = extractNTN(ntnText);

            if (!ocrNtn) {
                return sendError(res, 'Could not verify NTN from uploaded document.', null, 400);
            }
        }

        // Utility Bill (Required for both)
        if (files.utility?.[0]) {
            const utilFile = files.utility[0];
            const upUtil = await cloudinary.uploader.upload(utilFile.path, { folder: `recyconnect/kyc/${userId}` });
            await fs.unlink(utilFile.path);
            documentsData.push({ docType: "UTILITY", fileUrl: upUtil.secure_url, fileName: utilFile.originalname });
        } else {
            return sendError(res, 'Utility Bill is required', null, 400);
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
                }
            });

            if (documentsData.length > 0) {
                await tx.userDocument.createMany({
                    data: documentsData.map(d => ({ ...d, userId }))
                });
            }

            // Log OCR Data
            if (ocrCnic || ocrNtn) {
                await tx.ocrData.create({
                    data: {
                        userId,
                        docType: ocrCnic ? 'CNIC' : 'NTN',
                        ocrText: 'Extracted during upgrade',
                        fileUrl: 'N/A',
                        extractedData: { cnic: ocrCnic, ntn: ocrNtn },
                        isMatch: true,
                        confidence: 1.0
                    }
                });
            }

            await tx.activityLog.create({
                data: {
                    userId,
                    actorRole: currentRole,
                    action: 'ROLE_UPGRADE_AUTO_APPROVED',
                    meta: { from: currentRole, to: requestedRole, reason: 'OCR Verified' }
                }
            });
        });

        sendSuccess(res, 'Role upgrade approved successfully. Your account has been upgraded.');
    } catch (err) {
        sendError(res, 'Failed to process role upgrade request', err);
    }
}
