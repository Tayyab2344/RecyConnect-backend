import prisma from '../lib/prisma.js';
import { ItemStatus, TransactionStatus, UserRole } from '../constants/enums.js';
import { sendSuccess, sendPaginated, sendError } from '../utils/responseHelper.js';
import { getPaginationParams, buildDateFilter } from '../utils/queryHelper.js';
import { logActivity } from '../utils/activityLogger.js';

export async function createTransaction(req, res) {
    try {
        const buyerId = req.user.id;
        const { itemId, quantity } = req.body;

        const item = await prisma.item.findUnique({ where: { id: parseInt(itemId) } });
        if (!item) return sendError(res, 'Item not found', null, 404);
        if (item.status !== ItemStatus.AVAILABLE) return sendError(res, 'Item is not available', null, 400);
        if (item.quantity < quantity) return sendError(res, 'Insufficient quantity', null, 400);

        const totalAmount = item.price * quantity;

        const transaction = await prisma.$transaction(async (tx) => {
            const txRecord = await tx.transaction.create({
                data: {
                    buyerId,
                    sellerId: item.sellerId,
                    itemId: parseInt(itemId),
                    quantity: parseFloat(quantity),
                    totalAmount,
                    status: TransactionStatus.PENDING
                }
            });

            // Update item quantity or status
            const newQuantity = item.quantity - quantity;
            await tx.item.update({
                where: { id: item.id },
                data: {
                    quantity: newQuantity,
                    status: newQuantity <= 0 ? ItemStatus.SOLD : ItemStatus.AVAILABLE
                }
            });

            return txRecord;
        });

        await logActivity({
            userId: buyerId,
            role: req.user.role,
            action: "CREATE_TRANSACTION",
            resourceType: "transaction",
            resourceId: transaction.id,
            meta: { itemId, quantity, totalAmount },
            req
        });

        sendSuccess(res, 'Transaction created successfully', transaction, 201);
    } catch (err) {
        sendError(res, 'Failed to create transaction', err);
    }
}

/**
 * Get transactions with pagination, filtering, and field selection
 * GET /api/transactions?page=1&limit=10&status=PENDING&startDate=2026-01-01
 * 
 * Optimized: Added pagination (was returning ALL), added select, added filters
 */
export async function getTransactions(req, res) {
    try {
        const userId = req.user.id;
        const role = req.user.role;
        const {
            status,
            startDate,
            endDate,
            page = 1,
            limit = 10
        } = req.query;

        // Build where clause based on role
        const where = {};
        if (role === UserRole.ADMIN) {
            // Admin sees all
        } else if (role === UserRole.INDIVIDUAL) {
            where.buyerId = userId;
        } else {
            // Warehouse/Company/Seller
            where.sellerId = userId;
        }

        // Apply filters
        if (status) where.status = status;
        Object.assign(where, buildDateFilter(startDate, endDate));

        // Get total count and paginated data in parallel
        const { skip, take, page: pageNum, limit: limitNum } = getPaginationParams(page, limit);

        const [totalCount, transactions] = await Promise.all([
            prisma.transaction.count({ where }),
            prisma.transaction.findMany({
                where,
                select: {
                    id: true,
                    buyerId: true,
                    sellerId: true,
                    itemId: true,
                    quantity: true,
                    totalAmount: true,
                    status: true,
                    createdAt: true,
                    updatedAt: true,
                    item: { select: { title: true, images: true, category: true } },
                    buyer: { select: { id: true, name: true } },
                    seller: { select: { id: true, name: true, businessName: true } }
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take
            })
        ]);

        sendPaginated(res, transactions, totalCount, pageNum, limitNum);
    } catch (err) {
        console.error('GET_TRANSACTIONS_ERROR:', err);
        sendError(res, 'Failed to fetch transactions', err);
    }
}

export async function updateTransactionStatus(req, res) {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const userId = req.user.id;
        const role = req.user.role;

        const transaction = await prisma.transaction.findUnique({ where: { id: parseInt(id) } });
        if (!transaction) return sendError(res, 'Transaction not found', null, 404);

        // Only Admin or Seller can update status
        if (role !== UserRole.ADMIN && transaction.sellerId !== userId) {
            return sendError(res, 'Unauthorized', null, 403);
        }

        const updated = await prisma.transaction.update({
            where: { id: parseInt(id) },
            data: { status }
        });

        await logActivity({
            action: "UPDATE_TRANSACTION_STATUS",
            resourceType: "transaction",
            resourceId: id,
            meta: { status },
            req
        });

        sendSuccess(res, 'Transaction status updated', updated);
    } catch (err) {
        sendError(res, 'Failed to update transaction status', err);
    }
}
