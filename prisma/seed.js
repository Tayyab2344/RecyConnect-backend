import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import dotenv from 'dotenv'
dotenv.config()

const prisma = new PrismaClient()

async function main() {
  const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS || '10')
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@recyconnect.com'
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123'

  const hashed = await bcrypt.hash(adminPassword, saltRounds)

  // 1. Create purely Administrative Users (Founders & Fallback)
  console.log('Seeding administrative credentials...')
  const admins = [
    { name: 'Muhammad Umer Liaqat', email: 'umer@recyconnect.com' },
    { name: 'Rana M Tayyab Atiq', email: 'tayyab@recyconnect.com' },
    { name: 'Warda Sohail', email: 'warda@recyconnect.com' },
    { name: 'Super Admin', email: adminEmail }
  ]

  for (const admin of admins) {
    console.log(`Upserting admin: ${admin.name} (${admin.email})...`)
    await prisma.user.upsert({
      where: { email: admin.email },
      update: { password: hashed, role: 'admin', emailVerified: true },
      create: { name: admin.name, email: admin.email, password: hashed, role: 'admin', emailVerified: true }
    })
  }

  console.log('Seed completed successfully (Admin-only).')
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
