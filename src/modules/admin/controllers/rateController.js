/**
 * Admin Rate Controller
 *
 * Manages recycling rate cards — CRUD operations for material pricing
 * used across the marketplace.
 *
 * @module modules/admin/controllers/rateController
 */

import { sendSuccess, sendError } from "../../../utils/responseHelper.js";
import prisma from "../../../lib/prisma.js";
import { logActivity } from "../../../utils/activityLogger.js";

/** Default seed data for rate categories */
const DEFAULT_RATES = [
  { category: "Plastic", pricePerUnit: 20, unit: "kg" },
  { category: "Metal", pricePerUnit: 40, unit: "kg" },
  { category: "E-Waste", pricePerUnit: 100, unit: "kg" },
  { category: "Paper", pricePerUnit: 15, unit: "kg" },
];

/**
 * Fetch all recycling rates. Auto-seeds defaults if the table is empty.
 *
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>}
 */
export async function getRates(req, res) {
  try {
    let rates = await prisma.rate.findMany({ orderBy: { category: "asc" } });

    // Auto-seed default categories if empty
    if (rates.length === 0) {
      await prisma.rate.createMany({
        data: DEFAULT_RATES,
        skipDuplicates: true,
      });
      rates = await prisma.rate.findMany({ orderBy: { category: "asc" } });
    }

    sendSuccess(res, "Rates fetched", rates);
  } catch (err) {
    sendError(res, "Failed to fetch rates", err);
  }
}

/**
 * Create or update a recycling rate for a material category.
 *
 * @param {import('express').Request} req - Express request with `body.category`, `body.pricePerUnit`, `body.unit`
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>}
 */
export async function updateRates(req, res) {
  try {
    const { category, pricePerUnit, unit = "kg" } = req.body;

    const rate = await prisma.rate.upsert({
      where: { category },
      update: { pricePerUnit: parseFloat(pricePerUnit), unit },
      create: { category, pricePerUnit: parseFloat(pricePerUnit), unit },
    });

    await logActivity({
      action: "UPDATE_RATES",
      resourceType: "rate",
      resourceId: category,
      meta: { pricePerUnit, unit },
      req,
    });

    sendSuccess(res, "Rates updated", rate);
  } catch (err) {
    sendError(res, "Failed to update rates", err);
  }
}

/**
 * Delete a recycling rate by category name.
 *
 * @param {import('express').Request} req - Express request with `params.category`
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>}
 */
export async function deleteRate(req, res) {
  try {
    const { category } = req.params;

    const existing = await prisma.rate.findUnique({ where: { category } });
    if (!existing) return sendError(res, "Rate not found", null, 404);

    await prisma.rate.delete({ where: { category } });

    await logActivity({
      action: "DELETE_RATE",
      resourceType: "rate",
      resourceId: category,
      meta: { deletedRate: existing },
      req,
    });

    sendSuccess(res, "Rate deleted successfully");
  } catch (err) {
    sendError(res, "Failed to delete rate", err);
  }
}
