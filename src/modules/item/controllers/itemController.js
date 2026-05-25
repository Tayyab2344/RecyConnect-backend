/**
 * Item Controller
 *
 * Manages personal inventory items — CRUD operations for items
 * that sellers list in their personal catalog.
 *
 * @module modules/item/controllers/itemController
 */

import prisma from "../../../lib/prisma.js";
import { uploadToCloudinary } from "../../../utils/uploadHelper.js";
import { ItemStatus } from "../../../constants/enums.js";
import { sendSuccess, sendError } from "../../../utils/responseHelper.js";
import { buildSearchFilter } from "../../../utils/queryHelper.js";
import { logActivity } from "../../../utils/activityLogger.js";

/**
 * Create a new inventory item with optional image uploads.
 *
 * @param {import('express').Request} req - Express request with body fields and optional files
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>}
 */
export async function createItem(req, res) {
  try {
    const sellerId = req.user.id;
    const { title, description, price, quantity, category, unit } = req.body;

    const images = [];
    if (req.files && Array.isArray(req.files)) {
      for (const file of req.files) {
        const result = await uploadToCloudinary(file, `recyconnect/items/${sellerId}`);
        images.push(result.secure_url);
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
        unit: unit || "kg",
        images,
        status: ItemStatus.AVAILABLE,
      },
    });

    await logActivity({
      userId: sellerId,
      role: req.user.role,
      action: "CREATE_ITEM",
      resourceType: "item",
      resourceId: item.id,
      meta: { title, price, quantity },
      req,
    });

    sendSuccess(res, "Item created successfully", item, 201);
  } catch (err) {
    sendError(res, "Failed to create item", err);
  }
}

/**
 * Fetch all available items with optional seller, category, and search filters.
 *
 * @param {import('express').Request} req - Express request with optional query filters
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>}
 */
export async function getItems(req, res) {
  try {
    const { sellerId, category, search } = req.query;
    const where = { status: ItemStatus.AVAILABLE };

    if (sellerId) where.sellerId = parseInt(sellerId);
    if (category) where.category = category;

    if (search) {
      Object.assign(where, buildSearchFilter(search, ["title", "description"]));
    }

    const items = await prisma.item.findMany({
      where,
      include: {
        seller: { select: { name: true, businessName: true, profileImage: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    sendSuccess(res, "Items fetched", items);
  } catch (err) {
    sendError(res, "Failed to fetch items", err);
  }
}

/**
 * Fetch a single item by its ID.
 *
 * @param {import('express').Request} req - Express request with `params.id`
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>}
 */
export async function getItem(req, res) {
  try {
    const { id } = req.params;
    const item = await prisma.item.findUnique({
      where: { id: parseInt(id) },
      include: {
        seller: { select: { name: true, businessName: true, profileImage: true } },
      },
    });

    if (!item) return sendError(res, "Item not found", null, 404);
    sendSuccess(res, "Item fetched", item);
  } catch (err) {
    sendError(res, "Failed to fetch item", err);
  }
}

/**
 * Soft-delete an item by setting its status to REMOVED.
 * Only the item owner or an admin can perform this action.
 *
 * @param {import('express').Request} req - Express request with `params.id`
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>}
 */
export async function deleteItem(req, res) {
  try {
    const { id } = req.params;
    const sellerId = req.user.id;

    const item = await prisma.item.findUnique({ where: { id: parseInt(id) } });
    if (!item) return sendError(res, "Item not found", null, 404);

    if (item.sellerId !== sellerId && req.user.role !== "admin") {
      return sendError(res, "Unauthorized", null, 403);
    }

    await prisma.item.update({
      where: { id: parseInt(id) },
      data: { status: ItemStatus.REMOVED },
    });

    await logActivity({
      action: "DELETE_ITEM",
      resourceType: "item",
      resourceId: id,
      req,
    });

    sendSuccess(res, "Item removed successfully");
  } catch (err) {
    sendError(res, "Failed to delete item", err);
  }
}
