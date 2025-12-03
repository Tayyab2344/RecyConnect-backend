import bcrypt from 'bcrypt'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

export function generateOtpCode(length = 6) {
  const digits = '0123456789'
  let code = ''
  for (let i = 0; i < length; i++) code += digits[Math.floor(Math.random() * digits.length)]
  return code
}

export async function createOtpForUser(userId, purpose = 'email_verification', email = null, metadata = null) {
  const otp = generateOtpCode()
  const saltRounds = 10
  const hash = await bcrypt.hash(otp, saltRounds)
  const ttl = parseInt(process.env.OTP_TTL_MINUTES || '15')
  const expiresAt = new Date(Date.now() + ttl * 60 * 1000)

  await prisma.otp.create({
    data: {
      userId: userId || undefined,
      email: email || undefined,
      otpHash: hash,
      purpose,
      metadata: metadata || undefined,
      expiresAt
    }
  })

  return otp
}

export async function verifyOtp(emailOrUserId, code, purpose = 'email_verification') {
  let record

  if (typeof emailOrUserId === 'string' && emailOrUserId.includes('@')) {
    // For pending registrations
    record = await prisma.otp.findFirst({
      where: { email: emailOrUserId, purpose, used: false },
      orderBy: { createdAt: 'desc' }
    })
  } else {
    // For existing users
    record = await prisma.otp.findFirst({
      where: { userId: emailOrUserId, purpose, used: false },
      orderBy: { createdAt: 'desc' }
    })
  }

  if (!record) return null
  if (new Date() > record.expiresAt) return null
  const match = await bcrypt.compare(code, record.otpHash)
  if (!match) return null

  await prisma.otp.update({ where: { id: record.id }, data: { used: true } })

  // Return the record (including metadata) instead of just true
  return record
}
