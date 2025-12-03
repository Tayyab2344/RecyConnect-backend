
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import dotenv from 'dotenv'
dotenv.config()

const prisma = new PrismaClient()

async function main() {
  const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS || '10')
  const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'admin@123'
  const hashed = await bcrypt.hash(adminPassword, saltRounds)

  await prisma.user.upsert({
    where: { email: 'recyconnect5@gmail.com' },
    update: {
      password: hashed,
      role: 'admin',
      emailVerified: true
    },
    create: {
      name: 'System Admin',
      email: 'recyconnect5@gmail.com',
      password: hashed,
      role: 'admin',
      emailVerified: true
    }
  })

  console.log('Seeded admin user (email: recyconnect5@gmail.com)')
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
