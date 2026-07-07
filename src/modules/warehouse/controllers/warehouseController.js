import bcrypt from 'bcrypt';
import { UserRole, VerificationStatus } from '../../../constants/enums.js';
import { sendSuccess, sendError } from '../../../utils/responseHelper.js';
import prisma from '../../../lib/prisma.js';
import { logActivity } from '../../../utils/activityLogger.js';
import { encryptedDocumentData, uploadEncryptedToCloudinary, uploadToCloudinary } from '../../../utils/uploadHelper.js';

function generateCollectorId() {
  const n = Math.floor(1000 + Math.random() * 9000)
  return `COL-${n}`
}

export async function addCollector(req, res) {
  try {
    const warehouseId = req.user.id
    const { name, address, contactNo, vehicleInfo } = req.body

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
        const uploaded = await uploadToCloudinary(file, `recyconnect/profile/collector_${Date.now()}`);
        profileImageUrl = uploaded.secure_url;
      }

      if (req.files.cnic?.[0]) {
        const file = req.files.cnic[0];
        const uploaded = await uploadEncryptedToCloudinary(file, `recyconnect/docs/collector_${Date.now()}`);
        cnicUrl = uploaded.secure_url;
        documentsData.push(encryptedDocumentData("CNIC", file, uploaded));
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
        permissions: {
          tempPassword: rawPassword
        },
        documents: {
          create: documentsData
        },
        collectorProfile: {
          create: {
            warehouseId,
            employeeId: id,
            vehicleInfo: vehicleInfo || undefined
          }
        }
      }
    })

    await logActivity({
      userId: warehouseId,
      role: UserRole.WAREHOUSE,
      action: 'COLLECTOR_CREATED',
      resourceType: 'collector',
      resourceId: id,
      meta: { name },
      req
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
        verificationStatus: true,
        collectorProfile: true,
        permissions: true
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

export async function updateCollector(req, res) {
  try {
    const warehouseId = req.user.id;
    const { id } = req.params;
    const { name, address, contactNo } = req.body;

    // 1. Find user first to verify ownership and existence
    const collector = await prisma.user.findFirst({
      where: {
        id: parseInt(id),
        role: UserRole.COLLECTOR,
        createdById: warehouseId,
        deletedAt: null
      }
    });

    if (!collector) {
      return sendError(res, "Collector not found or access denied", null, 404);
    }

    // 2. Handle File Uploads
    let profileImageUrl = collector.profileImage;
    const documentsData = [];

    if (req.files) {
      if (req.files.profileImage?.[0]) {
        const file = req.files.profileImage[0];
        const uploaded = await uploadToCloudinary(file, `recyconnect/profile/collector_${Date.now()}`);
        profileImageUrl = uploaded.secure_url;
      }

      if (req.files.cnic?.[0]) {
        const file = req.files.cnic[0];
        const uploaded = await uploadEncryptedToCloudinary(file, `recyconnect/docs/collector_${Date.now()}`);
        documentsData.push(encryptedDocumentData("CNIC", file, uploaded));
      }
    }

    // 3. Update User
    const updated = await prisma.user.update({
      where: { id: parseInt(id) },
      data: {
        name: name || undefined,
        address: address || undefined,
        contactNo: contactNo || undefined,
        profileImage: profileImageUrl,
        documents: documentsData.length > 0 ? {
          create: documentsData
        } : undefined
      }
    });

    await logActivity({
      userId: warehouseId,
      role: UserRole.WAREHOUSE,
      action: 'COLLECTOR_UPDATED',
      resourceType: 'collector',
      resourceId: collector.collectorId,
      meta: { name: updated.name },
      req
    });

    sendSuccess(res, 'Collector updated successfully', {
      id: updated.id,
      collectorId: updated.collectorId,
      name: updated.name,
      address: updated.address,
      contactNo: updated.contactNo,
      profileImage: updated.profileImage
    });
  } catch (err) {
    sendError(res, 'Failed to update collector', err);
  }
}

export async function deleteCollector(req, res) {
  try {
    const warehouseId = req.user.id;
    const { id } = req.params;

    // 1. Find user first to verify ownership and existence
    const collector = await prisma.user.findFirst({
      where: {
        id: parseInt(id),
        role: UserRole.COLLECTOR,
        createdById: warehouseId,
        deletedAt: null
      }
    });

    if (!collector) {
      return sendError(res, "Collector not found or access denied", null, 404);
    }

    // 2. Perform soft delete
    await prisma.user.update({
      where: { id: parseInt(id) },
      data: {
        deletedAt: new Date()
      }
    });

    // Also update collector availability status in the profile to OFFLINE
    await prisma.collectorProfile.updateMany({
      where: { userId: parseInt(id) },
      data: {
        availabilityStatus: 'OFFLINE'
      }
    });

    await logActivity({
      userId: warehouseId,
      role: UserRole.WAREHOUSE,
      action: 'COLLECTOR_DELETED',
      resourceType: 'collector',
      resourceId: collector.collectorId,
      meta: { name: collector.name },
      req
    });

    sendSuccess(res, 'Collector deleted successfully', null);
  } catch (err) {
    sendError(res, 'Failed to delete collector', err);
  }
}

