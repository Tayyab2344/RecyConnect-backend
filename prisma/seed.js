
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

  // 1. Create Users
  console.log('Seeding users...')
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { password: hashed, role: 'admin', emailVerified: true },
    create: { name: 'Super Admin', email: adminEmail, password: hashed, role: 'admin', emailVerified: true }
  })

  const seller1 = await prisma.user.upsert({
    where: { email: 'seller1@example.com' },
    update: {},
    create: { name: 'John Seller', email: 'seller1@example.com', password: hashed, role: 'seller', emailVerified: true, city: 'Islamabad' }
  })

  const buyer1 = await prisma.user.upsert({
    where: { email: 'buyer1@example.com' },
    update: {},
    create: { name: 'Eco Warehouse', email: 'buyer1@example.com', password: hashed, role: 'warehouse', emailVerified: true, city: 'Rawalpindi', businessName: 'EcoRecycle Ltd' }
  })

  // 2. Create Listings
  console.log('Seeding listings...')
  const listing1 = await prisma.listing.create({
    data: {
      userId: seller1.id,
      category: 'Plastic',
      materialType: 'PET Bottles',
      estimatedWeight: 5.5,
      price: 150,
      quantity: 10,
      status: 'PUBLISHED',
      pickupAddress: 'Sector F-7, Islamabad',
      title: 'Bulk PET Bottles',
      description: 'Clean PET bottles for recycling'
    }
  })

  const listing2 = await prisma.listing.create({
    data: {
      userId: seller1.id,
      category: 'Metal',
      materialType: 'Aluminum Cans',
      estimatedWeight: 2.0,
      price: 300,
      quantity: 5,
      status: 'RESERVED',
      pickupAddress: 'Sector G-9, Islamabad'
    }
  })

  const listing3 = await prisma.listing.create({
    data: {
      userId: seller1.id,
      category: 'Paper',
      materialType: 'Cardboard',
      estimatedWeight: 10.0,
      price: 50,
      quantity: 100,
      status: 'DRAFT',
      pickupAddress: 'Sector H-8, Islamabad'
    }
  })

  // 3. Create an Order
  console.log('Seeding orders...')
  const order1 = await prisma.order.create({
    data: {
      buyerId: buyer1.id,
      sellerId: seller1.id,
      status: 'PENDING',
      totalAmount: 825.0, // 5.5 * 150 (hypothetically)
      items: {
        create: [
          {
            listingId: listing1.id,
            quantity: 5.5,
            price: 150
          }
        ]
      },
      payment: {
        create: {
          amount: 825.0,
          paymentMethod: 'COD',
          status: 'PENDING'
        }
      }
    }
  })

  // 4. Create a Reservation referencing the order
  console.log('Seeding reservations...')
  await prisma.listingReservation.create({
    data: {
      listingId: listing1.id,
      buyerId: buyer1.id,
      orderId: order1.id,
      quantity: 5.5,
      status: 'CONFIRMED',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days from now
    }
  })

  console.log('Seed completed successfully!')
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
