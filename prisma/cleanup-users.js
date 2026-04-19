import { PrismaClient } from '@prisma/client'
import dotenv from 'dotenv'
dotenv.config()

const prisma = new PrismaClient()

async function main() {
  console.log('🧹 Starting cleanup — removing all non-admin users...\n')

  // Find all non-admin users
  const nonAdminUsers = await prisma.user.findMany({
    where: { role: { not: 'admin' } },
    select: { id: true, name: true, role: true, email: true }
  })

  console.log(`Found ${nonAdminUsers.length} non-admin user(s) to remove:`)
  nonAdminUsers.forEach(u => console.log(`  - [${u.role}] ${u.name || 'N/A'} (${u.email || 'no email'}) id=${u.id}`))

  if (nonAdminUsers.length === 0) {
    console.log('\n✅ Database is already clean. Only admin exists.')
    return
  }

  const userIds = nonAdminUsers.map(u => u.id)

  // Delete in correct order to respect foreign key constraints
  console.log('\nDeleting related records...')

  // Messages & Conversations
  const convos = await prisma.conversation.findMany({
    where: { OR: [{ participant1Id: { in: userIds } }, { participant2Id: { in: userIds } }] },
    select: { id: true }
  })
  const convoIds = convos.map(c => c.id)
  if (convoIds.length > 0) {
    await prisma.message.deleteMany({ where: { conversationId: { in: convoIds } } })
    await prisma.conversation.deleteMany({ where: { id: { in: convoIds } } })
    console.log(`  ✓ Conversations & messages deleted`)
  }

  // Inventory movements
  await prisma.inventoryMovement.deleteMany({ where: { performedBy: { in: userIds } } })
  console.log('  ✓ Inventory movements deleted')

  // Warehouse inventory
  await prisma.warehouseInventory.deleteMany({
    where: { OR: [{ warehouseId: { in: userIds } }, { supplierId: { in: userIds } }] }
  })
  console.log('  ✓ Warehouse inventory deleted')

  // Financial transactions
  await prisma.financialTransaction.deleteMany({ where: { warehouseId: { in: userIds } } })
  console.log('  ✓ Financial transactions deleted')

  // Expenses
  await prisma.expense.deleteMany({ where: { warehouseId: { in: userIds } } })
  console.log('  ✓ Expenses deleted')

  // Transactions (buyer/seller)
  await prisma.transaction.deleteMany({
    where: { OR: [{ buyerId: { in: userIds } }, { sellerId: { in: userIds } }] }
  })
  console.log('  ✓ Transactions deleted')

  // Orders chain: Payment -> OrderItem -> Reservation -> Order
  const orders = await prisma.order.findMany({
    where: { OR: [{ buyerId: { in: userIds } }, { sellerId: { in: userIds } }] },
    select: { id: true }
  })
  const orderIds = orders.map(o => o.id)
  if (orderIds.length > 0) {
    await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } })
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } })
    await prisma.listingReservation.deleteMany({ where: { orderId: { in: orderIds } } })
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } })
    console.log('  ✓ Orders, payments, order items, reservations deleted')
  }

  // Remaining reservations
  await prisma.listingReservation.deleteMany({ where: { buyerId: { in: userIds } } })
  console.log('  ✓ Remaining reservations deleted')

  // Listings
  await prisma.listing.deleteMany({ where: { userId: { in: userIds } } })
  console.log('  ✓ Listings deleted')

  // Items
  await prisma.item.deleteMany({ where: { sellerId: { in: userIds } } })
  console.log('  ✓ Items deleted')

  // Activity logs
  await prisma.activityLog.deleteMany({ where: { userId: { in: userIds } } })
  console.log('  ✓ Activity logs deleted')

  // Auth records
  await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.otp.deleteMany({ where: { userId: { in: userIds } } })
  console.log('  ✓ Refresh tokens & OTPs deleted')

  // Documents & OCR
  await prisma.userDocument.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.ocrData.deleteMany({ where: { userId: { in: userIds } } })
  console.log('  ✓ Documents & OCR data deleted')

  // Clear self-referencing createdById before deleting users
  await prisma.user.updateMany({
    where: { id: { in: userIds } },
    data: { createdById: null }
  })

  // Finally delete the users
  const result = await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  console.log(`\n✅ Done! Removed ${result.count} non-admin user(s). Only admin remains.`)
}

main()
  .catch(e => {
    console.error('❌ Cleanup failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
