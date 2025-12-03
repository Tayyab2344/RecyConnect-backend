import { PrismaClient } from '@prisma/client';
import cloudinary from '../config/cloudinary.js';
import fs from 'fs/promises';
import { ItemStatus } from '../constants/enums.js';
import { sendSuccess, sendError } from '../utils/responseHelper.js';
import { buildSearchFilter } from '../utils/queryHelper.js';

const prisma = new PrismaClient();

export async function createItem(req, res) {
    try {
        const sellerId = req.user.id;
        const { title, description, price, quantity, category, unit } = req.body;

        const images = [];
        if (req.files) {
            for (const file of req.files) {
                const uploaded = await cloudinary.uploader.upload(file.path, {
                    folder: `recyconnect/items/${sellerId}`,
                });
                images.push(uploaded.secure_url);
                await fs.unlink(file.path);
            }
        }

        const item = await prisma.item.create({
            data: {
                sellerId,
                title,
                description,
                price: parseFloat(price),
                quantity: parseFloat(quantity),
                category,
                unit: unit || 'kg',
                images,
                status: ItemStatus.AVAILABLE
            }
        });

        sendSuccess(res, 'Item created successfully', item, 201);
    } catch (err) {
        sendError(res, 'Failed to create item', err);
    }
}

export async function getItems(req, res) {
    try {
        const { sellerId, category, search } = req.query;
        const where = { status: ItemStatus.AVAILABLE };

        if (sellerId) where.sellerId = parseInt(sellerId);
        if (category) where.category = category;

        if (search) {
            Object.assign(where, buildSearchFilter(search, ['title', 'description']));
        }

        const items = await prisma.item.findMany({
            where,
            include: { seller: { select: { name: true, businessName: true, profileImage: true } } },
            orderBy: { createdAt: 'desc' }
        });

        sendSuccess(res, 'Items fetched', items);
    } catch (err) {
        sendError(res, 'Failed to fetch items', err);
    }
}

export async function getItem(req, res) {
    try {
        const { id } = req.params;
        const item = await prisma.item.findUnique({
            where: { id: parseInt(id) },
            include: { seller: { select: { name: true, businessName: true, profileImage: true } } }
        });

        if (!item) return sendError(res, 'Item not found', null, 404);

        sendSuccess(res, 'Item fetched', item);
    } catch (err) {
        sendError(res, 'Failed to fetch item', err);
    }
}

export async function deleteItem(req, res) {
    try {
        const { id } = req.params;
        const sellerId = req.user.id;

        const item = await prisma.item.findUnique({ where: { id: parseInt(id) } });
        if (!item) return sendError(res, 'Item not found', null, 404);

        if (item.sellerId !== sellerId && req.user.role !== 'admin') {
            return sendError(res, 'Unauthorized', null, 403);
        }

        await prisma.item.update({
            where: { id: parseInt(id) },
            data: { status: ItemStatus.REMOVED }
        });

        sendSuccess(res, 'Item removed successfully');
    } catch (err) {
        sendError(res, 'Failed to delete item', err);
    }
}
