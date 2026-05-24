import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'
import { sendError } from '../utils/responseHelper.js'

export async function authenticateToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendError(res, 'Missing auth token', null, 401)
    }
    const token = authHeader.split(' ')[1]
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET)
    const user = await prisma.user.findUnique({ where: { id: payload.userId } })
    if (!user) return sendError(res, 'Invalid token', null, 401)
    req.user = {
      id: user.id,
      role: user.role,
      email: user.email,
      collectorId: user.collectorId,
      city: user.city,
      area: user.area,
      assignedWarehouseId: user.assignedWarehouseId,
      createdById: user.createdById
    }
    next()
  } catch (err) {
    return sendError(res, 'Unauthorized', null, 401)
  }
}

export async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next() // Proceed as unauthenticated
    }
    const token = authHeader.split(' ')[1]
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET)
    const user = await prisma.user.findUnique({ where: { id: payload.userId } })
    if (user) {
      req.user = {
        id: user.id,
        role: user.role,
        email: user.email,
        collectorId: user.collectorId,
        city: user.city,
        area: user.area,
        assignedWarehouseId: user.assignedWarehouseId,
        createdById: user.createdById
      }
    }
    next()
  } catch (err) {
    next() // Proceed as unauthenticated on error
  }
}
