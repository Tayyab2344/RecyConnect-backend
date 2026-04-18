import prisma from '../lib/prisma.js';
import { sendSuccess, sendError } from '../utils/responseHelper.js';
import { buildFieldSelect } from '../utils/queryHelper.js';
import { LISTING_FIELDS, ORDER_FIELDS } from '../middlewares/fieldSelectMiddleware.js';

const MAX_BATCH_SIZE = 50;

/**
 * Batch fetch listings by IDs
 * POST /api/batch/listings
 * Body: { ids: [1, 2, 3] }
 * Query: ?fields=id,status,title
 */
export const batchGetListings = async (req, res) => {
    try {
        const { ids } = req.body;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return sendError(res, 'ids array is required', null, 400);
        }

        if (ids.length > MAX_BATCH_SIZE) {
            return sendError(res, `Maximum ${MAX_BATCH_SIZE} IDs per batch request`, null, 400);
        }

        const parsedIds = ids.map(id => parseInt(id)).filter(id => !isNaN(id));

        if (parsedIds.length === 0) {
            return sendError(res, 'No valid IDs provided', null, 400);
        }

        // Build field selection
        const select = req.prismaSelect || buildFieldSelect(req.query.fields, LISTING_FIELDS);

        const queryOptions = {
            where: { id: { in: parsedIds } },
        };

        if (select) {
            queryOptions.select = select;
        } else {
            // Default: include user info when no field selection
            queryOptions.include = {
                user: {
                    select: { id: true, name: true, city: true, area: true, role: true, profileImage: true }
                }
            };
        }

        const listings = await prisma.listing.findMany(queryOptions);

        sendSuccess(res, `Fetched ${listings.length} listings`, {
            items: listings,
            requestedCount: parsedIds.length,
            foundCount: listings.length
        });
    } catch (error) {
        sendError(res, 'Failed to batch fetch listings', error);
    }
};

/**
 * Batch fetch orders by IDs
 * POST /api/batch/orders
 * Body: { ids: [1, 2, 3] }
 * Query: ?fields=id,status,totalAmount
 */
export const batchGetOrders = async (req, res) => {
    try {
        const userId = req.user.id;
        const { ids } = req.body;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return sendError(res, 'ids array is required', null, 400);
        }

        if (ids.length > MAX_BATCH_SIZE) {
            return sendError(res, `Maximum ${MAX_BATCH_SIZE} IDs per batch request`, null, 400);
        }

        const parsedIds = ids.map(id => parseInt(id)).filter(id => !isNaN(id));

        if (parsedIds.length === 0) {
            return sendError(res, 'No valid IDs provided', null, 400);
        }

        const select = req.prismaSelect || buildFieldSelect(req.query.fields, ORDER_FIELDS);

        const queryOptions = {
            where: {
                id: { in: parsedIds },
                // Only return orders the user is involved in (buyer or seller)
                OR: [
                    { buyerId: userId },
                    { sellerId: userId }
                ]
            },
        };

        if (select) {
            queryOptions.select = select;
        } else {
            queryOptions.include = {
                buyer: { select: { id: true, name: true, email: true, contactNo: true } },
                seller: { select: { id: true, name: true, email: true, contactNo: true, address: true } },
                items: {
                    include: {
                        listing: { select: { id: true, title: true, materialType: true, images: true } }
                    }
                },
                reservation: true
            };
        }

        const orders = await prisma.order.findMany(queryOptions);

        sendSuccess(res, `Fetched ${orders.length} orders`, {
            items: orders,
            requestedCount: parsedIds.length,
            foundCount: orders.length
        });
    } catch (error) {
        sendError(res, 'Failed to batch fetch orders', error);
    }
};

/**
 * Batch fetch users by IDs (admin only or limited fields for public)
 * POST /api/batch/users
 * Body: { ids: [1, 2, 3] }
 */
export const batchGetUsers = async (req, res) => {
    try {
        const { ids } = req.body;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return sendError(res, 'ids array is required', null, 400);
        }

        if (ids.length > MAX_BATCH_SIZE) {
            return sendError(res, `Maximum ${MAX_BATCH_SIZE} IDs per batch request`, null, 400);
        }

        const parsedIds = ids.map(id => parseInt(id)).filter(id => !isNaN(id));

        if (parsedIds.length === 0) {
            return sendError(res, 'No valid IDs provided', null, 400);
        }

        // Always use limited fields for user batch to prevent data leaks
        const users = await prisma.user.findMany({
            where: { id: { in: parsedIds } },
            select: {
                id: true,
                name: true,
                role: true,
                businessName: true,
                profileImage: true,
                city: true,
                area: true,
                createdAt: true
            }
        });

        sendSuccess(res, `Fetched ${users.length} users`, {
            items: users,
            requestedCount: parsedIds.length,
            foundCount: users.length
        });
    } catch (error) {
        sendError(res, 'Failed to batch fetch users', error);
    }
};
