import jwt from 'jsonwebtoken'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

export async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: { message: 'Missing auth token' }})
    }
    const token = authHeader.split(' ')[1]
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET)
    const user = await prisma.user.findUnique({ where: { id: payload.userId }})
    if (!user) return res.status(401).json({ success: false, error: { message: 'Invalid token' }})
    req.user = { id: user.id, role: user.role, email: user.email, collectorId: user.collectorId }
    next()
  } catch (err) {
    return res.status(401).json({ success: false, error: { message: 'Unauthorized' }})
  }
}
