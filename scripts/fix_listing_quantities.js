// Fix ALL listings where quantity doesn't match estimatedWeight
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixAll() {
  const listings = await prisma.listing.findMany({
    select: { id: true, estimatedWeight: true, quantity: true, status: true },
  });

  console.log('All listings:', listings);

  for (const l of listings) {
    if (l.quantity < l.estimatedWeight) {
      await prisma.listing.update({
        where: { id: l.id },
        data: { quantity: l.estimatedWeight },
      });
      console.log(`  ✓ Fixed listing #${l.id}: quantity ${l.quantity} → ${l.estimatedWeight}`);
    }
  }

  console.log('Done!');
  await prisma.$disconnect();
}

fixAll().catch(async (e) => {
  console.error('Error:', e);
  await prisma.$disconnect();
  process.exit(1);
});
