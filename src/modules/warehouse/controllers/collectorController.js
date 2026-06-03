import bcrypt from "bcrypt";
import crypto from "crypto";
import {
  CollectorAvailability,
  CollectorDeliveryStatus,
  CollectorTaskStatus,
  CollectorTaskType,
  UserRole,
  WasteVerificationStatus,
} from "../../../constants/enums.js";
import prisma from "../../../lib/prisma.js";
import { logActivity } from "../../../utils/activityLogger.js";
import { sendError, sendPaginated, sendSuccess } from "../../../utils/responseHelper.js";
import { uploadToCloudinary } from "../../../utils/uploadHelper.js";
import { getIO } from "../../chat/gateway/socketGateway.js";
import { solveTSP } from "../../../utils/algorithms/router.js";
import { KDTree, getHaversineDistance } from "../../../utils/algorithms/kdTree.js";
import { EventBus } from "../../../events/eventBus.js";

const terminalStatuses = [
  CollectorTaskStatus.COMPLETED,
  CollectorTaskStatus.CANCELLED,
  CollectorTaskStatus.REJECTED,
];

function parseId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isNaN(id) ? null : id;
}

function toFloat(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function normalizeImages(images) {
  if (!images) return [];
  return Array.isArray(images) ? images : [images];
}

function getTaskTimeField(status) {
  return {
    ACCEPTED: "acceptedAt",
    EN_ROUTE_TO_PICKUP: "pickupStartedAt",
    ARRIVED_AT_SOURCE: "arrivedAtSourceAt",
    PICKED_UP: "pickedUpAt",
    IN_TRANSIT: "transitStartedAt",
    ARRIVED_AT_DESTINATION: "arrivedDestinationAt",
    DELIVERED: "completedAt",
    COMPLETED: "completedAt",
    CANCELLED: "cancelledAt",
    REJECTED: "cancelledAt",
  }[status];
}

function getTaskInclude() {
  return {
    collector: { select: { id: true, name: true, collectorId: true, contactNo: true, profileImage: true } },
    warehouse: { select: { id: true, name: true, businessName: true, contactNo: true, address: true } },
    sourceUser: { select: { id: true, name: true, businessName: true, companyName: true, contactNo: true, address: true } },
    destinationUser: { select: { id: true, name: true, businessName: true, companyName: true, contactNo: true, address: true } },
    verification: true,
    delivery: true,
  };
}

async function ensureWarehouseCollector(warehouseId, collectorId) {
  const collector = await prisma.user.findFirst({
    where: {
      id: collectorId,
      role: UserRole.COLLECTOR,
      deletedAt: null,
      OR: [{ assignedWarehouseId: warehouseId }, { createdById: warehouseId }],
    },
    include: { collectorProfile: true },
  });
  return collector;
}

async function getCollectorTaskForUser(taskId, user) {
  const where = { id: taskId };
  if (user.role === UserRole.COLLECTOR) {
    where.collectorId = user.id;
  } else if (user.role === UserRole.WAREHOUSE) {
    where.warehouseId = user.id;
  } else if (user.role !== UserRole.ADMIN) {
    return null;
  }

  return prisma.collectorTask.findFirst({ where, include: getTaskInclude() });
}

export async function assignCollectorTask(req, res) {
  try {
    const warehouseId = req.user.id;
    const {
      collectorId,
      taskType,
      priority,
      sourceType,
      sourceUserId,
      sourceName,
      sourceAddress,
      sourceContact,
      sourceLatitude,
      sourceLongitude,
      destinationType,
      destinationUserId,
      destinationName,
      destinationAddress,
      destinationContact,
      destinationLatitude,
      destinationLongitude,
      materialCategory,
      materialType,
      estimatedWeight,
      unit,
      listedPrice,
      pricePerUnit,
      deliveryFee,
      notes,
      instructions,
      images,
      routeInfo,
      metadata,
    } = req.body;

    if (!collectorId || !taskType || !sourceType || !sourceAddress || !destinationType || !destinationAddress || !materialCategory || !estimatedWeight) {
      return sendError(res, "Collector, task type, source, destination, material category and estimated weight are required", null, 400);
    }

    if (!Object.values(CollectorTaskType).includes(taskType)) {
      return sendError(res, "Invalid collector task type", null, 400);
    }

    const collectorUserId = parseId(collectorId);
    const collector = await ensureWarehouseCollector(warehouseId, collectorUserId);
    if (!collector) {
      return sendError(res, "Collector does not belong to this warehouse", null, 404);
    }

    const weight = toFloat(estimatedWeight);
    if (!weight || weight <= 0) {
      return sendError(res, "Estimated weight must be greater than zero", null, 400);
    }

    const unitPrice = toFloat(pricePerUnit);
    const explicitValue = toFloat(listedPrice);
    const estimatedValue = explicitValue ?? (unitPrice ? unitPrice * weight : null);

    // Generate a 4-digit OTP delivery PIN for receiver verification
    const otpCode = crypto.randomInt(1000, 9999).toString();

    const task = await prisma.collectorTask.create({
      data: {
        warehouseId,
        collectorId: collectorUserId,
        taskType,
        priority: priority || "NORMAL",
        sourceType,
        sourceUserId: parseId(sourceUserId),
        sourceName,
        sourceAddress,
        sourceContact,
        sourceLatitude: toFloat(sourceLatitude),
        sourceLongitude: toFloat(sourceLongitude),
        destinationType,
        destinationUserId: parseId(destinationUserId),
        destinationName,
        destinationAddress,
        destinationContact,
        destinationLatitude: toFloat(destinationLatitude),
        destinationLongitude: toFloat(destinationLongitude),
        materialCategory,
        materialType,
        estimatedWeight: weight,
        unit: unit || "kg",
        listedPrice: explicitValue,
        pricePerUnit: unitPrice,
        deliveryFee: toFloat(deliveryFee),
        estimatedValue,
        images: normalizeImages(images),
        notes,
        instructions,
        routeInfo,
        metadata,
        otpCode,
      },
      include: getTaskInclude(),
    });

    await logActivity({
      userId: warehouseId,
      role: UserRole.WAREHOUSE,
      action: "COLLECTOR_TASK_ASSIGNED",
      resourceType: "collectorTask",
      resourceId: task.id,
      meta: { collectorId: collectorUserId, taskType },
      req,
    });

    sendSuccess(res, "Collector task assigned successfully", task, 201);
  } catch (err) {
    sendError(res, "Failed to assign collector task", err);
  }
}

export async function getWarehouseCollectorTasks(req, res) {
  try {
    const { status, collectorId, taskType, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(Number.parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), 100);
    const where = { warehouseId: req.user.id };

    if (status) where.status = status;
    if (collectorId) where.collectorId = parseId(collectorId);
    if (taskType) where.taskType = taskType;

    const [totalCount, tasks] = await Promise.all([
      prisma.collectorTask.count({ where }),
      prisma.collectorTask.findMany({
        where,
        include: getTaskInclude(),
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
    ]);

    sendPaginated(res, tasks, totalCount, pageNum, limitNum);
  } catch (err) {
    sendError(res, "Failed to fetch collector tasks", err);
  }
}

export async function getCollectorOperationsSummary(req, res) {
  try {
    const warehouseId = req.user.id;
    const [profiles, activeTasks, completedToday] = await Promise.all([
      prisma.collectorProfile.findMany({
        where: { warehouseId },
        include: { user: { select: { id: true, name: true, collectorId: true, contactNo: true, profileImage: true } } },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.collectorTask.count({ where: { warehouseId, status: { notIn: terminalStatuses } } }),
      prisma.collectorTask.count({
        where: {
          warehouseId,
          status: CollectorTaskStatus.COMPLETED,
          completedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),
    ]);

    const availability = profiles.reduce((acc, profile) => {
      acc[profile.availabilityStatus] = (acc[profile.availabilityStatus] || 0) + 1;
      return acc;
    }, {});

    sendSuccess(res, "Collector operations summary fetched successfully", {
      totalCollectors: profiles.length,
      activeTasks,
      completedToday,
      availability,
      collectors: profiles,
    });
  } catch (err) {
    sendError(res, "Failed to fetch collector operations summary", err);
  }
}

export async function resetCollectorPassword(req, res) {
  try {
    const collectorId = parseId(req.params.id);
    const collector = await ensureWarehouseCollector(req.user.id, collectorId);
    if (!collector) return sendError(res, "Collector not found", null, 404);

    const rawPassword = Math.random().toString(36).slice(-8);
    const hashedPassword = await bcrypt.hash(rawPassword, 10);

    await prisma.user.update({
      where: { id: collectorId },
      data: { password: hashedPassword, plainPassword: rawPassword },
    });

    await logActivity({
      userId: req.user.id,
      role: UserRole.WAREHOUSE,
      action: "COLLECTOR_PASSWORD_RESET",
      resourceType: "collector",
      resourceId: collectorId,
      req,
    });

    sendSuccess(res, "Collector password reset successfully", {
      collectorId: collector.collectorId,
      password: rawPassword,
    });
  } catch (err) {
    sendError(res, "Failed to reset collector password", err);
  }
}

export async function getCollectorProfile(req, res) {
  try {
    const profile = await prisma.collectorProfile.findUnique({
      where: { userId: req.user.id },
      include: {
        user: { select: { id: true, name: true, collectorId: true, contactNo: true, address: true, profileImage: true, createdAt: true } },
        warehouse: { select: { id: true, name: true, businessName: true, contactNo: true, address: true } },
      },
    });

    sendSuccess(res, "Collector profile fetched successfully", {
      ...req.user,
      profile,
    });
  } catch (err) {
    sendError(res, "Failed to fetch collector profile", err);
  }
}

export async function updateCollectorAvailability(req, res) {
  try {
    const { availabilityStatus, dutyStatus, latitude, longitude } = req.body;

    if (availabilityStatus && !Object.values(CollectorAvailability).includes(availabilityStatus)) {
      return sendError(res, "Invalid availability status", null, 400);
    }

    const data = {
      ...(availabilityStatus && { availabilityStatus }),
      ...(dutyStatus && { dutyStatus }),
      lastActiveAt: new Date(),
      ...(latitude !== undefined && { currentLatitude: toFloat(latitude) }),
      ...(longitude !== undefined && { currentLongitude: toFloat(longitude) }),
      ...((latitude !== undefined || longitude !== undefined) && { lastLocationAt: new Date() }),
    };

    if (availabilityStatus === CollectorAvailability.ON_DUTY) data.checkedInAt = new Date();
    if (availabilityStatus === CollectorAvailability.OFFLINE) data.checkedOutAt = new Date();

    const warehouseId = req.user.assignedWarehouseId || req.user.createdById;
    if (!warehouseId) {
      return sendError(res, "Collector is not linked to a warehouse", null, 400);
    }

    const profile = await prisma.collectorProfile.upsert({
      where: { userId: req.user.id },
      update: data,
      create: {
        userId: req.user.id,
        warehouseId,
        employeeId: req.user.collectorId,
        ...data,
      },
    });

    sendSuccess(res, "Availability updated successfully", profile);
  } catch (err) {
    sendError(res, "Failed to update availability", err);
  }
}

export async function getCollectorDashboard(req, res) {
  try {
    const collectorId = req.user.id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [profile, activeTasks, pendingPickups, completedToday, recentNotifications] = await Promise.all([
      prisma.collectorProfile.findUnique({
        where: { userId: collectorId },
        include: { warehouse: { select: { id: true, name: true, businessName: true, contactNo: true } } },
      }),
      prisma.collectorTask.findMany({
        where: { collectorId, status: { notIn: terminalStatuses } },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: getTaskInclude(),
      }),
      prisma.collectorTask.count({ where: { collectorId, status: { in: [CollectorTaskStatus.ASSIGNED, CollectorTaskStatus.ACCEPTED] } } }),
      prisma.collectorTask.count({ where: { collectorId, status: CollectorTaskStatus.COMPLETED, completedAt: { gte: today } } }),
      prisma.activityLog.findMany({
        where: { userId: collectorId },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

    sendSuccess(res, "Collector dashboard fetched successfully", {
      profile,
      activeTasks,
      pendingPickups,
      completedToday,
      currentRoute: activeTasks[0]?.routeInfo || null,
      notifications: recentNotifications,
      summary: {
        onlineStatus: profile?.availabilityStatus || CollectorAvailability.OFFLINE,
        completedTasks: profile?.completedTasks || 0,
        totalCollectedKg: profile?.totalCollectedKg || 0,
        reliabilityScore: profile?.reliabilityScore || 100,
      },
    });
  } catch (err) {
    sendError(res, "Failed to fetch collector dashboard", err);
  }
}

export async function getCollectorTasks(req, res) {
  try {
    const { status, history, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(Number.parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), 100);
    const where = { collectorId: req.user.id };

    if (status) {
      where.status = status;
    } else if (history === "true") {
      where.status = { in: terminalStatuses };
    } else {
      where.status = { notIn: terminalStatuses };
    }

    const [totalCount, tasks] = await Promise.all([
      prisma.collectorTask.count({ where }),
      prisma.collectorTask.findMany({
        where,
        include: getTaskInclude(),
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
    ]);

    sendPaginated(res, tasks, totalCount, pageNum, limitNum);
  } catch (err) {
    sendError(res, "Failed to fetch collector tasks", err);
  }
}

export async function getCollectorTaskDetails(req, res) {
  try {
    const taskId = parseId(req.params.id);
    const task = await getCollectorTaskForUser(taskId, req.user);
    if (!task) return sendError(res, "Task not found", null, 404);

    sendSuccess(res, "Collector task fetched successfully", task);
  } catch (err) {
    sendError(res, "Failed to fetch collector task", err);
  }
}

export async function acceptCollectorTask(req, res) {
  req.body.status = CollectorTaskStatus.ACCEPTED;
  return updateCollectorTaskStatus(req, res);
}

export async function updateCollectorTaskStatus(req, res) {
  try {
    const taskId = parseId(req.params.id);
    const { status, cancellationReason } = req.body;

    if (!Object.values(CollectorTaskStatus).includes(status)) {
      return sendError(res, "Invalid task status", null, 400);
    }

    const existing = await prisma.collectorTask.findFirst({ where: { id: taskId, collectorId: req.user.id } });
    if (!existing) return sendError(res, "Task not found", null, 404);
    if (terminalStatuses.includes(existing.status)) {
      return sendError(res, "Completed, cancelled or rejected tasks cannot be updated", null, 400);
    }

    const timeField = getTaskTimeField(status);
    const data = {
      status,
      ...(timeField && { [timeField]: new Date() }),
      ...(cancellationReason && { cancellationReason }),
    };

    const task = await prisma.collectorTask.update({
      where: { id: taskId },
      data,
      include: getTaskInclude(),
    });

    if ([CollectorTaskStatus.ACCEPTED, CollectorTaskStatus.EN_ROUTE_TO_PICKUP, CollectorTaskStatus.IN_TRANSIT].includes(status)) {
      await prisma.collectorProfile.updateMany({
        where: { userId: req.user.id },
        data: { availabilityStatus: CollectorAvailability.BUSY, lastActiveAt: new Date() },
      });
    }

    if (terminalStatuses.includes(status)) {
      await prisma.collectorProfile.updateMany({
        where: { userId: req.user.id },
        data: { availabilityStatus: CollectorAvailability.ON_DUTY, lastActiveAt: new Date() },
      });
    }

    // Direct side-effects on parent Order status
    if (task.orderId) {
      let newOrderStatus = null;
      if (status === CollectorTaskStatus.ACCEPTED) newOrderStatus = "PROCESSING";
      if (status === CollectorTaskStatus.PICKED_UP) newOrderStatus = "SHIPPED";

      if (newOrderStatus) {
        await prisma.order.update({
          where: { id: task.orderId },
          data: { status: newOrderStatus }
        });

        // Broadcast order status update
        const io = getIO();
        if (io) {
          io.to(`warehouse:${task.warehouseId}`).emit("order:status_updated", {
            orderId: task.orderId,
            status: newOrderStatus
          });
        }
      }
    }

    // Fire FCM notification to warehouse admin
    try {
      const { createAndSendNotification } = await import("../../../services/notificationService.js");
      await createAndSendNotification({
        userId: task.warehouseId,
        title: "Task Status Updated",
        message: `Collector ${req.user.name || "Agent"} marked task #${task.id} as ${status.replace(/_/g, " ")}.`,
        type: "STATUS_UPDATE",
        priority: "MEDIUM"
      });
    } catch (notifErr) {
      console.error("FCM notify failed inside updateTaskStatus:", notifErr.message);
    }

    await logActivity({
      userId: req.user.id,
      role: UserRole.COLLECTOR,
      action: "COLLECTOR_TASK_STATUS_UPDATED",
      resourceType: "collectorTask",
      resourceId: task.id,
      meta: { status },
      req,
    });

    sendSuccess(res, "Task status updated successfully", task);
  } catch (err) {
    sendError(res, "Failed to update task status", err);
  }
}

export async function recordCollectorLocation(req, res) {
  try {
    const taskId = parseId(req.params.id);
    const { latitude, longitude, accuracy, speed, heading, status } = req.body;
    const lat = toFloat(latitude);
    const lng = toFloat(longitude);

    if (lat === null || lng === null) {
      return sendError(res, "Latitude and longitude are required", null, 400);
    }

    if (taskId) {
      const task = await prisma.collectorTask.findFirst({ where: { id: taskId, collectorId: req.user.id } });
      if (!task) return sendError(res, "Task not found", null, 404);
    }

    const [location] = await prisma.$transaction([
      prisma.collectorLocation.create({
        data: {
          taskId,
          collectorId: req.user.id,
          latitude: lat,
          longitude: lng,
          accuracy: toFloat(accuracy),
          speed: toFloat(speed),
          heading: toFloat(heading),
          status,
        },
      }),
      prisma.collectorProfile.updateMany({
        where: { userId: req.user.id },
        data: {
          currentLatitude: lat,
          currentLongitude: lng,
          lastLocationAt: new Date(),
          lastActiveAt: new Date(),
        },
      }),
    ]);

    // Broadcast real-time location via Socket.io for live tracking
    const io = getIO();
    if (io) {
      const payload = {
        collectorId: req.user.id,
        taskId,
        latitude: lat,
        longitude: lng,
        accuracy: toFloat(accuracy),
        speed: toFloat(speed),
        heading: toFloat(heading),
        status,
        timestamp: new Date().toISOString(),
      };
      // Emit to warehouse room so warehouse operators can track live
      if (taskId) {
        io.to(`task:${taskId}`).emit("collector:location", payload);
        prisma.collectorTask.findUnique({ where: { id: taskId }, select: { tripId: true } })
          .then(t => {
            if (t?.tripId) {
              io.to(`trip:${t.tripId}`).emit("collector:location", payload);
            }
          }).catch(() => {});
      }
      io.to(`user:${req.user.id}`).emit("collector:location", payload);
    }

    sendSuccess(res, "Location recorded successfully", location, 201);
  } catch (err) {
    sendError(res, "Failed to record location", err);
  }
}

export async function verifyWasteForTask(req, res) {
  try {
    const taskId = parseId(req.params.id);
    const { verifiedWeight, verifiedCategory, verifiedMaterial, proofImages, notes, status } = req.body;
    const task = await prisma.collectorTask.findFirst({ where: { id: taskId, collectorId: req.user.id } });
    if (!task) return sendError(res, "Task not found", null, 404);

    const actualWeight = toFloat(verifiedWeight);
    if (!actualWeight || actualWeight <= 0) {
      return sendError(res, "Verified weight must be greater than zero", null, 400);
    }

    const verificationStatus = status || WasteVerificationStatus.VERIFIED;
    if (!Object.values(WasteVerificationStatus).includes(verificationStatus)) {
      return sendError(res, "Invalid verification status", null, 400);
    }

    // Upload proof images from multer files to Cloudinary
    const uploadedImages = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        try {
          const result = await uploadToCloudinary(file, `recyconnect/verification/${taskId}`);
          uploadedImages.push(result.secure_url);
        } catch (uploadErr) {
          console.error("Verification image upload failed:", uploadErr.message);
        }
      }
    }
    // Merge with any base64/URL images sent in the body
    const allProofImages = [...uploadedImages, ...normalizeImages(proofImages)];

    const priceAfter = task.pricePerUnit ? task.pricePerUnit * actualWeight : null;
    const weightDifference = actualWeight - task.estimatedWeight;

    const [verification, updatedTask] = await prisma.$transaction([
      prisma.wasteVerification.upsert({
        where: { taskId },
        update: {
          verifiedWeight: actualWeight,
          verifiedCategory: verifiedCategory || task.materialCategory,
          verifiedMaterial,
          proofImages: allProofImages,
          notes,
          status: verificationStatus,
          weightDifference,
          priceBefore: task.estimatedValue,
          priceAfter,
          verifiedById: req.user.id,
          verifiedAt: new Date(),
        },
        create: {
          taskId,
          listedWeight: task.estimatedWeight,
          verifiedWeight: actualWeight,
          listedCategory: task.materialCategory,
          verifiedCategory: verifiedCategory || task.materialCategory,
          verifiedMaterial,
          proofImages: allProofImages,
          notes,
          status: verificationStatus,
          weightDifference,
          priceBefore: task.estimatedValue,
          priceAfter,
          verifiedById: req.user.id,
        },
      }),
      prisma.collectorTask.update({
        where: { id: taskId },
        data: {
          status: verificationStatus === WasteVerificationStatus.REJECTED ? CollectorTaskStatus.REJECTED : CollectorTaskStatus.VERIFIED,
          materialCategory: verifiedCategory || task.materialCategory,
          materialType: verifiedMaterial || task.materialType,
          finalValue: priceAfter,
        },
        include: getTaskInclude(),
      }),
    ]);

    // Warn on significant weight discrepancy (>20%)
    const discrepancyPct = Math.abs(weightDifference) / task.estimatedWeight * 100;
    const warning = discrepancyPct > 20
      ? `Weight discrepancy of ${discrepancyPct.toFixed(1)}% detected (listed: ${task.estimatedWeight}kg, verified: ${actualWeight}kg)`
      : null;

    await logActivity({
      userId: req.user.id,
      role: UserRole.COLLECTOR,
      action: "WASTE_VERIFIED",
      resourceType: "collectorTask",
      resourceId: taskId,
      meta: { verifiedWeight: actualWeight, verifiedCategory, status: verificationStatus, discrepancyPct },
      req,
    });

    sendSuccess(res, "Waste verification completed successfully", { verification, task: updatedTask, warning });
  } catch (err) {
    sendError(res, "Failed to verify waste", err);
  }
}

export async function confirmDeliveryForTask(req, res) {
  try {
    const taskId = parseId(req.params.id);
    const {
      receiverName,
      receiverContact,
      receiverConfirmation,
      receivedWeight,
      packageCondition,
      proofImages,
      notes,
      otpCode,
      distance,
      status = CollectorDeliveryStatus.DELIVERED,
    } = req.body;

    if (!Object.values(CollectorDeliveryStatus).includes(status)) {
      return sendError(res, "Invalid delivery status", null, 400);
    }

    const task = await prisma.collectorTask.findFirst({
      where: { id: taskId, collectorId: req.user.id },
      include: { verification: true, order: true },
    });
    if (!task) return sendError(res, "Task not found", null, 404);

    // OTP verification: if task has an OTP code, validate it
    if (task.otpCode && status === CollectorDeliveryStatus.DELIVERED) {
      if (!otpCode) {
        return sendError(res, "Delivery PIN (OTP) is required for confirmation", null, 400);
      }
      if (otpCode.toString() !== task.otpCode.toString()) {
        return sendError(res, "Invalid delivery PIN. Please check with the receiver.", null, 400);
      }
    }

    // Upload proof images from multer files to Cloudinary
    const uploadedImages = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        try {
          const result = await uploadToCloudinary(file, `recyconnect/delivery/${taskId}`);
          uploadedImages.push(result.secure_url);
        } catch (uploadErr) {
          console.error("Delivery image upload failed:", uploadErr.message);
        }
      }
    }
    const allProofImages = [...uploadedImages, ...normalizeImages(proofImages)];

    const deliveredWeight = toFloat(receivedWeight, task.verification?.verifiedWeight || task.estimatedWeight);
    const completeTask = status === CollectorDeliveryStatus.DELIVERED;

    const txnOps = [
      prisma.collectorDelivery.upsert({
        where: { taskId },
        update: {
          status,
          receiverName,
          receiverContact,
          receiverConfirmation,
          receivedWeight: deliveredWeight,
          packageCondition,
          proofImages: allProofImages,
          notes,
          deliveredById: req.user.id,
          deliveredAt: new Date(),
        },
        create: {
          taskId,
          status,
          receiverName,
          receiverContact,
          receiverConfirmation,
          receivedWeight: deliveredWeight,
          packageCondition,
          proofImages: allProofImages,
          notes,
          deliveredById: req.user.id,
        },
      }),
      prisma.collectorTask.update({
        where: { id: taskId },
        data: {
          status: completeTask ? CollectorTaskStatus.COMPLETED : CollectorTaskStatus.CANCELLED,
          completedAt: completeTask ? new Date() : null,
          cancellationReason: completeTask ? null : notes,
        },
        include: getTaskInclude(),
      }),
      prisma.collectorProfile.updateMany({
        where: { userId: req.user.id },
        data: {
          availabilityStatus: CollectorAvailability.ON_DUTY,
          completedTasks: completeTask ? { increment: 1 } : undefined,
          cancelledTasks: completeTask ? undefined : { increment: 1 },
          totalCollectedKg: completeTask ? { increment: deliveredWeight || 0 } : undefined,
          lastActiveAt: new Date(),
        },
      }),
    ];

    // If completing: generate collector earning & update warehouse inventory
    if (completeTask) {
      // Earning = Base Rs 50 + (verifiedWeight × Rs 10) + (distance × Rs 15)
      const dist = toFloat(distance, 0);
      const earningAmount = 50 + (deliveredWeight * 10) + (dist * 15);

      txnOps.push(
        prisma.collectorEarning.upsert({
          where: { taskId },
          update: { amount: earningAmount, distance: dist },
          create: {
            taskId,
            collectorId: req.user.id,
            amount: earningAmount,
            distance: dist,
          },
        })
      );

      if (task.orderId) {
        txnOps.push(
          prisma.order.update({
            where: { id: task.orderId },
            data: { status: "COMPLETED" },
          })
        );
      }

      // Auto-update warehouse inventory: find or create an inventory row and add inflow
      const materialType = task.verification?.verifiedCategory || task.materialCategory;
      const existingInventory = await prisma.warehouseInventory.findFirst({
        where: { warehouseId: task.warehouseId, materialType },
      });

      if (existingInventory) {
        txnOps.push(
          prisma.warehouseInventory.update({
            where: { id: existingInventory.id },
            data: { quantityInStock: { increment: deliveredWeight } },
          }),
          prisma.inventoryMovement.create({
            data: {
              inventoryId: existingInventory.id,
              type: "INFLOW",
              quantity: deliveredWeight,
              reference: `Task #${taskId} delivery`,
              notes: `Collector delivery - ${materialType}`,
              performedBy: req.user.id,
            },
          })
        );
      } else {
        // Create new inventory entry (no movement yet - it will be created after)
        txnOps.push(
          prisma.warehouseInventory.create({
            data: {
              warehouseId: task.warehouseId,
              materialType,
              category: task.materialType || materialType,
              quantityInStock: deliveredWeight,
              purchasePrice: task.pricePerUnit || 0,
              sellingPrice: task.pricePerUnit ? task.pricePerUnit * 1.3 : 0,
              supplierId: task.sourceUserId,
              notes: `Auto-created from Task #${taskId}`,
            },
          })
        );
      }
    }

    const results = await prisma.$transaction(txnOps);
    const delivery = results[0];
    const updatedTask = results[1];

    await logActivity({
      userId: req.user.id,
      role: UserRole.COLLECTOR,
      action: "COLLECTOR_DELIVERY_CONFIRMED",
      resourceType: "collectorTask",
      resourceId: taskId,
      meta: { status, receivedWeight: deliveredWeight, otpVerified: !!task.otpCode },
      req,
    });

    if (completeTask && task.orderId && task.order) {
      // Emit the EventBus order.completed event
      EventBus.emit("order.completed", {
        orderId: task.orderId,
        buyerId: task.order.buyerId,
        sellerId: task.order.sellerId,
      });

      // Broadcast socket status update to warehouse
      const io = getIO();
      if (io) {
        io.to(`warehouse:${task.warehouseId}`).emit("order:status_updated", {
          orderId: task.orderId,
          status: "COMPLETED"
        });
      }

      // Notify the warehouse of delivery completion
      try {
        const { createAndSendNotification } = await import("../../../services/notificationService.js");
        await createAndSendNotification({
          userId: task.warehouseId,
          title: "Delivery Completed",
          message: `Delivery for task #${task.id} (Order #${task.orderId}) has been successfully completed.`,
          type: "DELIVERY_COMPLETE",
          priority: "HIGH"
        });

        // Notify counterpart client that delivery was successful
        const counterpartId = task.warehouseId === task.order.buyerId ? task.order.sellerId : task.order.buyerId;
        if (counterpartId) {
          await createAndSendNotification({
            userId: counterpartId,
            title: "Order Delivered",
            message: `Your order #${task.orderId} has been delivered successfully.`,
            type: "ORDER_DELIVERED",
            priority: "HIGH"
          });
        }
      } catch (notifErr) {
        console.error("FCM notify failed inside confirmDeliveryForTask:", notifErr.message);
      }
    }

    sendSuccess(res, "Delivery confirmation saved successfully", { delivery, task: updatedTask });
  } catch (err) {
    sendError(res, "Failed to confirm delivery", err);
  }
}

// ── Incident Reporting ──────────────────────────────────────

export async function reportCollectorIncident(req, res) {
  try {
    const taskId = parseId(req.params.id);
    const { type, description } = req.body;

    if (!type || !description) {
      return sendError(res, "Incident type and description are required", null, 400);
    }

    // Validate task belongs to collector (optional: taskId can be null for general incidents)
    if (taskId) {
      const task = await prisma.collectorTask.findFirst({ where: { id: taskId, collectorId: req.user.id } });
      if (!task) return sendError(res, "Task not found", null, 404);
    }

    // Upload proof image if provided
    let proofImageUrl = null;
    if (req.files && req.files.length > 0) {
      try {
        const result = await uploadToCloudinary(req.files[0], `recyconnect/incidents/${taskId || 'general'}`);
        proofImageUrl = result.secure_url;
      } catch (uploadErr) {
        console.error("Incident image upload failed:", uploadErr.message);
      }
    }

    const incident = await prisma.collectorIncident.create({
      data: {
        taskId: taskId || null,
        collectorId: req.user.id,
        type,
        description,
        proofImage: proofImageUrl,
      },
    });

    await logActivity({
      userId: req.user.id,
      role: UserRole.COLLECTOR,
      action: "COLLECTOR_INCIDENT_REPORTED",
      resourceType: "collectorIncident",
      resourceId: incident.id,
      meta: { type, taskId },
      req,
    });

    sendSuccess(res, "Incident reported successfully", incident, 201);
  } catch (err) {
    sendError(res, "Failed to report incident", err);
  }
}

// ── Earnings Ledger ─────────────────────────────────────────

export async function getCollectorEarnings(req, res) {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(Number.parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), 100);
    const where = { collectorId: req.user.id };
    if (status) where.status = status;

    const [totalCount, earnings, aggregate] = await Promise.all([
      prisma.collectorEarning.count({ where }),
      prisma.collectorEarning.findMany({
        where,
        include: {
          task: {
            select: {
              id: true,
              taskType: true,
              materialCategory: true,
              sourceAddress: true,
              destinationAddress: true,
              completedAt: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.collectorEarning.aggregate({
        where: { collectorId: req.user.id },
        _sum: { amount: true },
      }),
    ]);

    const pendingSum = await prisma.collectorEarning.aggregate({
      where: { collectorId: req.user.id, status: "PENDING" },
      _sum: { amount: true },
    });

    const paidSum = await prisma.collectorEarning.aggregate({
      where: { collectorId: req.user.id, status: "PAID" },
      _sum: { amount: true },
    });

    sendSuccess(res, "Earnings fetched successfully", {
      earnings,
      totalCount,
      page: pageNum,
      limit: limitNum,
      wallet: {
        totalEarned: aggregate._sum.amount || 0,
        pendingAmount: pendingSum._sum.amount || 0,
        paidAmount: paidSum._sum.amount || 0,
      },
    });
  } catch (err) {
    sendError(res, "Failed to fetch earnings", err);
  }
}

// ── Optimized TSP A* Routing ────────────────────────────────
export async function getOptimizedRoute(req, res) {
  try {
    const collectorId = req.user.id;

    // 1. Fetch active tasks for routing
    const activeTasks = await prisma.collectorTask.findMany({
      where: {
        collectorId,
        status: {
          in: [
            CollectorTaskStatus.ASSIGNED,
            CollectorTaskStatus.ACCEPTED,
            CollectorTaskStatus.EN_ROUTE_TO_PICKUP,
            CollectorTaskStatus.ARRIVED_AT_SOURCE,
            CollectorTaskStatus.VERIFIED,
            CollectorTaskStatus.PICKED_UP,
            CollectorTaskStatus.IN_TRANSIT,
            CollectorTaskStatus.ARRIVED_AT_DESTINATION
          ]
        }
      }
    });

    if (activeTasks.length === 0) {
      return sendSuccess(res, "No active tasks for routing", {
        sequence: [],
        routePoints: [],
        totalDistance: 0
      });
    }

    // 2. Fetch collector starting location coordinates
    const profile = await prisma.collectorProfile.findUnique({
      where: { userId: collectorId },
      select: { currentLatitude: true, currentLongitude: true }
    });

    // Fallback coordinates (Lahore centre)
    const startCoords = {
      latitude: profile?.currentLatitude || activeTasks[0].sourceLatitude || 31.4015,
      longitude: profile?.currentLongitude || activeTasks[0].sourceLongitude || 74.2405
    };

    // 3. Solve Travelling Salesman Problem
    const result = solveTSP(startCoords, activeTasks);

    // Save optimized route state into the primary task
    await prisma.collectorTask.update({
      where: { id: activeTasks[0].id },
      data: {
        routeInfo: {
          optimizedSequence: result.sequence.map(t => t.id),
          coordinatesCount: result.routePoints.length,
          totalDistanceKm: result.totalDistance
        }
      }
    });

    sendSuccess(res, "Optimized route calculated successfully", {
      startLocation: startCoords,
      optimizedTasks: result.sequence,
      routePoints: result.routePoints,
      totalDistanceKm: result.totalDistance
    });
  } catch (err) {
    sendError(res, "Failed to optimize route", err);
  }
}

// ── Spatial KD-Tree Proximity search ────────────────────────
export async function getNearestCollectors(req, res) {
  try {
    const { lat, lng } = req.query;
    if (!lat || !lng) {
      return sendError(res, "Latitude (lat) and longitude (lng) are required", null, 400);
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);

    if (isNaN(latitude) || isNaN(longitude)) {
      return sendError(res, "Invalid coordinates provided", null, 400);
    }

    // 1. Fetch online collectors with valid coordinates
    const activeProfiles = await prisma.collectorProfile.findMany({
      where: {
        availabilityStatus: {
          in: [CollectorAvailability.ONLINE, CollectorAvailability.ON_DUTY, CollectorAvailability.BUSY]
        },
        currentLatitude: { not: null },
        currentLongitude: { not: null }
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            collectorId: true,
            contactNo: true,
            profileImage: true
          }
        }
      }
    });

    if (activeProfiles.length === 0) {
      return sendSuccess(res, "No online collectors found", {
        nearestCollector: null,
        distanceKm: 0,
        activeCollectorsCount: 0
      });
    }

    // 2. Build 2D KD-Tree
    const points = activeProfiles.map(p => ({
      ...p,
      latitude: p.currentLatitude,
      longitude: p.currentLongitude
    }));

    const tree = new KDTree(points);

    // 3. Locate closest point
    const target = { latitude, longitude };
    const nearestPoint = tree.nearest(target);

    if (!nearestPoint) {
      return sendSuccess(res, "No nearest collector could be determined", null);
    }

    // Compute Haversine distance in km
    const distance = getHaversineDistance(target, {
      latitude: nearestPoint.latitude,
      longitude: nearestPoint.longitude
    });

    sendSuccess(res, "Nearest collector found successfully", {
      nearestCollector: {
        id: nearestPoint.userId,
        employeeId: nearestPoint.employeeId,
        availabilityStatus: nearestPoint.availabilityStatus,
        location: {
          latitude: nearestPoint.latitude,
          longitude: nearestPoint.longitude
        },
        user: nearestPoint.user
      },
      distanceKm: parseFloat(distance.toFixed(3)),
      activeCollectorsCount: activeProfiles.length
    });
  } catch (err) {
    sendError(res, "Failed to locate nearest collector", err);
  }
}
