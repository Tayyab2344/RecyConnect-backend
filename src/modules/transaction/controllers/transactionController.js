import prisma from '../../../lib/prisma.js';
import { ItemStatus, TransactionStatus, UserRole } from '../../../constants/enums.js';
import { sendSuccess, sendPaginated, sendError } from '../../../utils/responseHelper.js';
import { getPaginationParams, buildDateFilter } from '../../../utils/queryHelper.js';
import { logActivity } from '../../../utils/activityLogger.js';

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

        // Build where clause for Transactions
        const txWhere = {};
        if (role !== UserRole.ADMIN) {
            txWhere.OR = [{ buyerId: userId }, { sellerId: userId }];
        }
        if (status) txWhere.status = status;
        Object.assign(txWhere, buildDateFilter(startDate, endDate));

        // Build where clause for Orders (exclude drafts/cancelled)
        const orderWhere = {};
        if (role !== UserRole.ADMIN) {
            orderWhere.OR = [{ buyerId: userId }, { sellerId: userId }];
        }
        orderWhere.status = { notIn: ['CANCELLED', 'BUYER_CANCELLED', 'WAREHOUSE_REJECTED'] };
        if (status) {
            if (status === 'COMPLETED') {
                orderWhere.status = 'COMPLETED';
            } else if (status === 'PENDING') {
                orderWhere.status = { notIn: ['COMPLETED', 'CANCELLED', 'BUYER_CANCELLED', 'WAREHOUSE_REJECTED'] };
            }
        }
        Object.assign(orderWhere, buildDateFilter(startDate, endDate));

        // Fetch in parallel
        const [dbTransactions, dbOrders] = await Promise.all([
            prisma.transaction.findMany({
                where: txWhere,
                include: {
                    item: { select: { title: true, category: true } },
                    buyer: { select: { name: true } },
                    seller: { select: { name: true, businessName: true } }
                }
            }),
            prisma.order.findMany({
                where: orderWhere,
                include: {
                    items: {
                        include: {
                            listing: { select: { title: true, materialType: true } }
                        }
                    },
                    buyer: { select: { name: true } },
                    seller: { select: { name: true, businessName: true } }
                }
            })
        ]);

        const formattedTx = dbTransactions.map(tx => {
            const isCredit = tx.sellerId === userId;
            const itemCategory = tx.item?.category || 'Recyclables';
            const counterParty = isCredit
                ? (tx.buyer?.name || 'Buyer')
                : (tx.seller?.businessName || tx.seller?.name || 'Seller');

            return {
                id: `TXN-${tx.id}`,
                description: isCredit ? `Sold ${itemCategory} to ${counterParty}` : `Purchased ${itemCategory} from ${counterParty}`,
                amount: tx.totalAmount,
                type: isCredit ? 'CREDIT' : 'DEBIT',
                status: tx.status === 'COMPLETED' ? 'Completed' : 'Pending',
                createdAt: tx.createdAt,
                updatedAt: tx.updatedAt
            };
        });

        const formattedOrders = dbOrders.map(order => {
            const isCredit = order.sellerId === userId;
            const listingTitle = order.items?.[0]?.listing?.title || order.items?.[0]?.listing?.materialType || 'Material';
            const counterParty = isCredit
                ? (order.buyer?.name || 'Buyer')
                : (order.seller?.businessName || order.seller?.name || 'Seller');

            return {
                id: `ORD-${order.id}`,
                description: isCredit ? `Sold ${listingTitle} to ${counterParty}` : `Purchased ${listingTitle} from ${counterParty}`,
                amount: order.totalAmount,
                type: isCredit ? 'CREDIT' : 'DEBIT',
                status: order.status === 'COMPLETED' ? 'Completed' : 'Pending',
                createdAt: order.createdAt,
                updatedAt: order.updatedAt
            };
        });

        // Merge, sort, and slice for manual pagination
        const merged = [...formattedTx, ...formattedOrders];
        merged.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        const totalCount = merged.length;
        const { skip, take, page: pageNum, limit: limitNum } = getPaginationParams(page, limit);
        const paginated = merged.slice(skip, skip + take);

        sendPaginated(res, paginated, totalCount, pageNum, limitNum);
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
