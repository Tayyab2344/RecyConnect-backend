import { getHaversineDistance } from '../../../utils/algorithms/kdTree.js';
import {
  OrderStatus,
  ReservationStatus,
  ListingStatus,
  PaymentStatus,
} from '../../../constants/enums.js';
import { ErrorCodes } from '../../../constants/errorCodes.js';
import { buildDateFilter, getPaginationParams } from '../../../utils/queryHelper.js';
import {
  sendSuccess,
  sendPaginated,
  sendError,
} from '../../../utils/responseHelper.js';
import prisma from '../../../lib/prisma.js';
import { logActivity } from '../../../utils/activityLogger.js';
import * as stripeService from '../../../services/stripeService.js';
import { EventBus } from '../../../events/eventBus.js';
import { invalidateCache } from '../../../lib/redis.js';

// Valid state transitions for orders
const VALID_TRANSITIONS = {
  [OrderStatus.CREATED]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.COMPLETED, OrderStatus.CANCELLED],
  [OrderStatus.COMPLETED]: [], // Terminal state
  [OrderStatus.CANCELLED]: [], // Terminal state
};

const orderInclude = {
  buyer: {
    select: {
      id: true,
      name: true,
      email: true,
      contactNo: true,
      address: true,
      latitude: true,
      longitude: true,
      businessName: true,
      companyName: true,
    },
  },
  seller: {
    select: {
      id: true,
      name: true,
      email: true,
      contactNo: true,
      address: true,
      latitude: true,
      longitude: true,
      businessName: true,
      companyName: true,
    },
  },
  items: {
    include: {
      listing: true,
    },
  },
  reservation: true,
  reviews: true,
  collectorTasks: {
    include: {
      collector: { select: { id: true, name: true, contactNo: true } },
      verification: true,
      delivery: true,
    },
  },
};


/**
 * Validate state transition
 */
const isValidTransition = (currentStatus, newStatus) => {
  const allowedTransitions = VALID_TRANSITIONS[currentStatus] || [];
  return allowedTransitions.includes(newStatus);
};

/**
 * Create a new order from an ACTIVE reservation
 * POST /api/orders
 */
export const createOrder = async (req, res) => {
  try {
    const { listingId, weight, paymentMethod, deliveryMethod, buyerLatitude, buyerLongitude } = req.body;
    const buyerId = req.user.id;

    if (!listingId) {
      return sendError(res, "listingId is required", null, 400);
    }

    // Use interactive transaction to ensure atomicity
    const result = await prisma.$transaction(
      async (tx) => {
        // 1. Fetch and validate listing
        const listing = await tx.listing.findUnique({
          where: { id: parseInt(listingId) },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                contactNo: true,
                address: true,
                role: true,
              },
            },
          },
        });

        if (!listing) {
          throw new Error("Listing not found");
        }

        // 2. Validate listing is available (not sold, not draft)
        if (
          listing.status === ListingStatus.SOLD ||
          listing.status === ListingStatus.CANCELLED
        ) {
          throw new Error("This listing is no longer available");
        }

        // 3. Determine the quantity for this order.
        const availableQty =
          listing.estimatedWeight > 0
            ? listing.estimatedWeight
            : listing.quantity;
        const requestedWeight = weight ? parseFloat(weight) : availableQty;

        if (requestedWeight <= 0) {
          throw new Error("Requested quantity must be greater than zero");
        }

        if (requestedWeight > availableQty) {
          throw new Error(
            `Requested quantity (${requestedWeight} kg) exceeds available stock (${availableQty} kg)`,
          );
        }

        // 4. Validate buyer ≠ seller
        const sellerId = listing.userId;
        if (buyerId === sellerId) {
          throw new Error("You cannot create an order for your own listing");
        }

        // 4b. Fetch buyer details for B2B validation and dispatch
        const buyer = await tx.user.findUnique({
          where: { id: buyerId },
          select: { id: true, name: true, email: true, contactNo: true, address: true, latitude: true, longitude: true, role: true },
        });
                if (!buyer) throw new Error("Buyer not found");

        // 4c. Update buyer's profile coordinates if passed
        if (buyerLatitude && buyerLongitude) {
          await tx.user.update({
            where: { id: buyerId },
            data: {
              latitude: parseFloat(buyerLatitude),
              longitude: parseFloat(buyerLongitude),
            },
          });
        }

        // 4d. B2B purchasing rules enforcement
        const sellerRole = listing.user?.role;
        const buyerRole = buyer.role;
        const isHousehold = (r) => r === 'individual';
        const isOrganization = (r) => r === 'company' || r === 'organization';

        if (isHousehold(buyerRole) && isOrganization(sellerRole)) {
          throw new Error("Household accounts cannot purchase from Organizations");
        }
        if (isOrganization(buyerRole) && isHousehold(sellerRole)) {
          throw new Error("Organization accounts cannot purchase from Households");
        }

        // 5. Calculate total amount
        const pricePerKg = listing.price > 0 ? listing.price : 20.0; // fallback price
        const totalAmount = pricePerKg * requestedWeight;

        // 6. Create order with status CREATED
        const handshakeOtp = Math.floor(1000 + Math.random() * 9000).toString();
        const resolvedDeliveryMethod = deliveryMethod || 
          ((sellerRole === "warehouse" || buyerRole === "warehouse") 
            ? "WAREHOUSE_COLLECTOR_SERVICE" 
            : "SELF_TRANSPORTATION");

        let order = await tx.order.create({
          data: {
            buyerId,
            sellerId,
            status: OrderStatus.CREATED,
            totalAmount,
            paymentMethod: paymentMethod || "cod",
            deliveryMethod: resolvedDeliveryMethod,
            handshakeOtp,
            items: {
              create: {
                listingId: listing.id,
                quantity: requestedWeight,
                price: pricePerKg,
              },
            },
          },
          include: orderInclude,
        });

        // 7. Deduct stock atomically and mark listing as SOLD if fully ordered
        const newQty = availableQty - requestedWeight;
        await tx.listing.update({
          where: { id: listing.id },
          data: {
            estimatedWeight: newQty,
            quantity: newQty,
            status: newQty <= 0 ? ListingStatus.SOLD : listing.status,
          },
        });

        // 8. Auto-create CollectorTask (Dispatch Record)
        const isSelfDelivery = resolvedDeliveryMethod === "SELF_TRANSPORTATION";
        const isWarehouseCollector = resolvedDeliveryMethod === "WAREHOUSE_COLLECTOR_SERVICE";
        const isIndependentCollector = resolvedDeliveryMethod === "INDEPENDENT_COLLECTOR_SERVICE";

        let taskType = "SELLER_TO_BUYER";
        if (isSelfDelivery) taskType = "SELF_DELIVERY";
        else if (sellerRole === "warehouse") taskType = "WAREHOUSE_TO_BUYER";
        else if (buyerRole === "warehouse") taskType = "SELLER_TO_WAREHOUSE";

        // Use listing coords for source (seller), buyer coords for destination
        const srcLat = listing.latitude || listing.user?.latitude;
        const srcLng = listing.longitude || listing.user?.longitude;
        const srcAddr = listing.pickupAddress || listing.user?.address || "";
        const dstLat = buyerLatitude ? parseFloat(buyerLatitude) : buyer.latitude;
        const dstLng = buyerLongitude ? parseFloat(buyerLongitude) : buyer.longitude;
        const dstAddr = buyer.address || "";

        // 8. Create Dispatch (Logistics) request if RecyConnect Pickup or Collector service is selected
        const isRecyConnectPickup = resolvedDeliveryMethod === "RECYCONNECT_PICKUP" || 
                                    resolvedDeliveryMethod === "INDEPENDENT_COLLECTOR_SERVICE" || 
                                    resolvedDeliveryMethod === "WAREHOUSE_COLLECTOR_SERVICE";

        if (isRecyConnectPickup) {
          const { chosenWarehouseId } = req.body;
          let selectedWarehouseId = chosenWarehouseId ? parseInt(chosenWarehouseId, 10) : null;

          if (!selectedWarehouseId) {
            if (buyerRole === "warehouse") {
              selectedWarehouseId = buyerId;
            } else if (sellerRole === "warehouse") {
              selectedWarehouseId = sellerId;
            } else {
              selectedWarehouseId = await findBestWarehouseForLogisticsHelper(tx, {
                sellerLat: srcLat,
                sellerLng: srcLng,
                buyerLat: dstLat,
                buyerLng: dstLng,
                excludeIds: []
              });
            }
          }

          if (!selectedWarehouseId) {
            throw new Error("No available warehouse logistics provider within delivery range.");
          }

          const dist = getHaversineDistance(
            { latitude: srcLat || 33.6844, longitude: srcLng || 73.0479 },
            { latitude: dstLat || 33.6844, longitude: dstLng || 73.0479 }
          );

          // If the warehouse is buyer or seller, auto-accept dispatch
          const isWarehouseUser = buyerRole === "warehouse" || sellerRole === "warehouse";
          const statusVal = isWarehouseUser ? "ACCEPTED" : "PENDING_ACCEPTANCE";
          const assignedAtVal = isWarehouseUser ? new Date() : null;

          await tx.dispatch.create({
            data: {
              orderId: order.id,
              warehouseId: selectedWarehouseId,
              dispatchStatus: statusVal,
              assignedAt: assignedAtVal,
              pickupLocation: srcAddr,
              deliveryLocation: dstAddr,
              estimatedDistance: dist,
              estimatedDuration: dist * 2.0,
              deliveryFee: Math.round(dist * 10)
            }
          });

          // Set order status: WAREHOUSE_ASSIGNED if auto-accepted, else WAITING_FOR_DISPATCH
          order = await tx.order.update({
            where: { id: order.id },
            data: { status: isWarehouseUser ? "WAREHOUSE_ASSIGNED" : "WAITING_FOR_DISPATCH" },
            include: orderInclude,
          });

          if (isWarehouseUser) {
            await tx.user.update({
              where: { id: selectedWarehouseId },
              data: { currentActiveDispatches: { increment: 1 } }
            });
          }
        }

        // 9. Auto-create BUYER_SELLER conversation and initial SYSTEM message
        const conversation = await tx.conversation.create({
          data: {
            participant1Id: buyerId,
            participant2Id: sellerId,
            orderId: order.id,
            type: "BUYER_SELLER",
          },
        });

        await tx.message.create({
          data: {
            conversationId: conversation.id,
            senderId: buyerId,
            content: "Conversation started",
            messageType: "SYSTEM",
          },
        });

        return { order };
      },
      { timeout: 30000 },
    );

    await logActivity({
      userId: req.user.id,
      role: req.user.role,
      action: "CREATE_ORDER",
      resourceType: "order",
      resourceId: result.order.id,
      meta: { listingId: listingId, totalAmount: result.order.totalAmount },
      req,
    });

    // Fire asynchronous hook for side-effects
    EventBus.emit("order.created", {
      orderId: result.order.id,
      buyerId: buyerId,
      sellerId: result.order.sellerId,
    });

    sendSuccess(res, "Order created successfully", result.order, 201);
  } catch (error) {
    sendError(res, error.message || "Failed to create order", null, 400);
  }
};

/**
 * Confirm an order (seller action)
 * POST /api/orders/:id/confirm
 * Transition: CREATED → CONFIRMED
 */
export const confirmOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await prisma.$transaction(
      async (tx) => {
        // 1. Fetch order with reservation
        const order = await tx.order.findUnique({
          where: { id: parseInt(id) },
          include: { reservation: true },
        });

        if (!order) {
          throw new Error("Order not found");
        }

        // 2. Validate seller owns this order
        if (order.sellerId !== userId) {
          throw new Error("Only the seller can confirm this order");
        }

        // 3. Validate current status
        if (order.status !== OrderStatus.CREATED) {
          throw new Error(
            `Cannot confirm order. Current status: ${order.status}`,
          );
        }

        // 4. Validate state transition
        if (!isValidTransition(order.status, OrderStatus.CONFIRMED)) {
          throw new Error("Invalid state transition");
        }

        // 5. Update order status to CONFIRMED
        const updatedOrder = await tx.order.update({
          where: { id: order.id },
          data: { status: OrderStatus.CONFIRMED },
          include: orderInclude,
        });

        // 6. Lock reservation permanently (COMPLETED status)
        if (order.reservation) {
          await tx.listingReservation.update({
            where: { id: order.reservation.id },
            data: { status: ReservationStatus.COMPLETED },
          });
        }

        return updatedOrder;
      },
      { timeout: 30000 },
    );

    await logActivity({
      userId,
      role: req.user.role,
      action: "CONFIRM_ORDER",
      resourceType: "order",
      resourceId: id,
      req,
    });

    // Invalidate order/report caches
    invalidateCache("cache:*/orders*").catch(() => {});
    invalidateCache("cache:*/reports*").catch(() => {});

    sendSuccess(res, "Order confirmed successfully", result);
  } catch (error) {
    sendError(res, error.message || "Failed to confirm order", null, 400);
  }
};

/**
 * Cancel an order
 * POST /api/orders/:id/cancel
 * Transition: CREATED → CANCELLED or CONFIRMED → CANCELLED
 * Handles payment refunds automatically if payment exists
 */
export const cancelOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    const userId = req.user.id;

    const result = await prisma.$transaction(
      async (tx) => {
        // 1. Fetch order with reservation and payment
        const order = await tx.order.findUnique({
          where: { id: parseInt(id) },
          include: {
            reservation: true,
            payment: true,
          },
        });

        if (!order) {
          throw new Error("Order not found");
        }

        // 2. Validate user is buyer or seller
        if (order.buyerId !== userId && order.sellerId !== userId) {
          throw new Error("You do not have permission to cancel this order");
        }

        // 3. Validate order can be cancelled (CREATED or CONFIRMED only)
        if (
          order.status !== OrderStatus.CREATED &&
          order.status !== OrderStatus.CONFIRMED
        ) {
          throw new Error(
            `Cannot cancel order. Current status: ${order.status}. Only CREATED or CONFIRMED orders can be cancelled.`,
          );
        }

        // 4. Validate state transition
        if (!isValidTransition(order.status, OrderStatus.CANCELLED)) {
          throw new Error("Invalid state transition");
        }

        // 5. Handle payment if exists (for CONFIRMED orders with payment)
        let paymentRefunded = false;
        if (order.payment) {
          const payment = order.payment;

          // Can only refund if payment is AUTHORIZED or CAPTURED (not RELEASED or already REFUNDED)
          if (payment.status === PaymentStatus.RELEASED) {
            throw new Error(
              "Cannot cancel order. Payment has already been released.",
            );
          }

          if (payment.status === PaymentStatus.REFUNDED) {
            // Already refunded, continue with cancellation
            paymentRefunded = true;
          } else if (payment.status === PaymentStatus.AUTHORIZED) {
            // Cancel the PaymentIntent (no capture happened)
            await stripeService.cancelPaymentIntent(payment.paymentIntentId);
            await tx.payment.update({
              where: { id: payment.id },
              data: { status: PaymentStatus.FAILED },
            });
            paymentRefunded = true;
          } else if (payment.status === PaymentStatus.CAPTURED) {
            // Issue refund for captured payment
            await stripeService.createRefund(
              payment.paymentIntentId,
              null, // Full refund
              reason || "requested_by_customer",
            );
            await tx.payment.update({
              where: { id: payment.id },
              data: { status: PaymentStatus.REFUNDED },
            });
            paymentRefunded = true;
          } else if (payment.status === PaymentStatus.INITIATED) {
            // Payment initiated but not authorized - just cancel Stripe intent
            try {
              await stripeService.cancelPaymentIntent(payment.paymentIntentId);
            } catch (e) {
              // Ignore if already cancelled
            }
            await tx.payment.update({
              where: { id: payment.id },
              data: { status: PaymentStatus.FAILED },
            });
          }
        }

        // 6. Update order status to CANCELLED
        const updatedOrder = await tx.order.update({
          where: { id: order.id },
          data: { status: OrderStatus.CANCELLED },
          include: orderInclude,
        });

        // 7. Restore listing quantity directly from order items
        if (updatedOrder.items && updatedOrder.items.length > 0) {
          for (const item of updatedOrder.items) {
            // Fetch current listing state
            const currentListing = await tx.listing.findUnique({
              where: { id: item.listingId },
            });
            if (currentListing) {
              const restoredQty =
                (currentListing.estimatedWeight ||
                  currentListing.quantity ||
                  0) + item.quantity;
              await tx.listing.update({
                where: { id: item.listingId },
                data: {
                  estimatedWeight: restoredQty,
                  quantity: restoredQty,
                  // If listing was SOLD, restore to PUBLISHED
                  status:
                    currentListing.status === ListingStatus.SOLD
                      ? ListingStatus.PUBLISHED
                      : currentListing.status,
                },
              });
            }
          }
        }

        // 8. Legacy: Release reservation if one somehow still exists on this order
        if (order.reservation) {
          // Update reservation status to RELEASED
          await tx.listingReservation.update({
            where: { id: order.reservation.id },
            data: {
              status: ReservationStatus.RELEASED,
              orderId: null, // Unlink from order
            },
          });
        }

        // Archive related conversations when order is cancelled
        await tx.conversation.updateMany({
          where: { orderId: order.id },
          data: { status: "ARCHIVED" },
        });

        return { order: updatedOrder, paymentRefunded };
      },
      { timeout: 30000 },
    );

    await logActivity({
      userId,
      role: req.user.role,
      action: "CANCEL_ORDER",
      resourceType: "order",
      resourceId: id,
      meta: { paymentRefunded: result.paymentRefunded, reason },
      req,
    });

    const message = result.paymentRefunded
      ? "Order cancelled successfully. Payment refunded and reservation released."
      : "Order cancelled successfully. Reservation released and stock restored.";

    // Invalidate order/report/listing caches
    invalidateCache("cache:*/orders*").catch(() => {});
    invalidateCache("cache:*/reports*").catch(() => {});
    invalidateCache("cache:*/listings*").catch(() => {});

    sendSuccess(res, message, result.order);
  } catch (error) {
    sendError(
      res,
      error.message || "Failed to cancel order",
      null,
      400,
      ErrorCodes.ORDER_NOT_CANCELLABLE,
    );
  }
};

/**
 * Complete an order (seller action, after payment captured)
 * POST /api/orders/:id/complete
 * Transition: CONFIRMED → COMPLETED
 * Requires: payment.status = CAPTURED
 */
export const completeOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await prisma.$transaction(
      async (tx) => {
        // 1. Fetch order with payment
        const order = await tx.order.findUnique({
          where: { id: parseInt(id) },
          include: {
            payment: true,
            reservation: true,
          },
        });

        if (!order) {
          throw new Error("Order not found");
        }

        // 2. Validate seller owns this order
        if (order.sellerId !== userId) {
          throw new Error("Only the seller can complete this order");
        }

        // 3. Validate current status is CONFIRMED
        if (order.status !== OrderStatus.CONFIRMED) {
          throw new Error(
            `Cannot complete order. Current status: ${order.status}. Must be CONFIRMED.`,
          );
        }

        // 4. Validate state transition
        if (!isValidTransition(order.status, OrderStatus.COMPLETED)) {
          throw new Error("Invalid state transition");
        }

        // 5. Validate payment is CAPTURED
        if (!order.payment) {
          throw new Error("Cannot complete order. No payment found.");
        }

        if (order.payment.status !== PaymentStatus.CAPTURED) {
          throw new Error(
            `Cannot complete order. Payment must be CAPTURED. Current payment status: ${order.payment.status}`,
          );
        }

        // 4.5. If Self Transportation, verify handshake OTP
        if (order.deliveryMethod === "SELF_TRANSPORTATION" && order.handshakeOtp) {
          const { handshakeOtp } = req.body || {};
          if (!handshakeOtp) {
            throw new Error("Handshake OTP is required for self transportation verification");
          }
          if (handshakeOtp.toString() !== order.handshakeOtp.toString()) {
            throw new Error("Invalid Handshake OTP code. Verification failed.");
          }
        }

        // 6. Update order status to COMPLETED
        const updatedOrder = await tx.order.update({
          where: { id: order.id },
          data: { status: OrderStatus.COMPLETED },
          include: orderInclude,
        });

        // Archive related conversations when order is completed
        await tx.conversation.updateMany({
          where: { orderId: order.id },
          data: { status: "ARCHIVED" },
        });

        return updatedOrder;
      },
      { timeout: 30000 },
    );

    await logActivity({
      userId,
      role: req.user.role,
      action: "COMPLETE_ORDER",
      resourceType: "order",
      resourceId: id,
      req,
    });

    // Invalidate order/report caches
    invalidateCache("cache:*/orders*").catch(() => {});
    invalidateCache("cache:*/reports*").catch(() => {});

    // Emit order completion event for points and side effects
    EventBus.emit("order.completed", {
      orderId: result.id,
      buyerId: result.buyerId,
      sellerId: result.sellerId,
    });

    sendSuccess(
      res,
      "Order completed successfully. You can now release the payment.",
      result,
    );
  } catch (error) {
    sendError(
      res,
      error.message || "Failed to complete order",
      null,
      400,
      ErrorCodes.INVALID_STATE,
    );
  }
};

async function enrichOrdersWithChatInfo(orders, currentUserId) {
  return await Promise.all(
    orders.map(async (order) => {
      const conversation = await prisma.conversation.findFirst({
        where: {
          orderId: order.id,
          type: "BUYER_SELLER",
        },
        include: {
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              content: true,
              createdAt: true,
              messageType: true,
              senderId: true,
              isRead: true,
            },
          },
        },
      });

      let lastMessage = null;
      let unreadCount = 0;

      if (conversation) {
        lastMessage = conversation.messages[0] || null;
        unreadCount = await prisma.message.count({
          where: {
            conversationId: conversation.id,
            isRead: false,
            senderId: { not: currentUserId },
          },
        });
      }

      return {
        ...order,
        chat: {
          conversationId: conversation ? conversation.id : null,
          lastMessage: lastMessage
            ? {
                id: lastMessage.id,
                content: lastMessage.content,
                createdAt: lastMessage.createdAt,
                messageType: lastMessage.messageType,
                senderId: lastMessage.senderId,
              }
            : null,
          unreadCount,
        },
      };
    })
  );
}

/**
 * Get buyer's orders with filters and pagination
 * GET /api/orders/buyer
 */
export const getBuyerOrders = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, startDate, endDate, page = 1, limit = 10 } = req.query;

    // Build filter conditions
    const where = {
      buyerId: userId,
      ...(status && { status }),
      ...buildDateFilter(startDate, endDate),
    };

    // Get total count
    const totalCount = await prisma.order.count({ where });

    // Get paginated orders
    const {
      skip,
      take,
      page: pageNum,
      limit: limitNum,
    } = getPaginationParams(page, limit);

    const orders = await prisma.order.findMany({
      where,
      select: {
        id: true,
        status: true,
        totalAmount: true,
        paymentMethod: true,
        createdAt: true,
        updatedAt: true,
        buyerId: true,
        sellerId: true,
        buyer: {
          select: { id: true, name: true, email: true, contactNo: true, address: true, latitude: true, longitude: true, businessName: true, companyName: true },
        },
        seller: {
          select: {
            id: true,
            name: true,
            email: true,
            contactNo: true,
            address: true,
            latitude: true,
            longitude: true,
            businessName: true,
            companyName: true,
          },
        },
        items: {
          select: {
            id: true,
            listingId: true,
            quantity: true,
            price: true,
            listing: {
              select: {
                id: true,
                title: true,
                materialType: true,
                images: true,
              },
            },
          },
        },
        reservation: { select: { id: true, status: true, expiresAt: true } },
        collectorTasks: {
          include: {
            collector: { select: { id: true, name: true, contactNo: true } },
            verification: true,
            delivery: true,
          }
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });

    const enrichedOrders = await enrichOrdersWithChatInfo(orders, userId);
    sendPaginated(res, enrichedOrders, totalCount, pageNum, limitNum);
  } catch (error) {
    sendError(res, "Failed to fetch buyer orders", error);
  }
};

/**
 * Get seller's orders with filters and pagination
 * GET /api/orders/seller
 */
export const getSellerOrders = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      status,
      buyerId,
      startDate,
      endDate,
      page = 1,
      limit = 10,
    } = req.query;

    // Build filter conditions
    const where = {
      sellerId: userId,
      ...(status && { status }),
      ...(buyerId && { buyerId: parseInt(buyerId) }),
      ...buildDateFilter(startDate, endDate),
    };

    // Get total count
    const totalCount = await prisma.order.count({ where });

    // Get paginated orders
    const {
      skip,
      take,
      page: pageNum,
      limit: limitNum,
    } = getPaginationParams(page, limit);

    const orders = await prisma.order.findMany({
      where,
      select: {
        id: true,
        status: true,
        totalAmount: true,
        paymentMethod: true,
        createdAt: true,
        updatedAt: true,
        buyerId: true,
        sellerId: true,
        buyer: {
          select: { id: true, name: true, email: true, contactNo: true, address: true, latitude: true, longitude: true, businessName: true, companyName: true },
        },
        seller: {
          select: {
            id: true,
            name: true,
            email: true,
            contactNo: true,
            address: true,
            latitude: true,
            longitude: true,
            businessName: true,
            companyName: true,
          },
        },
        items: {
          select: {
            id: true,
            listingId: true,
            quantity: true,
            price: true,
            listing: {
              select: {
                id: true,
                title: true,
                materialType: true,
                images: true,
              },
            },
          },
        },
        reservation: { select: { id: true, status: true, expiresAt: true } },
        collectorTasks: {
          include: {
            collector: { select: { id: true, name: true, contactNo: true } },
            verification: true,
            delivery: true,
          }
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });

    const enrichedOrders = await enrichOrdersWithChatInfo(orders, userId);
    sendPaginated(res, enrichedOrders, totalCount, pageNum, limitNum);
  } catch (error) {
    sendError(res, "Failed to fetch seller orders", error);
  }
};

/**
 * Get a single order by ID
 * GET /api/orders/:id
 */
export const getOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const order = await prisma.order.findUnique({
      where: { id: parseInt(id) },
      include: orderInclude,
    });

    if (!order) {
      return sendError(res, "Order not found", null, 404);
    }

    // Validate user is buyer or seller
    if (order.buyerId !== userId && order.sellerId !== userId) {
      return sendError(
        res,
        "You do not have permission to view this order",
        null,
        403,
      );
    }

    // For backward compatibility, populate `review` with the review written by the current user
    const currentUserReview = order.reviews.find(r => r.reviewerId === userId) || null;
    const enrichedOrder = {
      ...order,
      review: currentUserReview,
    };

    sendSuccess(res, "Order fetched successfully", enrichedOrder);
  } catch (error) {
    sendError(res, "Failed to fetch order", error);
  }
};

/**
 * Get user's orders (as buyer or seller) with filters - Legacy endpoint
 * GET /api/orders
 */
export const getOrders = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      role, // 'buyer' or 'seller'
      material,
      status,
      startDate,
      endDate,
      unassigned,
      page = 1,
      limit = 10,
    } = req.query;

    // Build filter conditions based on role
    const where = {
      ...(role === "buyer"
        ? { buyerId: userId }
        : role === "seller"
          ? { sellerId: userId }
          : {
              OR: [{ buyerId: userId }, { sellerId: userId }],
            }),
    };

    if (status) {
      where.status = status;
    }

    if (unassigned === "true") {
      where.deliveryMethod = "WAREHOUSE_COLLECTOR_SERVICE";
      where.collectorTasks = {
        none: {
          status: { not: "CANCELLED" }
        }
      };
      if (!status) {
        where.status = { in: ["CONFIRMED", "PROCESSING", "PENDING", "CREATED"] };
      }
    }

    // Use helpers for date
    Object.assign(where, buildDateFilter(startDate, endDate));

    // Get total count
    const totalCount = await prisma.order.count({ where });

    // Get paginated orders
    const {
      skip,
      take,
      page: pageNum,
      limit: limitNum,
    } = getPaginationParams(page, limit);

    const orders = await prisma.order.findMany({
      where: {
        ...where,
        ...(material && {
          items: {
            some: {
              listing: {
                materialType: { equals: material, mode: "insensitive" },
              },
            },
          },
        }),
      },
      select: {
        id: true,
        status: true,
        totalAmount: true,
        paymentMethod: true,
        deliveryMethod: true,
        createdAt: true,
        updatedAt: true,
        buyerId: true,
        sellerId: true,
        buyer: {
          select: { id: true, name: true, email: true, contactNo: true, address: true, latitude: true, longitude: true, businessName: true, companyName: true },
        },
        seller: {
          select: {
            id: true,
            name: true,
            email: true,
            contactNo: true,
            address: true,
            latitude: true,
            longitude: true,
            businessName: true,
            companyName: true,
          },
        },
        items: {
          select: {
            id: true,
            listingId: true,
            quantity: true,
            price: true,
            listing: {
              select: {
                materialType: true,
                pickupAddress: true,
                estimatedWeight: true,
                title: true,
                images: true,
              }
            },
          },
        },
        reservation: { select: { id: true, status: true, expiresAt: true } },
        collectorTasks: {
          include: {
            collector: { select: { id: true, name: true, contactNo: true } },
            verification: true,
            delivery: true,
          }
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });

    const enrichedOrders = await enrichOrdersWithChatInfo(orders, userId);
    sendPaginated(res, enrichedOrders, totalCount, pageNum, limitNum);
  } catch (error) {
    sendError(res, "Failed to fetch orders", error);
  }
};

/**
 * Get user's buying statistics
 * GET /api/orders/stats
 *
 * Optimized: Uses aggregate + groupBy instead of findMany + JS reduce,
 * parallelizes all queries with Promise.all
 */
export const getOrderStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const { role = "buyer" } = req.query;

    const roleFilter =
      role === "buyer" ? { buyerId: userId } : { sellerId: userId };

    // Run all independent queries in parallel
    const [
      totalOrders,
      weightResult,
      materialBreakdown,
      pendingCount,
      confirmedCount,
    ] = await Promise.all([
      // Total orders count
      prisma.order.count({ where: roleFilter }),

      // Total weight — aggregate on OrderItem instead of findMany + reduce
      prisma.orderItem.aggregate({
        _sum: { quantity: true },
        where: {
          order: { ...roleFilter, status: OrderStatus.COMPLETED },
        },
      }),

      // Material breakdown — fetch completed order items grouped
      prisma.orderItem.findMany({
        where: {
          order: { ...roleFilter, status: OrderStatus.COMPLETED },
        },
        select: {
          quantity: true,
          listing: { select: { materialType: true } },
        },
      }),

      // Pending orders count
      prisma.order.count({
        where: {
          ...roleFilter,
          status: { in: [OrderStatus.PENDING, OrderStatus.CREATED] },
        },
      }),

      // Confirmed orders count
      prisma.order.count({
        where: { ...roleFilter, status: OrderStatus.CONFIRMED },
      }),
    ]);

    const totalWeight = weightResult._sum.quantity || 0;

    // Build material breakdown from items
    const byMaterial = materialBreakdown.reduce((acc, item) => {
      const material = item.listing.materialType;
      if (!acc[material]) {
        acc[material] = { count: 0, weight: 0 };
      }
      acc[material].count += 1;
      acc[material].weight += item.quantity;
      return acc;
    }, {});

    sendSuccess(res, "Stats fetched successfully", {
      totalOrders,
      totalWeight: parseFloat(totalWeight.toFixed(2)),
      pendingCount,
      confirmedCount,
      byMaterial,
    });
  } catch (error) {
    sendError(res, "Failed to fetch statistics", error);
  }
};

/**
 * Export orders as CSV
 * GET /api/orders/export
 */
export const exportOrders = async (req, res) => {
  try {
    const userId = req.user.id;
    const { role, material, status, startDate, endDate } = req.query;

    // Build filter conditions
    const where = {
      ...(role === "buyer"
        ? { buyerId: userId }
        : role === "seller"
          ? { sellerId: userId }
          : {
              OR: [{ buyerId: userId }, { sellerId: userId }],
            }),
      ...(status && { status }),
      ...buildDateFilter(startDate, endDate),
    };

    const orders = await prisma.order.findMany({
      where: {
        ...where,
        ...(material && {
          items: {
            some: {
              listing: {
                materialType: { equals: material, mode: "insensitive" },
              },
            },
          },
        }),
      },
      select: {
        id: true,
        status: true,
        totalAmount: true,
        createdAt: true,
        buyer: { select: { name: true, email: true } },
        seller: { select: { name: true, email: true } },
        items: {
          select: {
            id: true,
            listingId: true,
            quantity: true,
            listing: { select: { materialType: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Generate CSV
    const csvHeader =
      "ID,Material Type,Weight (kg),Total Amount,Buyer,Seller,Status,Created At\n";
    const csvRows = orders
      .map((order) => {
        const materialTypes = order.items
          .map((i) => i.listing.materialType)
          .join("; ");
        const totalWeight = order.items.reduce((sum, i) => sum + i.quantity, 0);

        return [
          order.id,
          `"${materialTypes}"`,
          totalWeight,
          order.totalAmount,
          `"${order.buyer?.name || "N/A"}"`,
          `"${order.seller?.name || "N/A"}"`,
          order.status,
          new Date(order.createdAt).toISOString(),
        ].join(",");
      })
      .join("\n");

    const csv = csvHeader + csvRows;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="orders_export.csv"',
    );
    res.send(csv);
  } catch (error) {
    sendError(res, "Failed to export orders", error);
  }
};

/**
 * Update order status - Legacy endpoint with state validation
 * PUT /api/orders/:id/status
 */
export const updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user.id;

    // Check if order belongs to the user (as buyer or seller)
    const order = await prisma.order.findFirst({
      where: {
        id: parseInt(id),
        OR: [{ buyerId: userId }, { sellerId: userId }],
      },
    });

    if (!order) {
      return sendError(res, "Order not found", null, 404);
    }

    // Validate state transition
    if (!isValidTransition(order.status, status)) {
      return sendError(
        res,
        `Invalid state transition from ${order.status} to ${status}`,
        null,
        400,
      );
    }

    // Update order
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: parseInt(id) },
        data: { status },
        include: orderInclude,
      });

      if (status === 'COMPLETED') {
        await tx.conversation.updateMany({
          where: { orderId: order.id },
          data: { status: "ARCHIVED" },
        });
      } else if (status === 'CANCELLED') {
        await tx.conversation.updateMany({
          where: { orderId: order.id },
          data: { status: "ARCHIVED" },
        });

        // Restore listing quantity directly from order items
        if (updated.items && updated.items.length > 0) {
          for (const item of updated.items) {
            const currentListing = await tx.listing.findUnique({
              where: { id: item.listingId },
            });
            if (currentListing) {
              const restoredQty =
                (currentListing.estimatedWeight ||
                  currentListing.quantity ||
                  0) + item.quantity;
              await tx.listing.update({
                where: { id: item.listingId },
                data: {
                  estimatedWeight: restoredQty,
                  quantity: restoredQty,
                  // If listing was SOLD, restore to PUBLISHED
                  status:
                    currentListing.status === 'SOLD'
                      ? 'PUBLISHED'
                      : currentListing.status,
                },
              });
            }
          }
        }
      }

      return updated;
    });

    if (status === 'COMPLETED') {
      EventBus.emit("order.completed", {
        orderId: result.id,
        buyerId: result.buyerId,
        sellerId: result.sellerId,
      });
    }

    await logActivity({
      userId,
      role: req.user.role,
      action: "UPDATE_ORDER_STATUS",
      resourceType: "order",
      resourceId: id,
      meta: { oldStatus: order.status, newStatus: status },
      req,
    });

    sendSuccess(res, "Order updated successfully", result);
  } catch (error) {
    sendError(res, "Failed to update order", error);
  }
};

async function findBestWarehouseForLogisticsHelper(tx, { sellerLat, sellerLng, buyerLat, buyerLng, excludeIds }) {
  const warehouses = await tx.user.findMany({
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
    let lat = w.latitude;
    let lng = w.longitude;

    // Safety fallback for coordinates if they are null
    if (!lat || !lng) {
      if (w.address && w.address.toLowerCase().includes("abbottabad")) {
        lat = 34.1487;
        lng = 73.2123;
      } else {
        return null;
      }
    }

    const distToSeller = getHaversineDistance(
      { latitude: sellerLat, longitude: sellerLng },
      { latitude: lat, longitude: lng }
    );

    const radius = w.deliveryRadius || 10.0;
    if (distToSeller > radius) return null;

    const availableCollectors = w.managedCollectorProfiles.length;
    const workload = w.currentActiveDispatches || 0;
    const rating = w.averageDispatchRating || 4.5;

    const score = distToSeller + (workload * 1.5) - (availableCollectors > 0 ? 10 : 0) - (rating * 2.0);

    return { id: w.id, score };
  }).filter(Boolean);

  if (scored.length === 0) return null;

  scored.sort((a, b) => a.score - b.score);
  return scored[0].id;
}
