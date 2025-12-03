import { PrismaClient } from '@prisma/client'
import { logger } from '../utils/logger.js'
import bcrypt from 'bcrypt'
import fs from 'fs/promises'
import cloudinary from '../config/cloudinary.js'
import { UserRole, VerificationStatus } from '../constants/enums.js'
import { sendSuccess, sendError } from '../utils/responseHelper.js'

const prisma = new PrismaClient()

function generateCollectorId() {
  const n = Math.floor(1000 + Math.random() * 9000)
  return `COL-${n}`
}

export async function addCollector(req, res) {
  try {
    const warehouseId = req.user.id
    const { name, address, contactNo } = req.body

    // 1. Validate required fields
    if (!name || !address || !contactNo) {
      return sendError(res, "Name, Address and Contact No are required", null, 400);
    }

    // 2. Handle File Uploads
    let profileImageUrl = null;
    let cnicUrl = null;
    const documentsData = [];

    if (req.files) {
      if (req.files.profileImage?.[0]) {
        const file = req.files.profileImage[0];
        const uploaded = await cloudinary.uploader.upload(file.path, {
          folder: `recyconnect/profile/collector_${Date.now()}`,
        });
        profileImageUrl = uploaded.secure_url;
        await fs.unlink(file.path);
      }

      if (req.files.cnic?.[0]) {
        const file = req.files.cnic[0];
        const uploaded = await cloudinary.uploader.upload(file.path, {
          folder: `recyconnect/docs/collector_${Date.now()}`,
        });
        cnicUrl = uploaded.secure_url;
        await fs.unlink(file.path);

        documentsData.push({
          docType: "CNIC",
          fileUrl: cnicUrl,
          fileName: file.originalname
        });
      }
    }

    // 3. Generate Credentials
    let id;
    do {
      id = generateCollectorId()
    } while (await prisma.user.findUnique({ where: { collectorId: id } }))

    // Generate random 8-char password
    const rawPassword = Math.random().toString(36).slice(-8);
    const hashedPassword = await bcrypt.hash(rawPassword, 10);

    // 4. Create User
    const created = await prisma.user.create({
      data: {
        collectorId: id,
        role: UserRole.COLLECTOR,
        name: name,
        address: address,
        contactNo: contactNo,
        password: hashedPassword,
        profileImage: profileImageUrl,
        createdById: warehouseId,
        assignedWarehouseId: warehouseId,
        verificationStatus: VerificationStatus.VERIFIED, // Auto-verified since added by Warehouse
        emailVerified: true, // No email needed
        documents: {
          create: documentsData
        }
      }
    })

    await prisma.activityLog.create({
      data: {
        userId: warehouseId,
        actorRole: UserRole.WAREHOUSE,
        action: 'COLLECTOR_CREATED',
        resourceType: 'collector',
        resourceId: id,
        meta: { name }
      }
    })

    sendSuccess(res, 'Collector created successfully', {
      collectorId: id,
      password: rawPassword, // Return raw password ONLY ONCE
      name: created.name
    }, 201);
  } catch (err) {
    sendError(res, 'Failed to create collector', err);
  }
}

export async function getCollectors(req, res) {
  try {
    const warehouseId = req.user.id;

    const collectors = await prisma.user.findMany({
      where: {
        createdById: warehouseId,
        role: UserRole.COLLECTOR,
        deletedAt: null
      },
      select: {
        id: true,
        collectorId: true,
        name: true,
        contactNo: true,
        address: true,
        profileImage: true,
        createdAt: true,
        verificationStatus: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    sendSuccess(res, 'Collectors fetched successfully', collectors);
  } catch (err) {
    sendError(res, 'Failed to fetch collectors', err);
  }
}
