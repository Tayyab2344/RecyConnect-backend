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

function getCoordsFallback(address) {
  if (address && address.toLowerCase().includes("abbottabad")) {
    return { latitude: 34.1504, longitude: 73.2078 };
  }
  if (address && address.toLowerCase().includes("islamabad")) {
    return { latitude: 33.6844, longitude: 73.0479 };
  }
  return { latitude: 31.4015, longitude: 74.2405 };
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
      } catch (e) { }

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

    const wFallback = getCoordsFallback(warehouseUser?.address);
    const startCoords = {
      latitude: warehouseUser?.latitude || wFallback.latitude,
      longitude: warehouseUser?.longitude || wFallback.longitude
    };

    // 2. Fetch orders
    const orders = await prisma.order.findMany({
      where: {
        id: { in: orderIds.map(id => parseId(id)) },
        deliveryMethod: "WAREHOUSE_COLLECTOR_SERVICE",
        status: { in: ["CONFIRMED", "PENDING", "PROCESSING", "CREATED"] }
      },
      include: {
        buyer: { select: { id: true, name: true, address: true, latitude: true, longitude: true, contactNo: true, role: true } },
        seller: { select: { id: true, name: true, address: true, latitude: true, longitude: true, contactNo: true, role: true } },
        items: { include: { listing: true } }
      }
    });

    if (orders.length === 0) {
      return sendError(res, "No eligible orders found matching the criteria", null, 404);
    }

    // 3. Map orders into routing task nodes
    const routeTasks = orders.map(order => {
      const isSameRoleTrade = order.seller.role !== "warehouse" && order.buyer.role !== "warehouse";
      const isLeg1Active = isSameRoleTrade && ["WAITING_FOR_DISPATCH", "PENDING", "CONFIRMED", "CREATED"].includes(order.status);
      const isWarehouseBuyer = order.buyerId === warehouseId;
      const listing = order.items[0]?.listing;

      let taskType;
      let pickupUser;
      let deliverUser;

      if (isWarehouseBuyer) {
        taskType = "SELLER_TO_WAREHOUSE";
        pickupUser = order.seller;
        deliverUser = warehouseUser;
      } else if (order.sellerId === warehouseId) {
        taskType = "WAREHOUSE_TO_BUYER";
        pickupUser = warehouseUser;
        deliverUser = order.buyer;
      } else if (isSameRoleTrade) {
        if (isLeg1Active) {
          taskType = "SELLER_TO_WAREHOUSE";
          pickupUser = order.seller;
          deliverUser = warehouseUser;
        } else {
          taskType = "WAREHOUSE_TO_BUYER";
          pickupUser = warehouseUser;
          deliverUser = order.buyer;
        }
      } else {
        taskType = "SELLER_TO_BUYER";
        pickupUser = order.seller;
        deliverUser = order.buyer;
      }

      const isSourceSeller = (pickupUser.id === order.sellerId);
      const sourceAddress = isSourceSeller
        ? (listing?.pickupAddress || pickupUser.address || "Unknown Address")
        : (pickupUser.address || "Unknown Address");

      const sFallback = getCoordsFallback(sourceAddress);
      const sourceLatitude = isSourceSeller
        ? (listing?.latitude || pickupUser.latitude || sFallback.latitude)
        : (pickupUser.latitude || sFallback.latitude);

      const sourceLongitude = isSourceSeller
        ? (listing?.longitude || pickupUser.longitude || sFallback.longitude)
        : (pickupUser.longitude || sFallback.longitude);

      const destAddress = (deliverUser.id === warehouseId)
        ? (warehouseUser?.address || "Unknown Destination")
        : (deliverUser.address || "Unknown Destination");

      const dFallback = getCoordsFallback(destAddress);
      const destinationLatitude = deliverUser.latitude || dFallback.latitude;
      const destinationLongitude = deliverUser.longitude || dFallback.longitude;

      return {
        id: order.id,
        orderId: order.id,
        taskType,
        sourceType: isSourceSeller ? order.seller.role : "warehouse",
        sourceLatitude,
        sourceLongitude,
        sourceAddress,
        sourceName: pickupUser.name || "Waste Seller",
        sourceContact: pickupUser.contactNo || "",
        destinationType: (deliverUser.id === warehouseId) ? "warehouse" : order.buyer.role,
        destinationLatitude,
        destinationLongitude,
        destinationAddress: destAddress,
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
        availabilityStatus: { in: [CollectorAvailability.ONLINE, CollectorAvailability.ON_DUTY, CollectorAvailability.OFFLINE] }
      }
    });

    if (!collector) {
      return sendError(res, "Collector does not belong to this warehouse or is unavailable", null, 404);
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

      // 5. Update order and dispatch statuses for all tasks on this trip
      for (const task of trip.tasks) {
        await tx.order.update({
          where: { id: task.orderId },
          data: { status: "COLLECTOR_ASSIGNED" }
        });
        await tx.dispatch.updateMany({
          where: { orderId: task.orderId },
          data: {
            collectorId: collectorUserId,
            dispatchStatus: "ASSIGNED"
          }
        });
      }

      return { ...t, conversations: [conversation] };
    }, { timeout: 15000 });

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
      })
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
        availabilityStatus: { in: [CollectorAvailability.ONLINE, CollectorAvailability.ON_DUTY, CollectorAvailability.BUSY, CollectorAvailability.OFFLINE] }
      }
    });

    if (!collector) {
      return sendError(res, "Collector does not belong to this warehouse or is unavailable", null, 404);
    }

    // Fetch warehouse details
    const warehouseUser = await prisma.user.findUnique({
      where: { id: warehouseId },
      select: { name: true, address: true, latitude: true, longitude: true, contactNo: true }
    });

    const wFallback = getCoordsFallback(warehouseUser?.address);
    const startCoords = {
      latitude: warehouseUser?.latitude || wFallback.latitude,
      longitude: warehouseUser?.longitude || wFallback.longitude
    };

    // Fetch orders to assign
    const orders = await prisma.order.findMany({
      where: {
        id: { in: orderIds.map(id => parseId(id)) },
        deliveryMethod: "WAREHOUSE_COLLECTOR_SERVICE",
        status: { in: ["CONFIRMED", "PENDING", "PROCESSING", "CREATED", "WAREHOUSE_ASSIGNED", "WAITING_FOR_DISPATCH"] },
        OR: [
          { buyerId: warehouseId },
          { sellerId: warehouseId },
          { dispatch: { warehouseId } }
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
      const isSameRoleTrade = order.seller.role !== "warehouse" && order.buyer.role !== "warehouse";
      const isLeg1Active = isSameRoleTrade && ["WAITING_FOR_DISPATCH", "WAREHOUSE_ASSIGNED", "PENDING", "CONFIRMED", "CREATED"].includes(order.status);
      const isWarehouseBuyer = order.buyerId === warehouseId;
      const listing = order.items[0]?.listing;

      let taskType;
      let pickupUser;
      let deliverUser;

      if (isWarehouseBuyer) {
        taskType = "SELLER_TO_WAREHOUSE";
        pickupUser = order.seller;
        deliverUser = warehouseUser;
      } else if (order.sellerId === warehouseId) {
        taskType = "WAREHOUSE_TO_BUYER";
        pickupUser = warehouseUser;
        deliverUser = order.buyer;
      } else if (isSameRoleTrade) {
        if (isLeg1Active) {
          taskType = "SELLER_TO_WAREHOUSE";
          pickupUser = order.seller;
          deliverUser = warehouseUser;
        } else {
          taskType = "WAREHOUSE_TO_BUYER";
          pickupUser = warehouseUser;
          deliverUser = order.buyer;
        }
      } else {
        taskType = "SELLER_TO_BUYER";
        pickupUser = order.seller;
        deliverUser = order.buyer;
      }

      const isSourceSeller = (pickupUser.id === order.sellerId);
      const sourceAddress = isSourceSeller
        ? (listing?.pickupAddress || pickupUser.address || "Unknown Address")
        : (pickupUser.address || "Unknown Address");

      const sFallback = getCoordsFallback(sourceAddress);
      const sourceLatitude = isSourceSeller
        ? (listing?.latitude || pickupUser.latitude || sFallback.latitude)
        : (pickupUser.latitude || sFallback.latitude);

      const sourceLongitude = isSourceSeller
        ? (listing?.longitude || pickupUser.longitude || sFallback.longitude)
        : (pickupUser.longitude || sFallback.longitude);

      const destAddress = (deliverUser.id === warehouseId)
        ? (warehouseUser?.address || "Unknown Destination")
        : (deliverUser.address || "Unknown Destination");

      const dFallback = getCoordsFallback(destAddress);
      const destinationLatitude = deliverUser.latitude || dFallback.latitude;
      const destinationLongitude = deliverUser.longitude || dFallback.longitude;

      return {
        orderId: order.id,
        taskType,
        sourceType: isSourceSeller ? order.seller.role : "warehouse",
        sourceLatitude,
        sourceLongitude,
        sourceAddress,
        sourceName: pickupUser.name || "Waste Seller",
        sourceContact: pickupUser.contactNo || "",
        destinationType: (deliverUser.id === warehouseId) ? "warehouse" : order.buyer.role,
        destinationLatitude,
        destinationLongitude,
        destinationAddress: destAddress,
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

      // 6. Update order and dispatch statuses
      for (const task of tspResult.sequence) {
        await tx.order.update({
          where: { id: task.orderId },
          data: { status: "COLLECTOR_ASSIGNED" }
        });
        await tx.dispatch.updateMany({
          where: { orderId: task.orderId },
          data: {
            collectorId: collectorUserId,
            dispatchStatus: "ASSIGNED"
          }
        });
      }

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

// ── NEW LOGISTICS AND LOGISTICAL DISPATCH METHODS ─────────────────────────────

async function findBestWarehouseForLogistics({ sellerLat, sellerLng, buyerLat, buyerLng, excludeIds }) {
  const warehouses = await prisma.user.findMany({
    where: {
      role: "warehouse",
      deletedAt: null,
      acceptsDispatchOrders: true,
      dispatchStatus: "ACTIVE",
      id: { notIn: excludeIds || [] }
    },
    include: {
      managedCollectorProfiles: {
        where: {
          availabilityStatus: { in: ["ONLINE", "ON_DUTY"] }
        }
      }
    }
  });

  const scored = warehouses.map(w => {
    if (!w.latitude || !w.longitude) return null;

    const distToSeller = getHaversineDistance(
      { latitude: sellerLat, longitude: sellerLng },
      { latitude: w.latitude, longitude: w.longitude }
    );

    const radius = w.deliveryRadius || 10.0;
    if (distToSeller > radius) return null; // Outside service radius

    const availableCollectors = w.managedCollectorProfiles.length;
    const workload = w.currentActiveDispatches || 0;
    const rating = w.averageDispatchRating || 4.5;

    // Lower score is better (Priority sorting)
    const score = distToSeller + (workload * 1.5) - (availableCollectors > 0 ? 10 : 0) - (rating * 2.0);

    return { id: w.id, score };
  }).filter(Boolean);

  if (scored.length === 0) return null;

  scored.sort((a, b) => a.score - b.score);
  return scored[0].id;
}

export async function getNearbyWarehouses(req, res) {
  try {
    const lat = toFloat(req.query.latitude);
    const lng = toFloat(req.query.longitude);

    if (lat === null || lng === null) {
      return sendError(res, "latitude and longitude are required", null, 400);
    }

    const warehouses = await prisma.user.findMany({
      where: {
        role: "warehouse",
        deletedAt: null,
        acceptsDispatchOrders: true
      },
      include: {
        managedCollectorProfiles: {
          where: {
            availabilityStatus: { in: ["ONLINE", "ON_DUTY"] }
          }
        }
      }
    });

    const results = warehouses.map(w => {
      const wLat = w.latitude;
      const wLng = w.longitude;
      if (!wLat || !wLng) return null;

      const distance = getHaversineDistance(
        { latitude: lat, longitude: lng },
        { latitude: wLat, longitude: wLng }
      );

      const radius = w.deliveryRadius || 10.0;
      if (distance > radius) return null; // Outside service radius

      const availableCollectors = w.managedCollectorProfiles.length;
      const estimatedFee = Math.round(distance * 10); // Rs 10 per km
      const estimatedTimeMinutes = Math.round(15 + distance * 3);

      return {
        id: w.id,
        name: w.businessName || w.name || "RecyConnect Warehouse",
        distance: toFloat(distance.toFixed(2)),
        estimatedFee,
        estimatedArrivalTime: `${estimatedTimeMinutes} mins`,
        rating: w.averageDispatchRating || 4.8,
        collectorAvailability: availableCollectors > 0 ? "AVAILABLE" : "UNAVAILABLE",
        availableCollectorsCount: availableCollectors
      };
    }).filter(Boolean);

    // Sort by distance ascending
    results.sort((a, b) => a.distance - b.distance);

    sendSuccess(res, "Nearby warehouses fetched successfully", results);
  } catch (err) {
    sendError(res, "Failed to fetch nearby warehouses", err);
  }
}

export async function requestDispatch(req, res) {
  try {
    const { orderId, warehouseId } = req.body;
    const order = await prisma.order.findUnique({
      where: { id: parseId(orderId) },
      include: {
        items: {
          include: {
            listing: true
          }
        },
        buyer: true,
        seller: true
      }
    });

    if (!order) {
      return sendError(res, "Order not found", null, 404);
    }

    // Get coordinates
    const sellerLat = order.items[0]?.listing?.latitude || order.seller.latitude;
    const sellerLng = order.items[0]?.listing?.longitude || order.seller.longitude;
    const buyerLat = order.buyer.latitude;
    const buyerLng = order.buyer.longitude;

    if (!sellerLat || !sellerLng || !buyerLat || !buyerLng) {
      return sendError(res, "Coordinates missing for seller or buyer. Cannot dispatch.", null, 400);
    }

    let selectedWarehouseId = warehouseId ? parseId(warehouseId) : null;
    const rejectedWarehouseIds = [];

    if (!selectedWarehouseId) {
      // Automatic Assignment
      selectedWarehouseId = await findBestWarehouseForLogistics({
        sellerLat,
        sellerLng,
        buyerLat,
        buyerLng,
        excludeIds: rejectedWarehouseIds
      });
    }

    if (!selectedWarehouseId) {
      return sendError(res, "No available warehouse logistics provider found.", null, 404);
    }

    // Create or update Dispatch record
    const dispatch = await prisma.dispatch.upsert({
      where: { orderId: order.id },
      update: {
        warehouseId: selectedWarehouseId,
        dispatchStatus: "PENDING_ACCEPTANCE",
        pickupLocation: order.items[0]?.listing?.pickupAddress || order.seller.address || "",
        deliveryLocation: order.buyer.address || "",
        estimatedDistance: getHaversineDistance({ latitude: sellerLat, longitude: sellerLng }, { latitude: buyerLat, longitude: buyerLng }),
        estimatedDuration: getHaversineDistance({ latitude: sellerLat, longitude: sellerLng }, { latitude: buyerLat, longitude: buyerLng }) * 2.0
      },
      create: {
        orderId: order.id,
        warehouseId: selectedWarehouseId,
        dispatchStatus: "PENDING_ACCEPTANCE",
        pickupLocation: order.items[0]?.listing?.pickupAddress || order.seller.address || "",
        deliveryLocation: order.buyer.address || "",
        estimatedDistance: getHaversineDistance({ latitude: sellerLat, longitude: sellerLng }, { latitude: buyerLat, longitude: buyerLng }),
        estimatedDuration: getHaversineDistance({ latitude: sellerLat, longitude: sellerLng }, { latitude: buyerLat, longitude: buyerLng }) * 2.0,
        deliveryFee: Math.round(getHaversineDistance({ latitude: sellerLat, longitude: sellerLng }, { latitude: buyerLat, longitude: buyerLng }) * 10)
      }
    });

    // Update Order Status to WAITING_FOR_DISPATCH
    await prisma.order.update({
      where: { id: order.id },
      data: { status: "WAITING_FOR_DISPATCH" }
    });

    // Notify warehouse via WebSocket
    const io = getIO();
    if (io) {
      io.to(`warehouse:${selectedWarehouseId}`).emit("dispatch:new_request", {
        dispatchId: dispatch.id,
        orderId: order.id
      });
    }

    sendSuccess(res, "Dispatch requested successfully", dispatch, 201);
  } catch (err) {
    sendError(res, "Failed to request dispatch", err);
  }
}

export async function getPendingDispatches(req, res) {
  try {
    const warehouseId = req.user.id;
    const dispatches = await prisma.dispatch.findMany({
      where: {
        warehouseId,
        dispatchStatus: "PENDING_ACCEPTANCE"
      },
      include: {
        order: {
          include: {
            items: {
              include: {
                listing: true
              }
            },
            buyer: { select: { id: true, name: true, contactNo: true } },
            seller: { select: { id: true, name: true, contactNo: true } }
          }
        }
      }
    });

    sendSuccess(res, "Pending dispatches fetched", dispatches);
  } catch (err) {
    sendError(res, "Failed to fetch pending dispatches", err);
  }
}

export async function respondToDispatch(req, res) {
  try {
    const dispatchId = parseId(req.params.id);
    const { action } = req.body; // 'ACCEPT' or 'REJECT'
    const warehouseId = req.user.id;

    const dispatch = await prisma.dispatch.findFirst({
      where: { id: dispatchId, warehouseId },
      include: {
        order: {
          include: {
            items: {
              include: {
                listing: true
              }
            },
            buyer: true,
            seller: true
          }
        }
      }
    });

    if (!dispatch) {
      return sendError(res, "Dispatch request not found", null, 404);
    }

    if (action === "ACCEPT") {
      const updated = await prisma.$transaction([
        prisma.dispatch.update({
          where: { id: dispatchId },
          data: {
            dispatchStatus: "ACCEPTED",
            assignedAt: new Date()
          }
        }),
        prisma.order.update({
          where: { id: dispatch.orderId },
          data: { status: "WAREHOUSE_ASSIGNED" }
        }),
        prisma.user.update({
          where: { id: warehouseId },
          data: { currentActiveDispatches: { increment: 1 } }
        })
      ]);

      const io = getIO();
      if (io) {
        io.to(`user:${dispatch.order.buyerId}`).emit("order:status_updated", {
          orderId: dispatch.orderId,
          status: "WAREHOUSE_ASSIGNED"
        });
      }

      return sendSuccess(res, "Dispatch request accepted", updated[0]);
    } else if (action === "REJECT") {
      const rejectedList = dispatch.metadata && typeof dispatch.metadata === "object" && Array.isArray(dispatch.metadata.rejectedWarehouseIds)
        ? [...dispatch.metadata.rejectedWarehouseIds, warehouseId]
        : [warehouseId];

      const sellerLat = dispatch.order.items[0]?.listing?.latitude || dispatch.order.seller.latitude;
      const sellerLng = dispatch.order.items[0]?.listing?.longitude || dispatch.order.seller.longitude;
      const buyerLat = dispatch.order.buyer.latitude;
      const buyerLng = dispatch.order.buyer.longitude;

      // Find next best warehouse
      const nextWarehouseId = await findBestWarehouseForLogistics({
        sellerLat,
        sellerLng,
        buyerLat,
        buyerLng,
        excludeIds: rejectedList
      });

      if (nextWarehouseId) {
        const updated = await prisma.dispatch.update({
          where: { id: dispatchId },
          data: {
            warehouseId: nextWarehouseId,
            dispatchStatus: "PENDING_ACCEPTANCE",
            metadata: {
              ...(dispatch.metadata || {}),
              rejectedWarehouseIds: rejectedList
            }
          }
        });

        await prisma.order.update({
          where: { id: dispatch.orderId },
          data: { status: "WAITING_FOR_DISPATCH" }
        });

        const io = getIO();
        if (io) {
          io.to(`warehouse:${nextWarehouseId}`).emit("dispatch:new_request", {
            dispatchId: dispatch.id,
            orderId: dispatch.orderId
          });
        }

        return sendSuccess(res, "Dispatch request rejected. Routed to next nearest warehouse.", updated);
      } else {
        const updated = await prisma.$transaction([
          prisma.dispatch.update({
            where: { id: dispatchId },
            data: {
              dispatchStatus: "REJECTED",
              metadata: {
                ...(dispatch.metadata || {}),
                rejectedWarehouseIds: rejectedList
              }
            }
          }),
          prisma.order.update({
            where: { id: dispatch.orderId },
            data: { status: "WAREHOUSE_REJECTED" }
          })
        ]);

        return sendSuccess(res, "Dispatch request rejected. No other logistics providers found.", updated[0]);
      }
    } else {
      return sendError(res, "Invalid action, must be ACCEPT or REJECT", null, 400);
    }
  } catch (err) {
    sendError(res, "Failed to respond to dispatch request", err);
  }
}

export async function assignCollectorToDispatch(req, res) {
  try {
    const dispatchId = parseId(req.params.id);
    const { collectorId } = req.body;
    const warehouseId = req.user.id;

    const dispatch = await prisma.dispatch.findFirst({
      where: { id: dispatchId, warehouseId },
      include: {
        order: {
          include: {
            items: {
              include: {
                listing: true
              }
            },
            buyer: true,
            seller: true
          }
        }
      }
    });

    if (!dispatch) {
      return sendError(res, "Dispatch not found", null, 404);
    }

    let selectedCollectorId = collectorId ? parseId(collectorId) : null;

    if (!selectedCollectorId) {
      // Find nearest online collector with lowest workload
      const collectors = await prisma.collectorProfile.findMany({
        where: {
          warehouseId,
          availabilityStatus: { in: ["ONLINE", "ON_DUTY"] }
        },
        orderBy: [
          { activeOrdersCount: "asc" },
          { rating: "desc" }
        ]
      });

      if (collectors.length === 0) {
        return sendError(res, "No online/available collectors found for auto-assignment.", null, 404);
      }

      selectedCollectorId = collectors[0].userId;
    }

    const updated = await prisma.$transaction([
      prisma.dispatch.update({
        where: { id: dispatchId },
        data: {
          collectorId: selectedCollectorId,
          dispatchStatus: "ASSIGNED"
        }
      }),
      prisma.order.update({
        where: { id: dispatch.orderId },
        data: { status: "COLLECTOR_ASSIGNED" }
      }),
      prisma.collectorProfile.update({
        where: { userId: selectedCollectorId },
        data: { activeOrdersCount: { increment: 1 } }
      })
    ]);

    const warehouseUser = await prisma.user.findUnique({
      where: { id: warehouseId }
    });

    const isWarehouseBuyer = dispatch.order.buyerId === warehouseId;
    const isWarehouseSeller = dispatch.order.sellerId === warehouseId;
    const isSameRoleTrade = dispatch.order.seller.role !== "warehouse" && dispatch.order.buyer.role !== "warehouse";

    let taskType = "SELLER_TO_BUYER";
    let sourceType = "HOUSEHOLD";
    let sourceUserId = dispatch.order.sellerId;
    let sourceName = dispatch.order.seller.name || "";
    let sourceAddress = dispatch.order.items[0]?.listing?.pickupAddress || dispatch.order.seller.address || "";
    let sourceContact = dispatch.order.seller.contactNo || "";
    let sourceLat = dispatch.order.items[0]?.listing?.latitude || dispatch.order.seller.latitude;
    let sourceLng = dispatch.order.items[0]?.listing?.longitude || dispatch.order.seller.longitude;

    let destinationType = "HOUSEHOLD";
    let destinationUserId = dispatch.order.buyerId;
    let destinationName = dispatch.order.buyer.name || "";
    let destinationAddress = dispatch.order.buyer.address || "";
    let destinationContact = dispatch.order.buyer.contactNo || "";
    let destLat = dispatch.order.buyer.latitude;
    let destLng = dispatch.order.buyer.longitude;

    if (isWarehouseBuyer) {
      taskType = "SELLER_TO_WAREHOUSE";
      destinationType = "WAREHOUSE";
      destinationUserId = warehouseId;
      destinationName = warehouseUser?.businessName || "Warehouse";
      destinationAddress = warehouseUser?.address || "";
      destLat = warehouseUser?.latitude;
      destLng = warehouseUser?.longitude;
    } else if (isWarehouseSeller) {
      taskType = "WAREHOUSE_TO_BUYER";
      sourceType = "WAREHOUSE";
      sourceUserId = warehouseId;
      sourceName = warehouseUser?.businessName || "Warehouse";
      sourceAddress = warehouseUser?.address || "";
      sourceContact = warehouseUser?.contactNo || "";
      sourceLat = warehouseUser?.latitude;
      sourceLng = warehouseUser?.longitude;
    } else if (isSameRoleTrade) {
      taskType = "SELLER_TO_WAREHOUSE";
      destinationType = "WAREHOUSE";
      destinationUserId = warehouseId;
      destinationName = warehouseUser?.businessName || "Warehouse";
      destinationAddress = warehouseUser?.address || "";
      destLat = warehouseUser?.latitude;
      destLng = warehouseUser?.longitude;
    }

    await prisma.collectorTask.create({
      data: {
        warehouseId,
        collectorId: selectedCollectorId,
        orderId: dispatch.orderId,
        taskType,
        status: "ASSIGNED",
        priority: "NORMAL",
        sourceType,
        sourceUserId,
        sourceName,
        sourceAddress,
        sourceContact,
        sourceLatitude: sourceLat || null,
        sourceLongitude: sourceLng || null,
        destinationType,
        destinationUserId,
        destinationName,
        destinationAddress,
        destinationContact,
        destinationLatitude: destLat || null,
        destinationLongitude: destLng || null,
        materialCategory: dispatch.order.items[0]?.listing?.category || "",
        materialType: dispatch.order.items[0]?.listing?.materialType || null,
        estimatedWeight: dispatch.order.items[0]?.listing?.estimatedWeight || 1.0,
        listedPrice: dispatch.order.items[0]?.listing?.price || 0,
        pricePerUnit: dispatch.order.items[0]?.listing?.price || 0,
        deliveryFee: dispatch.deliveryFee,
        estimatedValue: dispatch.order.totalAmount,
        images: dispatch.order.items[0]?.listing?.images || [],
        otpCode: crypto.randomInt(1000, 9999).toString()
      }
    });

    const io = getIO();
    if (io) {
      io.to(`user:${selectedCollectorId}`).emit("task:new_assignment", {
        orderId: dispatch.orderId
      });
      io.to(`user:${dispatch.order.buyerId}`).emit("order:status_updated", {
        orderId: dispatch.orderId,
        status: "COLLECTOR_ASSIGNED"
      });
    }

    sendSuccess(res, "Collector assigned successfully", updated[0]);
  } catch (err) {
    sendError(res, "Failed to assign collector", err);
  }
}

export async function collectorRespondToDispatch(req, res) {
  try {
    const dispatchId = parseId(req.params.id);
    const { action } = req.body; // 'ACCEPT' or 'DECLINE'
    const collectorId = req.user.id;

    const dispatch = await prisma.dispatch.findFirst({
      where: { id: dispatchId, collectorId },
      include: {
        order: {
          include: {
            buyer: true,
            seller: true
          }
        }
      }
    });

    if (!dispatch) {
      return sendError(res, "Dispatch assignment not found", null, 404);
    }

    const task = await prisma.collectorTask.findFirst({
      where: { orderId: dispatch.orderId, collectorId, status: "ASSIGNED" }
    });

    if (action === "ACCEPT") {
      await prisma.$transaction([
        prisma.dispatch.update({
          where: { id: dispatchId },
          data: { dispatchStatus: "ACCEPTED" }
        }),
        prisma.order.update({
          where: { id: dispatch.orderId },
          data: { status: "COLLECTOR_ACCEPTED" }
        }),
        prisma.collectorProfile.update({
          where: { userId: collectorId },
          data: { availabilityStatus: "ON_DUTY" }
        })
      ]);

      if (task) {
        await prisma.collectorTask.update({
          where: { id: task.id },
          data: { status: "ACCEPTED", acceptedAt: new Date() }
        });
      }

      const io = getIO();
      if (io) {
        io.to(`warehouse:${dispatch.warehouseId}`).emit("dispatch:collector_accepted", {
          dispatchId,
          collectorId
        });
        io.to(`user:${dispatch.order.buyerId}`).emit("order:status_updated", {
          orderId: dispatch.orderId,
          status: "COLLECTOR_ACCEPTED"
        });
      }

      return sendSuccess(res, "Collector accepted assignment");
    } else if (action === "DECLINE") {
      await prisma.$transaction([
        prisma.dispatch.update({
          where: { id: dispatchId },
          data: {
            collectorId: null,
            dispatchStatus: "ACCEPTED"
          }
        }),
        prisma.order.update({
          where: { id: dispatch.orderId },
          data: { status: "COLLECTOR_DECLINED" }
        }),
        prisma.collectorProfile.update({
          where: { userId: collectorId },
          data: { activeOrdersCount: { decrement: 1 } }
        })
      ]);

      if (task) {
        await prisma.collectorTask.update({
          where: { id: task.id },
          data: { status: "CANCELLED", cancellationReason: "Collector declined assignment" }
        });
      }

      const io = getIO();
      if (io) {
        io.to(`warehouse:${dispatch.warehouseId}`).emit("dispatch:collector_declined", {
          dispatchId,
          collectorId
        });
      }

      return sendSuccess(res, "Collector declined assignment. Re-routing to warehouse assignment list.");
    } else {
      return sendError(res, "Invalid action, must be ACCEPT or DECLINE", null, 400);
    }
  } catch (err) {
    sendError(res, "Failed to respond to assignment", err);
  }
}

export async function getWarehouseDispatches(req, res) {
  try {
    const warehouseId = req.user.id;
    const { status } = req.query;

    const dispatches = await prisma.dispatch.findMany({
      where: {
        warehouseId,
        ...(status && { dispatchStatus: status })
      },
      include: {
        order: {
          include: {
            items: {
              include: {
                listing: true
              }
            },
            buyer: { select: { id: true, name: true, contactNo: true } },
            seller: { select: { id: true, name: true, contactNo: true } }
          }
        },
        collector: {
          select: {
            id: true,
            name: true,
            contactNo: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    sendSuccess(res, "Warehouse dispatches fetched successfully", dispatches);
  } catch (err) {
    sendError(res, "Failed to fetch warehouse dispatches", err);
  }
}
