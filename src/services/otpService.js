import bcrypt from 'bcrypt'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

export function generateOtpCode(length = 6) {
  const digits = '0123456789'
  let code = ''
  for (let i = 0; i < length; i++) code += digits[Math.floor(Math.random() * digits.length)]
  return code
}

export async function createOtpForUser(emailOrUserId, purpose = 'email_verification') {
  const otp = generateOtpCode()
  const saltRounds = 10
  const hash = await bcrypt.hash(otp, saltRounds)
  const ttl = parseInt(process.env.OTP_TTL_MINUTES || '15')
  const expiresAt = new Date(Date.now() + ttl * 60 * 1000)
  
  // For pending registrations, use email as identifier
  if (typeof emailOrUserId === 'string' && emailOrUserId.includes('@')) {
    await prisma.otp.create({ 
      data: { 
        email: emailOrUserId, 
        otpHash: hash, 
        purpose, 
        expiresAt 
      } 
    })
  } else {
    // For existing users, use userId
    await prisma.otp.create({ 
      data: { 
        userId: emailOrUserId, 
        otpHash: hash, 
        purpose, 
        expiresAt 
      } 
    })
  }
  
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
  
  if (!record) return false
  if (new Date() > record.expiresAt) return false
  const match = await bcrypt.compare(code, record.otpHash)
  if (!match) return false
  await prisma.otp.update({ where: { id: record.id }, data: { used: true } })
  return true
}
