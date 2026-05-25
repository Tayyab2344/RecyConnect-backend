/**
 * Admin Report Controller
 *
 * System-wide analytics and reporting — overview stats, material breakdowns,
 * user activity rankings, time-series charts, location analytics, and CSV exports.
 *
 * @module modules/admin/controllers/reportController
 */

import prisma from "../../../lib/prisma.js";
import { ListingStatus, OrderStatus } from "../../../constants/enums.js";
import { sendSuccess, sendError } from "../../../utils/responseHelper.js";

/**
 * Build a Prisma date range filter from optional startDate/endDate strings.
 * @param {string} [startDate]
 * @param {string} [endDate]
 * @returns {object} Prisma where clause fragment
 */
function buildDateRangeFilter(startDate, endDate) {
  if (!startDate && !endDate) return {};
  return {
    createdAt: {
      ...(startDate && { gte: new Date(startDate) }),
      ...(endDate && { lte: new Date(endDate) }),
    },
  };
}

/**
 * GET /api/admin/reports/overview
 * System-wide overview statistics for admin dashboard.
 */
export const getSystemOverview = async (req, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      usersByRole, totalListings, pendingListings, completedListings,
      totalOrders, pendingOrders, completedOrders, totalWeightResult,
      activeUsersFromListings, activeUsersFromOrders,
    ] = await Promise.all([
      prisma.user.groupBy({ by: ["role"], _count: { id: true } }),
      prisma.listing.count(),
      prisma.listing.count({ where: { status: ListingStatus.DRAFT } }),
      prisma.listing.count({ where: { status: ListingStatus.SOLD } }),
      prisma.order.count(),
      prisma.order.count({ where: { status: OrderStatus.PENDING } }),
      prisma.order.count({ where: { status: OrderStatus.COMPLETED } }),
      prisma.orderItem.aggregate({
        _sum: { quantity: true },
        where: { order: { status: OrderStatus.COMPLETED } },
      }),
      prisma.listing.findMany({
        where: { createdAt: { gte: thirtyDaysAgo } },
        select: { userId: true },
        distinct: ["userId"],
      }),
      prisma.order.findMany({
        where: { createdAt: { gte: thirtyDaysAgo } },
        select: { buyerId: true },
        distinct: ["buyerId"],
      }),
    ]);

    const totalWeightRecycled = totalWeightResult._sum.quantity || 0;
    const uniqueActiveUsers = new Set([
      ...activeUsersFromListings.map((l) => l.userId),
      ...activeUsersFromOrders.map((o) => o.buyerId),
    ]);

    sendSuccess(res, "System overview fetched", {
      users: {
        total: usersByRole.reduce((sum, r) => sum + r._count.id, 0),
        byRole: usersByRole.reduce((acc, r) => { acc[r.role] = r._count.id; return acc; }, {}),
        activeInLast30Days: uniqueActiveUsers.size,
      },
      listings: { total: totalListings, pending: pendingListings, completed: completedListings },
      orders: { total: totalOrders, pending: pendingOrders, completed: completedOrders },
      recycling: { totalWeightRecycled: parseFloat(totalWeightRecycled.toFixed(2)), unit: "kg" },
    });
  } catch (error) {
    sendError(res, "Failed to fetch system overview", error);
  }
};

/**
 * GET /api/admin/reports/materials
 * Material-wise breakdown of listings and orders.
 */
export const getMaterialBreakdown = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const dateFilter = buildDateRangeFilter(startDate, endDate);

    const [listings, orders] = await Promise.all([
      prisma.listing.findMany({
        where: dateFilter,
        select: { materialType: true, estimatedWeight: true },
      }),
      prisma.order.findMany({
        where: { ...dateFilter, status: OrderStatus.COMPLETED },
        select: {
          items: {
            select: { quantity: true, listing: { select: { materialType: true } } },
          },
        },
      }),
    ]);

    const listingsByMaterial = listings.reduce((acc, l) => {
      if (!acc[l.materialType]) acc[l.materialType] = { count: 0, weight: 0 };
      acc[l.materialType].count += 1;
      acc[l.materialType].weight += l.estimatedWeight;
      return acc;
    }, {});

    const ordersByMaterial = {};
    orders.forEach((order) => {
      order.items.forEach((item) => {
        const m = item.listing.materialType;
        if (!ordersByMaterial[m]) ordersByMaterial[m] = { count: 0, weight: 0 };
        ordersByMaterial[m].count += 1;
        ordersByMaterial[m].weight += item.quantity;
      });
    });

    sendSuccess(res, "Material breakdown fetched", { listings: listingsByMaterial, orders: ordersByMaterial });
  } catch (error) {
    sendError(res, "Failed to fetch material breakdown", error);
  }
};

/**
 * GET /api/admin/reports/user-activity
 * Top sellers and buyers by completed orders. Batched to avoid N+1.
 */
export const getUserActivity = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const take = Math.min(parseInt(limit) || 10, 50);

    const [sellerStats, buyerStats] = await Promise.all([
      prisma.order.groupBy({
        by: ["sellerId"], where: { status: OrderStatus.COMPLETED },
        _count: { id: true }, orderBy: { _count: { id: "desc" } }, take,
      }),
      prisma.order.groupBy({
        by: ["buyerId"], where: { status: OrderStatus.COMPLETED },
        _count: { id: true }, orderBy: { _count: { id: "desc" } }, take,
      }),
    ]);

    const sellerIds = sellerStats.map((s) => s.sellerId);
    const buyerIds = buyerStats.map((b) => b.buyerId);
    const allUserIds = [...new Set([...sellerIds, ...buyerIds])];

    const users = await prisma.user.findMany({
      where: { id: { in: allUserIds } },
      select: { id: true, name: true, email: true, role: true, businessName: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const [sellerWeights, buyerWeights] = await Promise.all([
      Promise.all(sellerIds.map((id) =>
        prisma.orderItem.aggregate({
          _sum: { quantity: true },
          where: { order: { sellerId: id, status: OrderStatus.COMPLETED } },
        }).then((r) => ({ id, weight: r._sum.quantity || 0 }))
      )),
      Promise.all(buyerIds.map((id) =>
        prisma.orderItem.aggregate({
          _sum: { quantity: true },
          where: { order: { buyerId: id, status: OrderStatus.COMPLETED } },
        }).then((r) => ({ id, weight: r._sum.quantity || 0 }))
      )),
    ]);

    const swMap = new Map(sellerWeights.map((w) => [w.id, w.weight]));
    const bwMap = new Map(buyerWeights.map((w) => [w.id, w.weight]));

    sendSuccess(res, "User activity fetched", {
      topSellers: sellerStats.map((s) => ({
        user: userMap.get(s.sellerId) || null,
        ordersCount: s._count.id,
        totalWeight: parseFloat((swMap.get(s.sellerId) || 0).toFixed(2)),
      })),
      topBuyers: buyerStats.map((b) => ({
        user: userMap.get(b.buyerId) || null,
        ordersCount: b._count.id,
        totalWeight: parseFloat((bwMap.get(b.buyerId) || 0).toFixed(2)),
      })),
    });
  } catch (error) {
    sendError(res, "Failed to fetch user activity", error);
  }
};

/**
 * GET /api/admin/reports/timeseries
 * Time-series data for admin charts grouped by month.
 */
export const getTimeSeries = async (req, res) => {
  try {
    const { months = 6 } = req.query;
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - parseInt(months));

    const [listings, orders] = await Promise.all([
      prisma.listing.findMany({
        where: { createdAt: { gte: startDate } },
        select: { createdAt: true, status: true, estimatedWeight: true },
      }),
      prisma.order.findMany({
        where: { createdAt: { gte: startDate } },
        select: { createdAt: true, status: true, items: { select: { quantity: true } } },
      }),
    ]);

    const listingsByMonth = listings.reduce((acc, l) => {
      const m = new Date(l.createdAt).toISOString().slice(0, 7);
      if (!acc[m]) acc[m] = { total: 0, completed: 0, weight: 0 };
      acc[m].total += 1;
      if (l.status === ListingStatus.SOLD) { acc[m].completed += 1; acc[m].weight += l.estimatedWeight; }
      return acc;
    }, {});

    const ordersByMonth = orders.reduce((acc, o) => {
      const m = new Date(o.createdAt).toISOString().slice(0, 7);
      if (!acc[m]) acc[m] = { total: 0, completed: 0, weight: 0 };
      acc[m].total += 1;
      if (o.status === OrderStatus.COMPLETED) {
        acc[m].completed += 1;
        acc[m].weight += o.items.reduce((s, i) => s + i.quantity, 0);
      }
      return acc;
    }, {});

    sendSuccess(res, "Time series data fetched", { listingsByMonth, ordersByMonth });
  } catch (error) {
    sendError(res, "Failed to fetch time series data", error);
  }
};

/**
 * GET /api/admin/reports/locations
 * Location-based analytics for listings and orders with geo-coordinates.
 */
export const getLocationAnalytics = async (req, res) => {
  try {
    const [listingsWithLocation, orders] = await Promise.all([
      prisma.listing.findMany({
        where: { latitude: { not: null }, longitude: { not: null } },
        select: { latitude: true, longitude: true, materialType: true, status: true, pickupAddress: true },
        take: 1000,
      }),
      prisma.order.findMany({
        select: {
          id: true, status: true,
          items: {
            select: { listing: { select: { latitude: true, longitude: true, materialType: true, pickupAddress: true } } },
            take: 1,
          },
        },
        take: 1000,
      }),
    ]);

    const ordersWithLocation = orders
      .filter((o) => o.items.length > 0 && o.items[0].listing.latitude !== null)
      .map((o) => ({
        id: o.id,
        latitude: o.items[0].listing.latitude,
        longitude: o.items[0].listing.longitude,
        materialType: o.items[0].listing.materialType,
        status: o.status,
        pickupAddress: o.items[0].listing.pickupAddress,
      }));

    sendSuccess(res, "Location analytics fetched", {
      listings: listingsWithLocation,
      orders: ordersWithLocation,
      totalListingsWithLocation: listingsWithLocation.length,
      totalOrdersWithLocation: ordersWithLocation.length,
    });
  } catch (error) {
    sendError(res, "Failed to fetch location analytics", error);
  }
};

/**
 * GET /api/admin/reports/export
 * Export system-wide report as a downloadable CSV file.
 */
export const exportSystemReport = async (req, res) => {
  try {
    const { type = "listings", startDate, endDate } = req.query;
    const dateFilter = buildDateRangeFilter(startDate, endDate);
    let csv = "";

    if (type === "listings") {
      const listings = await prisma.listing.findMany({
        where: dateFilter,
        select: {
          id: true, materialType: true, estimatedWeight: true, status: true, createdAt: true,
          user: { select: { name: true, email: true, role: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      csv = "ID,User Name,User Email,User Role,Material,Weight (kg),Status,Created At\n";
      csv += listings.map((l) => [
        l.id, `"${l.user?.name || "N/A"}"`, `"${l.user?.email || "N/A"}"`,
        l.user?.role || "N/A", l.materialType, l.estimatedWeight, l.status,
        new Date(l.createdAt).toISOString(),
      ].join(",")).join("\n");
    } else if (type === "orders") {
      const orders = await prisma.order.findMany({
        where: dateFilter,
        select: {
          id: true, status: true, createdAt: true,
          buyer: { select: { name: true, email: true } },
          seller: { select: { name: true, email: true } },
          items: { select: { quantity: true, listing: { select: { materialType: true } } } },
        },
        orderBy: { createdAt: "desc" },
      });
      csv = "ID,Buyer Name,Buyer Email,Seller Name,Seller Email,Materials,Total Weight (kg),Status,Created At\n";
      csv += orders.map((o) => {
        const materials = o.items.map((i) => i.listing.materialType).join("; ");
        const totalWeight = o.items.reduce((s, i) => s + i.quantity, 0);
        return [
          o.id, `"${o.buyer?.name || "N/A"}"`, `"${o.buyer?.email || "N/A"}"`,
          `"${o.seller?.name || "N/A"}"`, `"${o.seller?.email || "N/A"}"`,
          `"${materials}"`, totalWeight, o.status, new Date(o.createdAt).toISOString(),
        ].join(",");
      }).join("\n");
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="system_${type}_export.csv"`);
    res.send(csv);
  } catch (error) {
    sendError(res, "Failed to export report", error);
  }
};
