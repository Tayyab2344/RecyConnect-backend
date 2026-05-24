/**
 * Listing Controller
 *
 * Manages recyclable material listings — CRUD operations, marketplace view,
 * AI image classification, statistics, and CSV exports.
 *
 * @module modules/listing/controllers/listingController
 */

import { ListingStatus } from "../../../constants/enums.js";
import { buildDateFilter, buildSearchFilter, getPaginationParams } from "../../../utils/queryHelper.js";
import { sendSuccess, sendPaginated, sendError } from "../../../utils/responseHelper.js";
import prisma from "../../../lib/prisma.js";
import { logActivity } from "../../../utils/activityLogger.js";
import { uploadBase64ToCloudinary } from "../../../utils/cloudinaryUploader.js";
import { invalidateCache } from "../../../lib/redis.js";
import { EventBus } from "../../../events/eventBus.js";
import { classifyImage } from "../../../services/imageClassificationService.js";

/**
 * Create a new listing with image upload and optional AI classification.
 * POST /api/listings
 */
export const createListing = async (req, res) => {
  try {
    const {
      materialType, category, estimatedWeight, price, quantity,
      pickupAddress, latitude, longitude, locationMethod,
      notes, images, title, description,
    } = req.body;

    const userId = req.user.id;
    const status = ListingStatus.PUBLISHED;

    // ── Validation ──────────────────────────────────────────
    if (!materialType || !estimatedWeight) {
      return sendError(res, "Material type and estimated weight are required", null, 400);
    }
    if (parseFloat(estimatedWeight) <= 0) {
      return sendError(res, "Estimated weight must be greater than zero", null, 400);
    }
    if (price && parseFloat(price) < 0) {
      return sendError(res, "Price cannot be negative", null, 400);
    }
    if (quantity && parseFloat(quantity) <= 0) {
      return sendError(res, "Quantity must be greater than zero", null, 400);
    }
    if (!images || (Array.isArray(images) && images.length === 0)) {
      return sendError(res, "At least one image is required", null, 400);
    }
    if (Array.isArray(images) && images.length > 3) {
      return sendError(res, "Maximum 3 images allowed per listing", null, 400);
    }

    // ── Upload Images ───────────────────────────────────────
    const imageUrls = [];
    for (const img of images) {
      if (img.startsWith("http://") || img.startsWith("https://")) {
        imageUrls.push(img);
      } else {
        try {
          const url = await uploadBase64ToCloudinary(img, `recyconnect/listings/${userId}`);
          imageUrls.push(url);
        } catch (uploadErr) {
          console.error("IMAGE_UPLOAD_ERROR:", uploadErr);
          return sendError(res, "Failed to upload image", uploadErr, 400);
        }
      }
    }

    // ── AI Classification (non-blocking) ────────────────────
    let aiClassification = null;
    try {
      if (imageUrls.length > 0) {
        aiClassification = await classifyImage(imageUrls[0], null);
      }
    } catch (classifyErr) {
      console.error("AI_CLASSIFICATION_ERROR:", classifyErr);
    }

    const listingMetadata = req.body.metadata || {};
    if (aiClassification) {
      listingMetadata.aiClassification = aiClassification;
    }

    // ── Create Record ───────────────────────────────────────
    const listing = await prisma.listing.create({
      data: {
        userId,
        category: category || materialType,
        title,
        description,
        materialType,
        estimatedWeight: parseFloat(estimatedWeight),
        price: parseFloat(price) || 0,
        quantity: parseFloat(quantity) || parseFloat(estimatedWeight),
        pickupAddress,
        latitude: parseFloat(latitude) || null,
        longitude: parseFloat(longitude) || null,
        city: req.user.city || null,
        area: req.user.area || null,
        locationMethod: locationMethod || "manual",
        notes: notes || null,
        images: imageUrls,
        status,
        metadata: Object.keys(listingMetadata).length > 0 ? listingMetadata : null,
      },
    });

    await logActivity({
      userId, role: req.user.role, action: "CREATE_LISTING",
      resourceType: "listing", resourceId: listing.id,
      meta: { materialType, price, quantity, aiSource: aiClassification?.source || null },
      req,
    });

    EventBus.emit("listing.created", { listingId: listing.id, category: listing.category });
    invalidateCache("cache:*/listings*").catch(() => {});

    sendSuccess(res, "Listing published successfully", listing, 201);
  } catch (error) {
    console.error("CREATE_LISTING_ERROR:", error);
    sendError(res, "Failed to create listing", error);
  }
};

/**
 * Classify a recyclable material image using AI (Groq → Gemini fallback).
 * POST /api/listings/classify
 */
export const classifyListingImage = async (req, res) => {
  try {
    const { imageUrl, imageBase64 } = req.body;
    if (!imageUrl && !imageBase64) {
      return sendError(res, "Either imageUrl or imageBase64 is required", null, 400);
    }

    const result = await classifyImage(imageUrl || null, imageBase64 || null);
    if (result) {
      sendSuccess(res, "Image classified successfully", result);
    } else {
      sendError(res, "Cloud classification unavailable, use on-device fallback", null, 503);
    }
  } catch (error) {
    console.error("CLASSIFY_IMAGE_ERROR:", error);
    sendError(res, "Failed to classify image", error);
  }
};

/**
 * Get user's listings or marketplace view with filters and pagination.
 * GET /api/listings
 */
export const getListings = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const {
      materialType, status, startDate, endDate,
      search, page = 1, limit = 10, view, lastUpdated,
    } = req.query;

    // ── Marketplace View ────────────────────────────────────
    if (view === "marketplace") {
      let allowedSellerRoles;
      const role = (userRole || "").toLowerCase();
      if (role === "individual") {
        allowedSellerRoles = ["individual", "warehouse"];
      } else if (role === "company" || role === "organization") {
        allowedSellerRoles = ["warehouse"];
      } else {
        allowedSellerRoles = ["individual", "warehouse", "company", "organization", "admin"];
      }

      const where = {
        status: "PUBLISHED",
        userId: { not: userId },
        user: { role: { in: allowedSellerRoles } },
      };

      if (materialType) where.materialType = { equals: materialType, mode: "insensitive" };
      if (search) {
        where.OR = [
          { title: { contains: search, mode: "insensitive" } },
          { materialType: { contains: search, mode: "insensitive" } },
          { notes: { contains: search, mode: "insensitive" } },
          { pickupAddress: { contains: search, mode: "insensitive" } },
        ];
      }
      Object.assign(where, buildDateFilter(startDate, endDate));
      if (lastUpdated) where.updatedAt = { gte: new Date(lastUpdated) };

      const { skip, take, page: pageNum, limit: limitNum } = getPaginationParams(page, limit);
      const [totalCount, listings] = await Promise.all([
        prisma.listing.count({ where }),
        prisma.listing.findMany({
          where,
          select: {
            id: true, userId: true, title: true, description: true,
            materialType: true, estimatedWeight: true, price: true, quantity: true,
            pickupAddress: true, images: true, city: true, area: true,
            status: true, createdAt: true, updatedAt: true,
            user: { select: { id: true, name: true, city: true, area: true, role: true, profileImage: true, createdAt: true } },
          },
          orderBy: { createdAt: "desc" },
          skip, take,
        }),
      ]);

      return sendPaginated(res, listings, totalCount, pageNum, limitNum);
    }

    // ── Own Listings View ───────────────────────────────────
    const where = { userId };
    if (materialType) where.materialType = { equals: materialType, mode: "insensitive" };
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { materialType: { contains: search, mode: "insensitive" } },
        { notes: { contains: search, mode: "insensitive" } },
        { pickupAddress: { contains: search, mode: "insensitive" } },
      ];
    }
    Object.assign(where, buildDateFilter(startDate, endDate));
    if (lastUpdated) where.updatedAt = { gte: new Date(lastUpdated) };

    const { skip, take, page: pageNum, limit: limitNum } = getPaginationParams(page, limit);
    const [totalCount, listings] = await Promise.all([
      prisma.listing.count({ where }),
      prisma.listing.findMany({
        where,
        select: {
          id: true, userId: true, title: true, description: true,
          materialType: true, estimatedWeight: true, price: true, quantity: true,
          pickupAddress: true, latitude: true, longitude: true, locationMethod: true,
          notes: true, status: true, createdAt: true, updatedAt: true, images: true,
          orderItems: {
            select: {
              quantity: true,
              order: {
                select: {
                  id: true, status: true,
                  buyer: { select: { id: true, name: true, contactNo: true } },
                  createdAt: true,
                },
              },
            },
            orderBy: { id: "desc" },
          },
        },
        orderBy: { createdAt: "desc" },
        skip, take,
      }),
    ]);

    sendPaginated(res, listings, totalCount, pageNum, limitNum);
  } catch (error) {
    console.error("GET_LISTINGS_ERROR:", error);
    sendError(res, "Failed to fetch listings", error);
  }
};

/**
 * Get publicly visible listings (buyer view).
 * GET /api/listings/public
 */
export const getPublicListings = async (req, res) => {
  try {
    const {
      materialType, city, minPrice, maxPrice,
      sortBy = "createdAt", sortOrder = "desc", page = 1, limit = 10,
    } = req.query;

    const where = { status: ListingStatus.PUBLISHED };
    if (materialType) where.materialType = { equals: materialType, mode: "insensitive" };
    if (city) where.user = { city: { equals: city, mode: "insensitive" } };
    if (minPrice || maxPrice) {
      where.price = {};
      if (minPrice) where.price.gte = parseFloat(minPrice);
      if (maxPrice) where.price.lte = parseFloat(maxPrice);
    }

    const { skip, take, page: pageNum, limit: limitNum } = getPaginationParams(page, Math.min(limit, 50));
    const [totalCount, listings] = await Promise.all([
      prisma.listing.count({ where }),
      prisma.listing.findMany({
        where,
        select: {
          id: true, userId: true, title: true, description: true,
          materialType: true, estimatedWeight: true, price: true, quantity: true,
          pickupAddress: true, latitude: true, longitude: true, locationMethod: true,
          notes: true, images: true, city: true, area: true,
          status: true, createdAt: true, updatedAt: true,
          user: { select: { id: true, name: true, city: true, area: true, profileImage: true } },
        },
        orderBy: { [sortBy]: sortOrder },
        skip, take,
      }),
    ]);

    sendPaginated(res, listings, totalCount, pageNum, limitNum);
  } catch (error) {
    sendError(res, "Failed to fetch public listings", error);
  }
};

/**
 * Get user's selling statistics.
 * GET /api/listings/stats
 */
export const getListingStats = async (req, res) => {
  try {
    const userId = req.user.id;

    const [totalListings, soldOrderItems, pendingCount] = await Promise.all([
      prisma.listing.count({ where: { userId } }),
      prisma.orderItem.findMany({
        where: { order: { sellerId: userId }, listing: { userId } },
        select: { quantity: true, listing: { select: { materialType: true } } },
      }),
      prisma.listing.count({ where: { userId, status: ListingStatus.DRAFT } }),
    ]);

    const totalWeight = soldOrderItems.reduce((sum, item) => sum + item.quantity, 0);
    const byMaterial = soldOrderItems.reduce((acc, item) => {
      const material = item.listing.materialType;
      if (!acc[material]) acc[material] = { count: 0, weight: 0 };
      acc[material].count += 1;
      acc[material].weight += item.quantity;
      return acc;
    }, {});

    Object.keys(byMaterial).forEach((m) => {
      byMaterial[m].weight = parseFloat(byMaterial[m].weight.toFixed(2));
    });

    sendSuccess(res, "Stats fetched successfully", {
      totalListings,
      totalWeight: parseFloat(totalWeight.toFixed(2)),
      pendingCount,
      byMaterial,
    });
  } catch (error) {
    sendError(res, "Failed to fetch statistics", error);
  }
};

/**
 * Export listings as CSV.
 * GET /api/listings/export
 */
export const exportListings = async (req, res) => {
  try {
    const userId = req.user.id;
    const { material, status, startDate, endDate } = req.query;

    const where = {
      userId,
      ...(material && { materialType: material }),
      ...(status && { status }),
      ...buildDateFilter(startDate, endDate),
    };

    const listings = await prisma.listing.findMany({ where, orderBy: { createdAt: "desc" } });

    const csvHeader = "ID,Material Type,Weight (kg),Pickup Address,Status,Buyer Info,Created At\n";
    const csvRows = listings.map((l) => [
      l.id, l.materialType, l.estimatedWeight, `"${l.pickupAddress}"`,
      l.status, `"${l.buyerInfo || "N/A"}"`, new Date(l.createdAt).toISOString(),
    ].join(",")).join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="listings_export.csv"');
    res.send(csvHeader + csvRows);
  } catch (error) {
    sendError(res, "Failed to export listings", error);
  }
};

/**
 * Get single listing details.
 * GET /api/listings/:id
 */
export const getListingById = async (req, res) => {
  try {
    const { id } = req.params;
    const listing = await prisma.listing.findUnique({
      where: { id: parseInt(id) },
      include: {
        user: { select: { id: true, name: true, email: true, contactNo: true, profileImage: true } },
      },
    });

    if (!listing) return sendError(res, "Listing not found", null, 404);
    sendSuccess(res, "Listing details fetched successfully", listing);
  } catch (error) {
    sendError(res, "Failed to fetch listing details", error);
  }
};

/**
 * Update listing details. Only DRAFT/PUBLISHED/PAUSED listings can be updated.
 * PUT /api/listings/:id
 */
export const updateListing = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const updateData = req.body;

    const listing = await prisma.listing.findUnique({ where: { id: parseInt(id) } });
    if (!listing) return sendError(res, "Listing not found", null, 404);
    if (listing.userId !== userId) return sendError(res, "Unauthorized", null, 403);

    if (updateData.estimatedWeight && parseFloat(updateData.estimatedWeight) <= 0) {
      return sendError(res, "Estimated weight must be greater than zero", null, 400);
    }
    if (updateData.price && parseFloat(updateData.price) < 0) {
      return sendError(res, "Price cannot be negative", null, 400);
    }
    if (updateData.quantity && parseFloat(updateData.quantity) <= 0) {
      return sendError(res, "Quantity must be greater than zero", null, 400);
    }

    const editableStatuses = [ListingStatus.DRAFT, ListingStatus.PUBLISHED, ListingStatus.PAUSED];
    if (!editableStatuses.includes(listing.status)) {
      return sendError(res, "Only DRAFT, PUBLISHED, or PAUSED listings can be updated", null, 400);
    }

    const updated = await prisma.listing.update({
      where: { id: parseInt(id) },
      data: { ...updateData, status: listing.status },
    });

    await logActivity({
      userId, role: req.user.role, action: "UPDATE_LISTING",
      resourceType: "listing", resourceId: id, meta: updateData, req,
    });

    invalidateCache("cache:*/listings*").catch(() => {});
    sendSuccess(res, "Listing updated successfully", updated);
  } catch (error) {
    sendError(res, "Failed to update listing", error);
  }
};

/**
 * Publish a DRAFT or PAUSED listing.
 * PUT /api/listings/:id/publish
 */
export const publishListing = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const listing = await prisma.listing.findUnique({ where: { id: parseInt(id) } });
    if (!listing) return sendError(res, "Listing not found", null, 404);
    if (listing.userId !== userId) return sendError(res, "Unauthorized", null, 403);
    if (listing.status !== ListingStatus.DRAFT && listing.status !== ListingStatus.PAUSED) {
      return sendError(res, "Only DRAFT or PAUSED listings can be published", null, 400);
    }

    const updated = await prisma.listing.update({
      where: { id: parseInt(id) },
      data: { status: ListingStatus.PUBLISHED },
    });

    await logActivity({ action: "PUBLISH_LISTING", resourceType: "listing", resourceId: id, req });
    invalidateCache("cache:*/listings*").catch(() => {});
    sendSuccess(res, "Listing published successfully", updated);
  } catch (error) {
    sendError(res, "Failed to publish listing", error);
  }
};

/**
 * Pause a PUBLISHED listing.
 * PUT /api/listings/:id/pause
 */
export const pauseListing = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const listing = await prisma.listing.findUnique({ where: { id: parseInt(id) } });
    if (!listing) return sendError(res, "Listing not found", null, 404);
    if (listing.userId !== userId) return sendError(res, "Unauthorized", null, 403);
    if (listing.status !== ListingStatus.PUBLISHED) {
      return sendError(res, "Only PUBLISHED listings can be paused", null, 400);
    }

    const updated = await prisma.listing.update({
      where: { id: parseInt(id) },
      data: { status: ListingStatus.PAUSED },
    });

    await logActivity({ action: "PAUSE_LISTING", resourceType: "listing", resourceId: id, req });
    invalidateCache("cache:*/listings*").catch(() => {});
    sendSuccess(res, "Listing paused successfully", updated);
  } catch (error) {
    sendError(res, "Failed to pause listing", error);
  }
};

/**
 * Delete a listing.
 * DELETE /api/listings/:id
 */
export const deleteListing = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const listing = await prisma.listing.findFirst({ where: { id: parseInt(id), userId } });
    if (!listing) return sendError(res, "Listing not found", null, 404);

    await prisma.listing.delete({ where: { id: parseInt(id) } });

    await logActivity({ action: "DELETE_LISTING", resourceType: "listing", resourceId: id, req });
    invalidateCache("cache:*/listings*").catch(() => {});
    invalidateCache("cache:*/reports*").catch(() => {});

    sendSuccess(res, "Listing deleted successfully");
  } catch (error) {
    sendError(res, "Failed to delete listing", error);
  }
};
