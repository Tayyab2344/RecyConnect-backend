
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import dotenv from 'dotenv'
dotenv.config()

const prisma = new PrismaClient()

async function main() {
  const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS || '10')
  // Strong password: Qx$9mP#kL2vR@nT7wZ!4
  const adminPassword = 'Qx$9mP#kL2vR@nT7wZ!4'
  const hashed = await bcrypt.hash(adminPassword, saltRounds)

  await prisma.user.upsert({
    where: { email: 'panel.quantix@gmail.com' },
    update: {
      password: hashed,
      role: 'admin',
      emailVerified: true
    },
    create: {
      name: 'Quantix Admin',
      email: 'panel.quantix@gmail.com',
      password: hashed,
      role: 'admin',
      emailVerified: true
    }
  })

  console.log('Seeded admin user (email: panel.quantix@gmail.com, password: Qx$9mP#kL2vR@nT7wZ!4)')
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
