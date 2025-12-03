import { PrismaClient } from '@prisma/client';
import { ListingStatus } from '../constants/enums.js';
import { buildDateFilter, buildSearchFilter, getPaginationParams } from '../utils/queryHelper.js';
import { sendSuccess, sendPaginated, sendError } from '../utils/responseHelper.js';

const prisma = new PrismaClient();

/**
 * Create a new listing
 * POST /api/listings
 */
export const createListing = async (req, res) => {
  try {
    const {
      materialType,
      estimatedWeight,
      pickupAddress,
      latitude,
      longitude,
      locationMethod,
      notes,
      images
    } = req.body;

    const userId = req.user.id;

    // Validation: at least one image is required
    if (!images || (Array.isArray(images) && images.length === 0)) {
      return sendError(res, 'At least one image is required for the listing', null, 400);
    }

    // Validation: weight must be <= 10kg for individual users
    if (estimatedWeight > 10) {
      return sendError(res, 'Individual users can only list up to 10kg per listing', null, 400);
    }

    // Fetch user's profile to auto-populate location if not provided
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        latitude: true,
        longitude: true,
        address: true,
        city: true,
        area: true,
        locationMethod: true
      }
    });

    // Auto-populate location from user profile if not explicitly provided
    let finalPickupAddress = pickupAddress;
    let finalLatitude = latitude ? parseFloat(latitude) : null;
    let finalLongitude = longitude ? parseFloat(longitude) : null;
    let finalLocationMethod = locationMethod;

    // If no location provided in request, use user's profile location
    if (!pickupAddress && user) {
      if (user.city || user.area || user.address) {
        // Build human-readable address from city and area
        const addressParts = [];
        if (user.address) addressParts.push(user.address);
        if (user.area) addressParts.push(user.area);
        if (user.city) addressParts.push(user.city);
        finalPickupAddress = addressParts.join(', ');
      }

      finalLatitude = finalLatitude ?? user.latitude;
      finalLongitude = finalLongitude ?? user.longitude;
      finalLocationMethod = finalLocationMethod ?? user.locationMethod ?? 'manual';
    }

    // Final validation: location is required (either from request or user profile)
    if (!finalPickupAddress) {
      return sendError(res, 'Pickup address is required. Please update your profile location or provide a pickup address.', null, 400);
    }

    // Create listing
    const listing = await prisma.listing.create({
      data: {
        userId,
        materialType,
        estimatedWeight: parseFloat(estimatedWeight),
        pickupAddress: finalPickupAddress,
        latitude: finalLatitude,
        longitude: finalLongitude,
        locationMethod: finalLocationMethod || 'manual',
        notes: notes || null,
        images: images // Save images to database
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            contactNo: true,
            city: true,
            area: true
          }
        }
      }
    });

    sendSuccess(res, 'Listing created successfully', listing, 201);
  } catch (error) {
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
      material,
      status,
      startDate,
      endDate,
      search,
      page = 1,
      limit = 10,
      view // 'marketplace' or 'my_listings' (default)
    } = req.query;

    // Build filter conditions
    const where = {};

    // Marketplace view: show all OTHER users' listings with status PENDING or ACCEPTED
    // My Listings view: show ONLY my listings
    if (view === 'marketplace') {
      where.userId = { not: userId };
      // Only show available listings in marketplace
      where.status = { in: [ListingStatus.PENDING, ListingStatus.ACCEPTED] };
    } else {
      where.userId = userId;
    }

    // Add other filters
    if (material) where.materialType = { equals: material, mode: 'insensitive' };
    if (status) where.status = status;

    // Use helpers for date and search
    Object.assign(where, buildDateFilter(startDate, endDate));

    if (search) {
      Object.assign(where, buildSearchFilter(search, ['materialType', 'pickupAddress', 'notes']));
    }

    console.log('Fetching listings with filters:', JSON.stringify(where, null, 2));
    console.log('View mode:', view, 'User ID:', userId);

    // Get total count
    const totalCount = await prisma.listing.count({ where });

    // Get paginated listings
    const { skip, take, page: pageNum, limit: limitNum } = getPaginationParams(page, limit);

    const listings = await prisma.listing.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            contactNo: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take
    });

    console.log('Found listings count:', listings.length);
    console.log('Total count from DB:', totalCount);
    if (listings.length > 0) {
      console.log('Sample listing:', JSON.stringify(listings[0], null, 2));
    }

    sendPaginated(res, listings, totalCount, pageNum, limitNum);
  } catch (error) {
    sendError(res, 'Failed to fetch listings', error);
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
 * Update listing status
 * PUT /api/listings/:id
 */
export const updateListingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, buyerInfo } = req.body;
    const userId = req.user.id;

    // Check if listing belongs to the user
    const listing = await prisma.listing.findFirst({
      where: { id: parseInt(id), userId }
    });

    if (!listing) {
      return sendError(res, 'Listing not found', null, 404);
    }

    // Update listing
    const updated = await prisma.listing.update({
      where: { id: parseInt(id) },
      data: {
        status,
        ...(buyerInfo && { buyerInfo })
      }
    });

    sendSuccess(res, 'Listing updated successfully', updated);
  } catch (error) {
    sendError(res, 'Failed to update listing', error);
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

    // Delete listing
    await prisma.listing.delete({
      where: { id: parseInt(id) }
    });

    sendSuccess(res, 'Listing deleted successfully');
  } catch (error) {
    sendError(res, 'Failed to delete listing', error);
  }
};
