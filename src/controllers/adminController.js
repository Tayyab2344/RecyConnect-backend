import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export async function getLogs(req, res, next) {
  try {
    const {
      q,
      action,
      role,
      userId,
      resourceType,
      from,
      to,
      page = 1,
      limit = 20,
    } = req.query;
    const where = {};
    if (action) where.action = action;
    if (role) where.actorRole = role;
    if (userId) where.userId = parseInt(userId);
    if (resourceType) where.resourceType = resourceType;
    if (from || to) where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
    if (q) {
      where.OR = [
        { meta: { path: ["message"], equals: q } }, // placeholder
      ];
    }
    const take = Math.min(100, parseInt(limit));
    const skip = (parseInt(page) - 1) * take;
    const [data, total] = await Promise.all([
      prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      prisma.activityLog.count({ where }),
    ]);
    return res.json({
      success: true,
      data: { items: data, total, page: parseInt(page), limit: take },
    });
  } catch (err) {
    next(err);
  }
}

export async function getLogById(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    const log = await prisma.activityLog.findUnique({ where: { id } });
    if (!log)
      return res
        .status(404)
        .json({ success: false, error: { message: "Log not found" } });
    return res.json({ success: true, data: log });
  } catch (err) {
    next(err);
  }
}
