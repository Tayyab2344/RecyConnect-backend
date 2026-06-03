import prisma from "../../../lib/prisma.js";
import { logActivity } from "../../../utils/activityLogger.js";
import { sendError, sendPaginated, sendSuccess } from "../../../utils/responseHelper.js";
import { getIO } from "../../chat/gateway/socketGateway.js";
import { solveTSP } from "../../../utils/algorithms/router.js";
import { getHaversineDistance } from "../../../utils/algorithms/kdTree.js";
import { UserRole, CollectorAvailability } from "../../../constants/enums.js";
import crypto from "crypto";

function parseId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isNaN(id) ? null : id;
}

function toFloat(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * recommend collectors for a trip based on suitability score:
 * distance, current workload, reliability, and vehicle capacity.
 */
export async function getCollectorRecommendations(req, res) {
  try {
    const warehouseId = req.user.id;
    const { tripId } = req.query;

    if (!tripId) {
      return sendError(res, "tripId is required", null, 400);
    }

    const trip = await prisma.trip.findFirst({
      where: { id: parseId(tripId), warehouseId },
      include: { tasks: true }
    });

    if (!trip) {
      return sendError(res, "Trip not found or access denied", null, 404);
    }

    const totalWeight = trip.tasks.reduce((sum, task) => sum + (task.estimatedWeight || 0), 0);

    // Fetch active warehouse collectors
    const collectors = await prisma.collectorProfile.findMany({
      where: {
        warehouseId,
        availabilityStatus: { in: [CollectorAvailability.ONLINE, CollectorAvailability.ON_DUTY] }
      },
      include: {
        user: { select: { id: true, name: true, contactNo: true, profileImage: true } }
      }
    });

    // We need the first task coordinates to calculate starting distance
    const firstTask = trip.tasks.sort((a, b) => a.sequenceIndex - b.sequenceIndex)[0];
    const targetLat = firstTask?.sourceLatitude;
    const targetLng = firstTask?.sourceLongitude;

    const scoredCollectors = [];

    for (const col of collectors) {
      // 1. Vehicle Capacity Check (hard constraint)
      let vehicleCapacity = 100; // default in kg
      try {
        const info = col.vehicleInfo;
        if (info && typeof info === "object" && info.payloadCapacityKg) {
          vehicleCapacity = parseFloat(info.payloadCapacityKg);
        }
      } catch (e) {}

      const vehicleMatch = totalWeight <= vehicleCapacity ? 100 : 0;
      if (vehicleMatch === 0) continue; // Skip incompatible vehicles

      // 2. Distance Score
      let distanceMeters = 0;
      let distScore = 100;
      if (col.currentLatitude && col.currentLongitude && targetLat && targetLng) {
        // Haversine distance in meters
        distanceMeters = getHaversineDistance(
          { latitude: col.currentLatitude, longitude: col.currentLongitude },
          { latitude: targetLat, longitude: targetLng }
        ) * 1000;
        distScore = Math.max(0, 100 - (distanceMeters / 150));
      }

      // 3. Workload Utilization Score
      const activeTasksCount = await prisma.collectorTask.count({
        where: { collectorId: col.userId, status: { in: ["ASSIGNED", "ACCEPTED", "IN_TRANSIT"] } }
      });
      const utilScore = activeTasksCount === 0 ? 100 : activeTasksCount <= 2 ? 70 : 0;

      // 4. Reliability Score
      const reliability = col.reliabilityScore || 100;

      // Aggregate suitability score
      const finalScore = (0.4 * distScore) + (0.2 * utilScore) + (0.2 * reliability) + (0.2 * vehicleMatch);

      scoredCollectors.push({
        collectorId: col.userId,
        name: col.user.name,
        profileImage: col.user.profileImage,
        score: Math.round(finalScore),
        distanceMeters: Math.round(distanceMeters),
        activeTasksCount,
        vehicleInfo: col.vehicleInfo
      });
    }

    sendSuccess(res, "Collector recommendations fetched successfully", {
      tripId: trip.id,
      totalWeightKg: totalWeight,
      recommendations: scoredCollectors.sort((a, b) => b.score - a.score)
    });
  } catch (err) {
    sendError(res, "Failed to fetch collector recommendations", err);
  }
}

/**
 * Cluster pending orders into optimized routes/trips
 */
export async function optimizeAndClusterRoutes(req, res) {
  try {
    const warehouseId = req.user.id;
    const { orderIds } = req.body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return sendError(res, "An array of orderIds is required", null, 400);
    }

    // 1. Fetch the buying/selling warehouse user details for starting point coordinates
    const warehouseUser = await prisma.user.findUnique({
      where: { id: warehouseId },
      select: { latitude: true, longitude: true, address: true }
    });

    const startCoords = {
      latitude: warehouseUser?.latitude || 31.4015,
      longitude: warehouseUser?.longitude || 74.2405
    };

    // 2. Fetch orders
    const orders = await prisma.order.findMany({
      where: {
        id: { in: orderIds.map(id => parseId(id)) },
        deliveryMethod: "WAREHOUSE_COLLECTOR_SERVICE",
        status: { in: ["CONFIRMED", "PENDING", "PROCESSING"] }
      },
      include: {
        buyer: { select: { id: true, name: true, address: true, latitude: true, longitude: true, contactNo: true, role: true } },
        seller: { select: { id: true, name: true, address: true, latitude: true, longitude: true, contactNo: true, role: true } },
        items: true
      }
    });

    if (orders.length === 0) {
      return sendError(res, "No eligible orders found matching the criteria", null, 404);
    }

    // 3. Map orders into routing task nodes
    const routeTasks = orders.map(order => {
      // Determine source (where to pick up) and destination (where to deliver)
      const isWarehouseBuyer = order.buyerId === warehouseId;
      const pickupUser = isWarehouseBuyer ? order.seller : warehouseUser;
      const deliverUser = isWarehouseBuyer ? warehouseUser : order.buyer;

      return {
        id: order.id,
        orderId: order.id,
        taskType: isWarehouseBuyer ? "SELLER_TO_WAREHOUSE" : "WAREHOUSE_TO_BUYER",
        sourceType: isWarehouseBuyer ? order.seller.role : "warehouse",
        sourceLatitude: pickupUser.latitude || startCoords.latitude,
        sourceLongitude: pickupUser.longitude || startCoords.longitude,
        sourceAddress: pickupUser.address || "Unknown Address",
        sourceName: pickupUser.name || "Waste Seller",
        sourceContact: pickupUser.contactNo || "",
        destinationType: isWarehouseBuyer ? "warehouse" : order.buyer.role,
        destinationLatitude: deliverUser.latitude || startCoords.latitude,
        destinationLongitude: deliverUser.longitude || startCoords.longitude,
        destinationAddress: deliverUser.address || "Unknown Destination",
        destinationName: deliverUser.name || "Waste Buyer",
        destinationContact: deliverUser.contactNo || "",
        estimatedWeight: order.items.reduce((sum, item) => sum + (item.quantity || 0), 0),
        materialCategory: order.items[0]?.listingId ? "Waste" : "Recyclable"
      };
    });

    // 4. Run TSP optimization on Lahore graph coordinates
    const tspResult = solveTSP(startCoords, routeTasks);

    // 5. Create Draft Trip and related tasks in database
    const trip = await prisma.$transaction(async (tx) => {
      const createdTrip = await tx.trip.create({
        data: {
          warehouseId,
          status: "PENDING_DISPATCH",
          optimizedPath: tspResult.routePoints,
          totalDistance: tspResult.totalDistance,
          totalDuration: tspResult.totalDistance * 120 // mock duration (2 mins per km)
        }
      });

      // Create Task rows
      const taskCreates = tspResult.sequence.map((task, index) => {
        return tx.collectorTask.create({
          data: {
            tripId: createdTrip.id,
            orderId: task.orderId,
            warehouseId,
            taskType: task.taskType,
            status: "ASSIGNED",
            sequenceIndex: index,
            sourceType: task.sourceType,
            sourceAddress: task.sourceAddress,
            sourceLatitude: task.sourceLatitude,
            sourceLongitude: task.sourceLongitude,
            sourceContact: task.sourceContact,
            sourceName: task.sourceName,
            destinationType: task.destinationType,
            destinationAddress: task.destinationAddress,
            destinationLatitude: task.destinationLatitude,
            destinationLongitude: task.destinationLongitude,
            destinationContact: task.destinationContact,
            destinationName: task.destinationName,
            materialCategory: task.materialCategory,
            estimatedWeight: task.estimatedWeight,
            otpCode: crypto.randomInt(1000, 9999).toString() // Generate unique delivery validation OTP
          }
        });
      });

      await Promise.all(taskCreates);

      return tx.trip.findUnique({
        where: { id: createdTrip.id },
        include: { tasks: true, conversations: true }
      });
    });

    await logActivity({
      userId: warehouseId,
      role: UserRole.WAREHOUSE,
      action: "TRIP_ROUTE_OPTIMIZED",
      resourceType: "trip",
      resourceId: trip.id,
      meta: { orderCount: orders.length, totalDistance: tspResult.totalDistance },
      req
    });

    sendSuccess(res, "Trip route optimized and created successfully", {
      tripId: trip.id,
      status: trip.status,
      totalDistanceKm: tspResult.totalDistance,
      totalStops: trip.tasks.length,
      tasks: trip.tasks.sort((a, b) => a.sequenceIndex - b.sequenceIndex),
      optimizedPath: trip.optimizedPath
    }, 201);
  } catch (err) {
    sendError(res, "Failed to optimize and cluster routes", err);
  }
}

/**
 * Assign and dispatch an optimized Trip to a collector
 */
export async function assignTripToCollector(req, res) {
  try {
    const warehouseId = req.user.id;
    const { tripId, collectorId } = req.body;

    if (!tripId || !collectorId) {
      return sendError(res, "tripId and collectorId are required", null, 400);
    }

    const trip = await prisma.trip.findFirst({
      where: { id: parseId(tripId), warehouseId },
      include: { tasks: true, conversations: true }
    });

    if (!trip) {
      return sendError(res, "Trip not found", null, 404);
    }

    const collectorUserId = parseId(collectorId);
    const collector = await prisma.collectorProfile.findFirst({
      where: {
        userId: collectorUserId,
        warehouseId,
        availabilityStatus: { in: [CollectorAvailability.ONLINE, CollectorAvailability.ON_DUTY] }
      }
    });

    if (!collector) {
      return sendError(res, "Collector is not online or does not belong to this warehouse", null, 404);
    }

    const updatedTrip = await prisma.$transaction(async (tx) => {
      // 1. Update Trip assignments
      const t = await tx.trip.update({
        where: { id: trip.id },
        data: {
          collectorId: collectorUserId,
          status: "ASSIGNED"
        },
        include: { tasks: true }
      });

      // 2. Update all tasks in this trip
      await tx.collectorTask.updateMany({
        where: { tripId: trip.id },
        data: {
          collectorId: collectorUserId,
          status: "ASSIGNED"
        }
      });

      // 3. Create conversation locked to this Trip lifecycle
      const conversation = await tx.conversation.create({
        data: {
          tripId: trip.id,
          participant1Id: warehouseId,
          participant2Id: collectorUserId,
          status: "ACTIVE",
          type: "BUYER_COLLECTOR"
        }
      });

      // 4. Update collector profile status
      await tx.collectorProfile.update({
        where: { id: collector.id },
        data: { availabilityStatus: CollectorAvailability.BUSY }
      });

      return { ...t, conversations: [conversation] };
    });

    // Broadcast assign event via Pusher
    const io = getIO();
    if (io) {
      io.to(`user:${collectorUserId}`).emit("trip:assigned", {
        tripId: trip.id,
        totalStops: trip.tasks.length,
        totalDistance: trip.totalDistance
      });
      io.to(`warehouse:${warehouseId}`).emit("trip:status_updated", {
        tripId: trip.id,
        status: "ASSIGNED",
        collectorId: collectorUserId
      });
    }

    await logActivity({
      userId: warehouseId,
      role: UserRole.WAREHOUSE,
      action: "TRIP_ASSIGNED_TO_COLLECTOR",
      resourceType: "trip",
      resourceId: trip.id,
      meta: { collectorId: collectorUserId },
      req
    });

    sendSuccess(res, "Trip assigned and dispatched successfully", updatedTrip);
  } catch (err) {
    sendError(res, "Failed to assign trip to collector", err);
  }
}

/**
 * Fetch trips list for warehouse operator monitoring pane
 */
export async function getWarehouseTrips(req, res) {
  try {
    const warehouseId = req.user.id;
    const { status, collectorId, startDate, endDate, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(Number.parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), 100);

    const where = { warehouseId };
    if (status) where.status = status;
    if (collectorId) where.collectorId = parseId(collectorId);
    
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [totalCount, trips] = await Promise.all([
      prisma.trip.count({ where }),
      prisma.trip.findMany({
        where,
        include: {
          collector: { include: { collectorProfile: true } },
          tasks: { include: { order: true } },
          conversations: true
        },
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * limitNum,
        take: limitNum
      } )
    ]);

    sendPaginated(res, trips, totalCount, pageNum, limitNum);
  } catch (err) {
    sendError(res, "Failed to fetch warehouse trips", err);
  }
}

/**
 * Assign and dispatch multiple specific Orders to a collector directly
 */
export async function assignOrdersToCollector(req, res) {
  try {
    const warehouseId = req.user.id;
    const { collectorId, orderIds } = req.body;

    if (!collectorId || !orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return sendError(res, "collectorId and a non-empty array of orderIds are required", null, 400);
    }

    const collectorUserId = parseId(collectorId);
    const collector = await prisma.collectorProfile.findFirst({
      where: {
        userId: collectorUserId,
        warehouseId,
        availabilityStatus: { in: [CollectorAvailability.ONLINE, CollectorAvailability.ON_DUTY, CollectorAvailability.BUSY] }
      }
    });

    if (!collector) {
      return sendError(res, "Collector is not available or does not belong to this warehouse", null, 404);
    }

    // Fetch warehouse details
    const warehouseUser = await prisma.user.findUnique({
      where: { id: warehouseId },
      select: { name: true, address: true, latitude: true, longitude: true, contactNo: true }
    });

    const startCoords = {
      latitude: warehouseUser?.latitude || 31.4015,
      longitude: warehouseUser?.longitude || 74.2405
    };

    // Fetch orders to assign
    const orders = await prisma.order.findMany({
      where: {
        id: { in: orderIds.map(id => parseId(id)) },
        deliveryMethod: "WAREHOUSE_COLLECTOR_SERVICE",
        status: { in: ["CONFIRMED", "PENDING", "PROCESSING"] },
        OR: [
          { buyerId: warehouseId },
          { sellerId: warehouseId }
        ]
      },
      include: {
        buyer: { select: { id: true, name: true, address: true, latitude: true, longitude: true, contactNo: true, role: true } },
        seller: { select: { id: true, name: true, address: true, latitude: true, longitude: true, contactNo: true, role: true } },
        items: { include: { listing: true } }
      }
    });

    if (orders.length !== orderIds.length) {
      return sendError(res, "Some orders are not eligible or access was denied", null, 400);
    }

    // Map orders to tasks
    const routeTasks = orders.map(order => {
      const isWarehouseBuyer = order.buyerId === warehouseId;
      const pickupUser = isWarehouseBuyer ? order.seller : warehouseUser;
      const deliverUser = isWarehouseBuyer ? warehouseUser : order.buyer;

      return {
        orderId: order.id,
        taskType: isWarehouseBuyer ? "SELLER_TO_WAREHOUSE" : "WAREHOUSE_TO_BUYER",
        sourceType: isWarehouseBuyer ? order.seller.role : "warehouse",
        sourceLatitude: pickupUser.latitude || startCoords.latitude,
        sourceLongitude: pickupUser.longitude || startCoords.longitude,
        sourceAddress: pickupUser.address || "Unknown Address",
        sourceName: pickupUser.name || "Waste Seller",
        sourceContact: pickupUser.contactNo || "",
        destinationType: isWarehouseBuyer ? "warehouse" : order.buyer.role,
        destinationLatitude: deliverUser.latitude || startCoords.latitude,
        destinationLongitude: deliverUser.longitude || startCoords.longitude,
        destinationAddress: deliverUser.address || "Unknown Destination",
        destinationName: deliverUser.name || "Waste Buyer",
        destinationContact: deliverUser.contactNo || "",
        estimatedWeight: order.items.reduce((sum, item) => sum + (item.quantity || 0), 0),
        materialCategory: order.items[0]?.listing?.materialType || "Recyclable",
        counterpartId: isWarehouseBuyer ? order.sellerId : order.buyerId
      };
    });

    // Run OSRM coordinate sequencing
    const tspResult = solveTSP(startCoords, routeTasks);

    const trip = await prisma.$transaction(async (tx) => {
      // 1. Create Trip
      const createdTrip = await tx.trip.create({
        data: {
          warehouseId,
          collectorId: collectorUserId,
          status: "ASSIGNED",
          optimizedPath: tspResult.routePoints,
          totalDistance: tspResult.totalDistance,
          totalDuration: tspResult.totalDistance * 120
        }
      });

      // 2. Create tasks and conversations
      const createdTasks = [];
      for (let index = 0; index < tspResult.sequence.length; index++) {
        const task = tspResult.sequence[index];
        const otpCode = crypto.randomInt(1000, 9999).toString();
        
        const createdTask = await tx.collectorTask.create({
          data: {
            tripId: createdTrip.id,
            orderId: task.orderId,
            warehouseId,
            collectorId: collectorUserId,
            taskType: task.taskType,
            status: "ASSIGNED",
            sequenceIndex: index,
            sourceType: task.sourceType,
            sourceAddress: task.sourceAddress,
            sourceLatitude: task.sourceLatitude,
            sourceLongitude: task.sourceLongitude,
            sourceContact: task.sourceContact,
            sourceName: task.sourceName,
            destinationType: task.destinationType,
            destinationAddress: task.destinationAddress,
            destinationLatitude: task.destinationLatitude,
            destinationLongitude: task.destinationLongitude,
            destinationContact: task.destinationContact,
            destinationName: task.destinationName,
            materialCategory: task.materialCategory,
            estimatedWeight: task.estimatedWeight,
            otpCode
          }
        });
        createdTasks.push(createdTask);

        // 3. Create conversation between collector and counterpart
        await tx.conversation.create({
          data: {
            orderId: task.orderId,
            participant1Id: task.counterpartId,
            participant2Id: collectorUserId,
            status: "ACTIVE",
            type: "BUYER_SELLER"
          }
        });
      }

      // 4. Create conversation between collector and warehouse
      const warehouseConv = await tx.conversation.create({
        data: {
          tripId: createdTrip.id,
          participant1Id: warehouseId,
          participant2Id: collectorUserId,
          status: "ACTIVE",
          type: "BUYER_COLLECTOR"
        }
      });

      // 5. Update collector profile status
      await tx.collectorProfile.update({
        where: { id: collector.id },
        data: { availabilityStatus: CollectorAvailability.BUSY }
      });

      return { ...createdTrip, tasks: createdTasks, conversations: [warehouseConv] };
    });

    // 6. Broadcast socket events
    const io = getIO();
    if (io) {
      io.to(`user:${collectorUserId}`).emit("trip:assigned", {
        tripId: trip.id,
        totalStops: trip.tasks.length,
        totalDistance: trip.totalDistance
      });
      io.to(`warehouse:${warehouseId}`).emit("trip:status_updated", {
        tripId: trip.id,
        status: "ASSIGNED",
        collectorId: collectorUserId
      });
    }

    // 7. Fire FCM Push Notification via notificationService
    try {
      const { createAndSendNotification } = await import("../../../services/notificationService.js");
      await createAndSendNotification({
        userId: collectorUserId,
        title: "New Assignments Dispatched",
        message: `You have been assigned ${orders.length} new orders.`,
        type: "ASSIGNMENT",
        priority: "HIGH"
      });
    } catch (notifErr) {
      console.error("FCM dispatch failed inside assign-orders:", notifErr.message);
    }

    await logActivity({
      userId: warehouseId,
      role: UserRole.WAREHOUSE,
      action: "TRIP_ASSIGNED_TO_COLLECTOR_DIRECT",
      resourceType: "trip",
      resourceId: trip.id,
      meta: { collectorId: collectorUserId, orderIds },
      req
    });

    sendSuccess(res, "Orders assigned and dispatched successfully", trip, 201);
  } catch (err) {
    sendError(res, "Failed to assign orders to collector", err);
  }
}
