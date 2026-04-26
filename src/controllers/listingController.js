import { ListingStatus } from '../constants/enums.js';
import { buildDateFilter, buildSearchFilter, getPaginationParams } from '../utils/queryHelper.js';
import { sendSuccess, sendPaginated, sendError } from '../utils/responseHelper.js';
import prisma from '../lib/prisma.js';
import { logActivity } from '../utils/activityLogger.js';
import cloudinary from '../config/cloudinary.js';
import { withExponentialBackoff } from '../utils/retryHelper.js';
import { invalidateCache } from '../lib/redis.js';
import { EventBus } from '../events/eventBus.js';

/**
 * Upload a base64 image to Cloudinary
 * @param {string} base64String - Base64 encoded image string
 * @param {string} folder - Cloudinary folder path
 * @returns {Promise<string>} - The secure URL of the uploaded image
 */
const uploadBase64ToCloudinary = async (base64String, folder) => {
  // Add data URI prefix if not present
  const dataUri = base64String.startsWith('data:')
    ? base64String
    : `data:image/jpeg;base64,${base64String}`;

  const result = await withExponentialBackoff(
    () => cloudinary.uploader.upload(dataUri, {
      folder,
      resource_type: 'image',
      transformation: [
        { width: 800, height: 800, crop: 'limit' },
        { quality: 'auto' }
      ]
    }),
    3,
    1500,
    'Cloudinary Image Upload'
  );

  return result.secure_url;
};

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

    // Save as PUBLISHED so it immediately appears in the marketplace
    const status = ListingStatus.PUBLISHED;

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

    if (Array.isArray(images) && images.length > 3) {
      return sendError(res, 'Maximum 3 images allowed per listing', null, 400);
    }

    // Upload base64 images to Cloudinary, keep URLs as-is
    let imageUrls = [];
    for (const img of images) {
      if (img.startsWith('http://') || img.startsWith('https://')) {
        // Already a URL, keep it
        imageUrls.push(img);
      } else {
        // Base64 string — upload to Cloudinary
        try {
          const url = await uploadBase64ToCloudinary(img, `recyconnect/listings/${userId}`);
          imageUrls.push(url);
        } catch (uploadErr) {
          console.error('IMAGE_UPLOAD_ERROR:', uploadErr);
          return sendError(res, 'Failed to upload image', uploadErr, 400);
        }
      }
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
        quantity: parseFloat(quantity) || parseFloat(estimatedWeight),
        pickupAddress,
        latitude: parseFloat(latitude) || null,
        longitude: parseFloat(longitude) || null,
        city: req.user.city || null,
        area: req.user.area || null,
        locationMethod: locationMethod || 'manual',
        notes: notes || null,
        images: imageUrls,
        status,
        metadata: req.body.metadata || null
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

    // Fire detached event bus hook instead of synchronous cache manipulation
    EventBus.emit('listing.created', { listingId: listing.id, category: listing.category });

    invalidateCache('cache:*/listings*').catch(() => {});

    sendSuccess(res, 'Listing published successfully', listing, 201);
  } catch (error) {
    console.error('CREATE_LISTING_ERROR:', error);
    sendError(res, 'Failed to create listing', error);
  }
};

/**
 * Get user's listings history with filters
 * GET /api/listings
 * If view=marketplace, returns other users' PUBLISHED listings filtered by seller role.
 */
export const getListings = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role; // Requester's role
    const {
      materialType,
      status,
      startDate,
      endDate,
      search,
      page = 1,
      limit = 10,
      view,
      lastUpdated
    } = req.query;

    // ── Marketplace View ──────────────────────────────────────────
    if (view === 'marketplace') {
      // Determine which seller roles this user can see
      let allowedSellerRoles;
      const role = (userRole || '').toLowerCase();
      if (role === 'individual') {
        allowedSellerRoles = ['individual', 'warehouse'];
      } else if (role === 'company' || role === 'organization') {
        allowedSellerRoles = ['warehouse'];
      } else {
        // Warehouse or admin sees everyone
        allowedSellerRoles = ['individual', 'warehouse', 'company', 'organization', 'admin'];
      }

      const where = {
        status: 'PUBLISHED',
        userId: { not: userId }, // Never show own listings
        user: {
          role: { in: allowedSellerRoles }
        }
      };

      if (materialType) where.materialType = { equals: materialType, mode: 'insensitive' };
      if (search) {
        where.OR = [
          { title: { contains: search, mode: 'insensitive' } },
          { materialType: { contains: search, mode: 'insensitive' } },
          { notes: { contains: search, mode: 'insensitive' } },
          { pickupAddress: { contains: search, mode: 'insensitive' } }
        ];
      }
      Object.assign(where, buildDateFilter(startDate, endDate));
      
      // Delta Sync Support
      if (lastUpdated) {
        where.updatedAt = { gte: new Date(lastUpdated) };
      }

      const { skip, take, page: pageNum, limit: limitNum } = getPaginationParams(page, limit);

      const [totalCount, listings] = await Promise.all([
        prisma.listing.count({ where }),
        prisma.listing.findMany({
          where,
          select: {
            id: true,
            userId: true,
            title: true,
            description: true,
            materialType: true,
            estimatedWeight: true,
            price: true,
            quantity: true,
            pickupAddress: true,
            images: true,
            city: true,
            area: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            user: {
              select: { id: true, name: true, city: true, area: true, role: true, profileImage: true, createdAt: true }
            }
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take
        })
      ]);

      return sendPaginated(res, listings, totalCount, pageNum, limitNum);
    }

    // ── Own Listings View ─────────────────────────────────────────
    const where = { userId };

    if (materialType) where.materialType = { equals: materialType, mode: 'insensitive' };
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { materialType: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { pickupAddress: { contains: search, mode: 'insensitive' } }
      ];
    }
    Object.assign(where, buildDateFilter(startDate, endDate));
    
    // Delta Sync Support
    if (lastUpdated) {
      where.updatedAt = { gte: new Date(lastUpdated) };
    }

    const { skip, take, page: pageNum, limit: limitNum } = getPaginationParams(page, limit);

    const [totalCount, listings] = await Promise.all([
      prisma.listing.count({ where }),
      prisma.listing.findMany({
        where,
        select: {
          id: true,
          userId: true,
          title: true,
          description: true,
          materialType: true,
          estimatedWeight: true,
          price: true,
          quantity: true,
          pickupAddress: true,
          latitude: true,
          longitude: true,
          locationMethod: true,
          notes: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          images: true
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take
      })
    ]);

    sendPaginated(res, listings, totalCount, pageNum, limitNum);
  } catch (error) {
    console.error('GET_LISTINGS_ERROR:', error);
    sendError(res, 'Failed to fetch listings', error);
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

    const { skip, take, page: pageNum, limit: limitNum } = getPaginationParams(page, Math.min(limit, 50));

    const [totalCount, listings] = await Promise.all([
      prisma.listing.count({ where }),
      prisma.listing.findMany({
        where,
        select: {
          id: true,
          userId: true,
          title: true,
          description: true,
          materialType: true,
          estimatedWeight: true,
          price: true,
          quantity: true,
          pickupAddress: true,
          latitude: true,
          longitude: true,
          locationMethod: true,
          notes: true,
          images: true,
          city: true,
          area: true,
          status: true,
          createdAt: true,
          updatedAt: true,
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
      })
    ]);

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

    // Run all independent queries in parallel
    const [totalListings, weightResult, materialBreakdown, pendingCount] = await Promise.all([
      // Total listings count
      prisma.listing.count({ where: { userId } }),

      // Total weight — use aggregate instead of findMany + reduce
      prisma.listing.aggregate({
        _sum: { estimatedWeight: true },
        where: { userId, status: ListingStatus.SOLD }
      }),

      // Material breakdown — use groupBy instead of findMany + reduce
      prisma.listing.groupBy({
        by: ['materialType'],
        where: { userId, status: ListingStatus.SOLD },
        _count: { id: true },
        _sum: { estimatedWeight: true }
      }),

      // Pending listings count
      prisma.listing.count({
        where: { userId, status: ListingStatus.DRAFT }
      })
    ]);

    const totalWeight = weightResult._sum.estimatedWeight || 0;

    // Transform groupBy result into the expected format
    const byMaterial = materialBreakdown.reduce((acc, item) => {
      acc[item.materialType] = {
        count: item._count.id,
        weight: item._sum.estimatedWeight || 0
      };
      return acc;
    }, {});

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

    invalidateCache('cache:*/listings*').catch(() => {});

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

    invalidateCache('cache:*/listings*').catch(() => {});

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

    invalidateCache('cache:*/listings*').catch(() => {});

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

    // Invalidate listing caches
    invalidateCache('cache:*/listings*').catch(() => {});
    invalidateCache('cache:*/reports*').catch(() => {});

    sendSuccess(res, 'Listing deleted successfully');
  } catch (error) {
    sendError(res, 'Failed to delete listing', error);
  }
};
