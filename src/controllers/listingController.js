import { ListingStatus } from '../constants/enums.js';
import { buildDateFilter, buildSearchFilter, getPaginationParams } from '../utils/queryHelper.js';
import { sendSuccess, sendPaginated, sendError } from '../utils/responseHelper.js';
import prisma from '../lib/prisma.js';
import { logActivity } from '../utils/activityLogger.js';

/**
 * Create a new listing
 * POST /api/listings
 */
export const createListing = async (req, res) => {
  try {
    const {
      materialType,
      category,
      estimatedWeight,
      price,
      quantity,
      pickupAddress,
      latitude,
      longitude,
      locationMethod,
      notes,
      images,
      title,
      description
    } = req.body;

    const userId = req.user.id;

    // Save as DRAFT by default (handled by schema default, but explicit for clarity)
    const status = ListingStatus.DRAFT;

    // Validation
    if (!materialType || !estimatedWeight) {
      return sendError(res, 'Material type and estimated weight are required', null, 400);
    }

    if (parseFloat(estimatedWeight) <= 0) {
      return sendError(res, 'Estimated weight must be greater than zero', null, 400);
    }

    if (price && parseFloat(price) < 0) {
      return sendError(res, 'Price cannot be negative', null, 400);
    }

    if (quantity && parseFloat(quantity) <= 0) {
      return sendError(res, 'Quantity must be greater than zero', null, 400);
    }

    if (!images || (Array.isArray(images) && images.length === 0)) {
      return sendError(res, 'At least one image is required', null, 400);
    }

    const listing = await prisma.listing.create({
      data: {
        userId,
        category: category || materialType,
        title,
        description,
        materialType,
        estimatedWeight: parseFloat(estimatedWeight),
        price: parseFloat(price) || 0,
        quantity: parseFloat(quantity) || 1,
        pickupAddress,
        latitude: parseFloat(latitude) || null,
        longitude: parseFloat(longitude) || null,
        locationMethod: locationMethod || 'manual',
        notes: notes || null,
        images: images,
        status
      }
    });

    await logActivity({
      userId,
      role: req.user.role,
      action: "CREATE_LISTING",
      resourceType: "listing",
      resourceId: listing.id,
      meta: { materialType, price, quantity },
      req
    });

    sendSuccess(res, 'Listing created as DRAFT', listing, 201);
  } catch (error) {
    console.error('CREATE_LISTING_ERROR:', error);
    sendError(res, 'Failed to create listing', error);
  }
};

/**
 * Get user's listings history with filters
 * GET /api/listings
 */
export const getListings = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      materialType,
      status,
      startDate,
      endDate,
      page = 1,
      limit = 10
    } = req.query;

    const where = { userId };

    if (materialType) where.materialType = { equals: materialType, mode: 'insensitive' };
    if (status) where.status = status;
    Object.assign(where, buildDateFilter(startDate, endDate));

    const totalCount = await prisma.listing.count({ where });
    const { skip, take, page: pageNum, limit: limitNum } = getPaginationParams(page, limit);

    const listings = await prisma.listing.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take
    });

    sendPaginated(res, listings, totalCount, pageNum, limitNum);
  } catch (error) {
    console.error('GET_LISTINGS_ERROR:', error);
    sendError(res, 'Failed to fetch your listings', error);
  }
};

/**
 * Get Public Listings (Buyer View)
 * GET /api/listings/public
 */
export const getPublicListings = async (req, res) => {
  try {
    const {
      materialType,
      city,
      minPrice,
      maxPrice,
      sortBy = 'createdAt', // createdAt, price
      sortOrder = 'desc',
      page = 1,
      limit = 10
    } = req.query;

    const where = {
      status: ListingStatus.PUBLISHED,
      // Buyers shouldn't necessarily see their own listings in public view, but let's keep it simple
    };

    if (materialType) where.materialType = { equals: materialType, mode: 'insensitive' };

    if (city) {
      where.user = { city: { equals: city, mode: 'insensitive' } };
    }

    if (minPrice || maxPrice) {
      where.price = {};
      if (minPrice) where.price.gte = parseFloat(minPrice);
      if (maxPrice) where.price.lte = parseFloat(maxPrice);
    }

    const totalCount = await prisma.listing.count({ where });
    const { skip, take, page: pageNum, limit: limitNum } = getPaginationParams(page, Math.min(limit, 50));

    const listings = await prisma.listing.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            city: true,
            area: true,
            profileImage: true
          }
        }
      },
      orderBy: { [sortBy]: sortOrder },
      skip,
      take
    });

    sendPaginated(res, listings, totalCount, pageNum, limitNum);
  } catch (error) {
    sendError(res, 'Failed to fetch public listings', error);
  }
};

/**
 * Get user's selling statistics
 * GET /api/listings/stats
 */
export const getListingStats = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get total listings count
    const totalListings = await prisma.listing.count({
      where: { userId }
    });

    // Get total weight sold (completed listings)
    const completedListings = await prisma.listing.findMany({
      where: {
        userId,
        status: ListingStatus.COMPLETED
      },
      select: {
        estimatedWeight: true,
        materialType: true
      }
    });

    const totalWeight = completedListings.reduce(
      (sum, listing) => sum + listing.estimatedWeight,
      0
    );

    // Breakdown by material type
    const byMaterial = completedListings.reduce((acc, listing) => {
      if (!acc[listing.materialType]) {
        acc[listing.materialType] = { count: 0, weight: 0 };
      }
      acc[listing.materialType].count += 1;
      acc[listing.materialType].weight += listing.estimatedWeight;
      return acc;
    }, {});

    // Get pending listings count
    const pendingCount = await prisma.listing.count({
      where: { userId, status: ListingStatus.PENDING }
    });

    sendSuccess(res, 'Stats fetched successfully', {
      totalListings,
      totalWeight: parseFloat(totalWeight.toFixed(2)),
      pendingCount,
      byMaterial
    });
  } catch (error) {
    sendError(res, 'Failed to fetch statistics', error);
  }
};

/**
 * Export listings as CSV
 * GET /api/listings/export
 */
export const exportListings = async (req, res) => {
  try {
    const userId = req.user.id;
    const { material, status, startDate, endDate } = req.query;

    // Build filter conditions
    const where = {
      userId,
      ...(material && { materialType: material }),
      ...(status && { status }),
      ...buildDateFilter(startDate, endDate)
    };

    const listings = await prisma.listing.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    // Generate CSV
    const csvHeader = 'ID,Material Type,Weight (kg),Pickup Address,Status,Buyer Info,Created At\n';
    const csvRows = listings.map(listing =>
      [
        listing.id,
        listing.materialType,
        listing.estimatedWeight,
        `"${listing.pickupAddress}"`,
        listing.status,
        `"${listing.buyerInfo || 'N/A'}"`,
        new Date(listing.createdAt).toISOString()
      ].join(',')
    ).join('\n');

    const csv = csvHeader + csvRows;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="listings_export.csv"');
    res.send(csv);
  } catch (error) {
    sendError(res, 'Failed to export listings', error);
  }
};

/**
 * Get single listing details
 * GET /api/listings/:id
 */
export const getListingById = async (req, res) => {
  try {
    const { id } = req.params;

    const listing = await prisma.listing.findUnique({
      where: { id: parseInt(id) },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            contactNo: true,
            profileImage: true
          }
        }
      }
    });

    if (!listing) {
      return sendError(res, 'Listing not found', null, 404);
    }

    sendSuccess(res, 'Listing details fetched successfully', listing);
  } catch (error) {
    sendError(res, 'Failed to fetch listing details', error);
  }
};

/**
 * Update listing details
 * PUT /api/listings/:id
 * Only allowed for DRAFT listings
 */
export const updateListing = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const updateData = req.body;

    const listing = await prisma.listing.findUnique({
      where: { id: parseInt(id) }
    });

    if (!listing) return sendError(res, 'Listing not found', null, 404);
    if (listing.userId !== userId) return sendError(res, 'Unauthorized', null, 403);

    // Validation for updates
    if (updateData.estimatedWeight && parseFloat(updateData.estimatedWeight) <= 0) {
      return sendError(res, 'Estimated weight must be greater than zero', null, 400);
    }
    if (updateData.price && parseFloat(updateData.price) < 0) {
      return sendError(res, 'Price cannot be negative', null, 400);
    }
    if (updateData.quantity && parseFloat(updateData.quantity) <= 0) {
      return sendError(res, 'Quantity must be greater than zero', null, 400);
    }

    // Allow update only if status = DRAFT
    if (listing.status !== ListingStatus.DRAFT) {
      return sendError(res, 'Only DRAFT listings can be updated', null, 400);
    }

    // Perform update
    const updated = await prisma.listing.update({
      where: { id: parseInt(id) },
      data: {
        ...updateData,
        // Ensure some fields aren't accidentally changed here if we want stricter control
        status: ListingStatus.DRAFT // Keep it as draft
      }
    });

    await logActivity({
      userId,
      role: req.user.role,
      action: "UPDATE_LISTING",
      resourceType: "listing",
      resourceId: id,
      meta: updateData,
      req
    });

    sendSuccess(res, 'Listing updated successfully', updated);
  } catch (error) {
    sendError(res, 'Failed to update listing', error);
  }
};

/**
 * Publish Listing
 * PUT /api/listings/:id/publish
 */
export const publishListing = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const listing = await prisma.listing.findUnique({
      where: { id: parseInt(id) }
    });

    if (!listing) return sendError(res, 'Listing not found', null, 404);
    if (listing.userId !== userId) return sendError(res, 'Unauthorized', null, 403);

    if (listing.status !== ListingStatus.DRAFT && listing.status !== ListingStatus.PAUSED) {
      return sendError(res, 'Only DRAFT or PAUSED listings can be published', null, 400);
    }

    const updated = await prisma.listing.update({
      where: { id: parseInt(id) },
      data: { status: ListingStatus.PUBLISHED }
    });

    await logActivity({
      action: "PUBLISH_LISTING",
      resourceType: "listing",
      resourceId: id,
      req
    });

    sendSuccess(res, 'Listing published successfully', updated);
  } catch (error) {
    sendError(res, 'Failed to publish listing', error);
  }
};

/**
 * Pause Listing
 * PUT /api/listings/:id/pause
 */
export const pauseListing = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const listing = await prisma.listing.findUnique({
      where: { id: parseInt(id) }
    });

    if (!listing) return sendError(res, 'Listing not found', null, 404);
    if (listing.userId !== userId) return sendError(res, 'Unauthorized', null, 403);

    if (listing.status !== ListingStatus.PUBLISHED) {
      return sendError(res, 'Only PUBLISHED listings can be paused', null, 400);
    }

    const updated = await prisma.listing.update({
      where: { id: parseInt(id) },
      data: { status: ListingStatus.PAUSED }
    });

    await logActivity({
      action: "PAUSE_LISTING",
      resourceType: "listing",
      resourceId: id,
      req
    });

    sendSuccess(res, 'Listing paused successfully', updated);
  } catch (error) {
    sendError(res, 'Failed to pause listing', error);
  }
};

/**
 * Delete listing
 * DELETE /api/listings/:id
 */
export const deleteListing = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Check if listing belongs to the user
    const listing = await prisma.listing.findFirst({
      where: { id: parseInt(id), userId }
    });

    if (!listing) {
      return sendError(res, 'Listing not found', null, 404);
    }

    // Optionally allow deletion only if DRAFT? The requirements didn't specify.
    // Let's allow deletion anytime for now, or just DRAFT/PAUSED.

    await prisma.listing.delete({
      where: { id: parseInt(id) }
    });

    await logActivity({
      action: "DELETE_LISTING",
      resourceType: "listing",
      resourceId: id,
      req
    });

    sendSuccess(res, 'Listing deleted successfully');
  } catch (error) {
    sendError(res, 'Failed to delete listing', error);
  }
};
