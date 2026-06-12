import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log("Checking DB Connection and Data...");
  
  const userCount = await prisma.user.count();
  const orderCount = await prisma.order.count();
  const listingCount = await prisma.listing.count();
  const paymentCount = await prisma.payment.count();
  const completedOrders = await prisma.order.count({ where: { status: 'COMPLETED' } });
  
  console.log({
    userCount,
    orderCount,
    listingCount,
    paymentCount,
    completedOrders
  });

  const orders = await prisma.order.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    include: {
      buyer: { select: { name: true } },
      seller: { select: { name: true } }
    }
  });
  console.log("Recent 5 Orders:", JSON.stringify(orders, null, 2));

  const allOrderStatuses = await prisma.order.groupBy({
    by: ['status'],
    _count: { id: true }
  });
  console.log("Order Status Counts:", allOrderStatuses);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
