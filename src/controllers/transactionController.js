import { PrismaClient } from '@prisma/client';
import { ItemStatus, TransactionStatus, UserRole } from '../constants/enums.js';
import { sendSuccess, sendError } from '../utils/responseHelper.js';

const prisma = new PrismaClient();

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

        sendSuccess(res, 'Transaction created successfully', transaction, 201);
    } catch (err) {
        sendError(res, 'Failed to create transaction', err);
    }
}

export async function getTransactions(req, res) {
    try {
        const userId = req.user.id;
        const role = req.user.role;

        const where = {};
        if (role === UserRole.ADMIN) {
            // Admin sees all
        } else if (role === UserRole.INDIVIDUAL) { // Assuming 'buyer' is 'individual' in role enum
            where.buyerId = userId;
        } else {
            // Warehouse/Company/Seller
            where.sellerId = userId;
        }

        const transactions = await prisma.transaction.findMany({
            where,
            include: {
                item: { select: { title: true, images: true } },
                buyer: { select: { name: true } },
                seller: { select: { name: true, businessName: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        sendSuccess(res, 'Transactions fetched', transactions);
    } catch (err) {
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

        sendSuccess(res, 'Transaction status updated', updated);
    } catch (err) {
        sendError(res, 'Failed to update transaction status', err);
    }
}
