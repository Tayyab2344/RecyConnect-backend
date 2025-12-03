import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { extractTextFromUrl, extractCNIC, extractNTN } from '../services/ocrService.js';
import multer from 'multer';
import { UserRole, VerificationStatus, KycStage } from '../constants/enums.js';
import { sendSuccess, sendError } from '../utils/responseHelper.js';

const prisma = new PrismaClient();
const upload = multer({ dest: 'uploads/' });

async function isCnicUnique(cnic) {
  const existing = await prisma.user.findFirst({ where: { cnic } });
  return !existing;
}

function validateCnicFormat(cnic) {
  if (!cnic) return false;
  const digits = cnic.replace(/-/g, '');
  return digits.length === 13 && /^\d+$/.test(digits);
}

function validateNtnFormat(ntn) {
  if (!ntn) return false;
  const digits = ntn.replace(/-/g, '');
  return digits.length === 8 && /^\d+$/.test(digits);
}

export const registerKyc = [
  upload.fields([
    { name: 'frontCnic', maxCount: 1 },
    { name: 'backCnic', maxCount: 1 },
    { name: 'ntn', maxCount: 1 },
    { name: 'utilityBill', maxCount: 1 },
    { name: 'profilePicture', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const { role } = req.user;
      if (role === UserRole.INDIVIDUAL) {
        return sendError(res, 'Individuals do not require KYC documents', null, 400);
      }

      const frontPath = req.files['frontCnic']?.[0]?.path;
      const backPath = req.files['backCnic']?.[0]?.path;
      if (!frontPath || !backPath) {
        return sendError(res, 'Both front and back CNIC images are required', null, 400);
      }

      const frontText = await extractTextFromUrl(frontPath);
      const backText = await extractTextFromUrl(backPath);
      const cnic = extractCNIC(frontText) || extractCNIC(backText);

      let verificationStatus = VerificationStatus.REJECTED;
      let kycStage = KycStage.DOCUMENTS_UPLOADED; // Default to uploaded, update if verified
      let rejectionReason = null;

      if (!cnic) {
        rejectionReason = 'OCR failed to extract valid CNIC from uploaded documents. Please ensure images are clear and readable.';
        logger.warn(`KYC auto-rejected for user ${req.user.id}: CNIC extraction failed`);
      } else if (!validateCnicFormat(cnic)) {
        rejectionReason = 'Extracted CNIC format is invalid. Please upload clear CNIC images.';
        logger.warn(`KYC auto-rejected for user ${req.user.id}: Invalid CNIC format - ${cnic}`);
      } else {
        const unique = await isCnicUnique(cnic);
        if (!unique) {
          rejectionReason = 'This CNIC is already registered with another business account.';
          logger.warn(`KYC auto-rejected for user ${req.user.id}: Duplicate CNIC - ${cnic}`);
        } else {
          if (role === UserRole.COMPANY) {
            const ntnPath = req.files['ntn']?.[0]?.path;
            if (ntnPath) {
              const ntnText = await extractTextFromUrl(ntnPath);
              const ntn = extractNTN(ntnText);

              if (!ntn || !validateNtnFormat(ntn)) {
                rejectionReason = 'OCR failed to extract valid NTN from certificate. Please upload a clear NTN document.';
                logger.warn(`KYC auto-rejected for user ${req.user.id}: NTN extraction failed`);
              } else {
                verificationStatus = VerificationStatus.VERIFIED;
                kycStage = KycStage.VERIFIED;
                logger.info(`KYC auto-approved for user ${req.user.id}: CNIC ${cnic}, NTN ${ntn}`);
              }
            } else {
              rejectionReason = 'NTN certificate is required for company registration.';
            }
          } else {
            verificationStatus = VerificationStatus.VERIFIED;
            kycStage = KycStage.VERIFIED;
            logger.info(`KYC auto-approved for user ${req.user.id}: CNIC ${cnic}`);
          }
        }
      }

      await prisma.user.update({
        where: { id: req.user.id },
        data: {
          cnic: cnic || null,
          verificationStatus,
          kycStage,
          rejectionReason,
        },
      });

      if (verificationStatus === VerificationStatus.VERIFIED) {
        sendSuccess(res, 'KYC approved! Your documents have been verified successfully.', {
          status: VerificationStatus.VERIFIED,
          cnic
        });
      } else {
        sendError(res, rejectionReason, { status: VerificationStatus.REJECTED }, 400);
      }
    } catch (err) {
      sendError(res, 'Failed to process KYC', err);
    }
  },
];

export async function getKycStatus(req, res) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    sendSuccess(res, 'KYC status fetched', {
      kycStatus: user.verificationStatus,
      kycStage: user.kycStage,
      cnic: user.cnic || null,
      rejectionReason: user.rejectionReason || null
    });
  } catch (err) {
    sendError(res, 'Failed to fetch KYC status', err);
  }
}

export async function approveKyc(req, res) {
  try {
    const { userId } = req.params;
    await prisma.user.update({
      where: { id: Number(userId) },
      data: {
        verificationStatus: VerificationStatus.VERIFIED,
        kycStage: KycStage.VERIFIED,
        rejectionReason: null
      }
    });
    logger.info(`Admin manually approved KYC for user ${userId}`);
    sendSuccess(res, 'KYC approved');
  } catch (err) {
    sendError(res, 'Failed to approve KYC', err);
  }
}

export async function rejectKyc(req, res) {
  try {
    const { userId } = req.params;
    const { reason } = req.body;
    await prisma.user.update({
      where: { id: Number(userId) },
      data: {
        verificationStatus: VerificationStatus.REJECTED,
        kycStage: VerificationStatus.REJECTED, // Keeping consistent with previous logic, though maybe should be a stage
        rejectionReason: reason || 'Rejected by admin'
      },
    });
    logger.info(`Admin manually rejected KYC for user ${userId}: ${reason}`);
    sendSuccess(res, 'KYC rejected');
  } catch (err) {
    sendError(res, 'Failed to reject KYC', err);
  }
}
