// Reset all listing quantities to exactly match estimatedWeight
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function resetQuantities() {
  const listings = await prisma.listing.findMany({
    select: { id: true, estimatedWeight: true, quantity: true },
  });

  for (const l of listings) {
    if (l.quantity !== l.estimatedWeight) {
      await prisma.listing.update({
        where: { id: l.id },
        data: { quantity: l.estimatedWeight },
      });
      console.log(`✓ Listing #${l.id}: quantity ${l.quantity} → ${l.estimatedWeight}`);
    }
  }

  const final_listings = await prisma.listing.findMany({
    select: { id: true, estimatedWeight: true, quantity: true, status: true },
  });
  console.log('\nFinal state:');
  console.table(final_listings);

  await prisma.$disconnect();
}

resetQuantities();
