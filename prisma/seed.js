
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import dotenv from 'dotenv'
dotenv.config()

const prisma = new PrismaClient()

async function main() {
  const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS || '10')
  const adminEmail = process.env.ADMIN_EMAIL
  const adminPassword = process.env.ADMIN_PASSWORD

  if (!adminEmail || !adminPassword) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env')
  }

  const hashed = await bcrypt.hash(adminPassword, saltRounds)

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      password: hashed,
      role: 'admin',
      emailVerified: true
    },
    create: {
      name: 'Quantix Admin',
      email: adminEmail,
      password: hashed,
      role: 'admin',
      emailVerified: true
    }
  })


}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
