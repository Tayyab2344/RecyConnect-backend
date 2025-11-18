import { PrismaClient } from '@prisma/client'
import { logger } from '../utils/logger.js'
const prisma = new PrismaClient()

function generateCollectorId() {
  const n = Math.floor(1000 + Math.random() * 9000)
  return `COL-${n}`
}

export async function addCollector(req, res, next) {
  try {
    const warehouseId = req.user.id
    const { name } = req.body
    let id
    do {
      id = generateCollectorId()
    } while (await prisma.user.findUnique({ where: { collectorId: id } }))
    const created = await prisma.user.create({
      data: { collectorId: id, role: 'collector', name: name || null, createdById: warehouseId }
    })
    await prisma.activityLog.create({ data: { userId: warehouseId, actorRole: 'warehouse', action: 'COLLECTOR_ID_CREATED', resourceType: 'collector', resourceId: id, meta: { name } } })
    return res.status(201).json({ success: true, message: 'Collector ID created', collectorId: id })
  } catch (err) {
    next(err)
  }
}
