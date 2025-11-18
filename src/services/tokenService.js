import jwt from 'jsonwebtoken'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
const prisma = new PrismaClient()

export function signAccessToken(user) {
  const payload = { userId: user.id, role: user.role }
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET, { expiresIn: process.env.ACCESS_TOKEN_TTL || '15m' })
}

export function signRefreshToken(user) {
  const payload = { userId: user.id }
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.REFRESH_TOKEN_TTL || '30d' })
}

export async function saveRefreshToken(userId, token) {
  const hash = await bcrypt.hash(token, 10)
  const decoded = jwt.decode(token)
  const expiresAt = new Date(decoded.exp * 1000)
  return prisma.refreshToken.create({ data: { userId, tokenHash: hash, expiresAt } })
}

export async function revokeRefreshTokens(userId) {
  return prisma.refreshToken.updateMany({ where: { userId }, data: { revoked: true } })
}

export async function validateRefreshToken(token) {
  const payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET)
  return payload
}
