// Fix script: restore quantity = estimatedWeight for PUBLISHED listings with quantity <= 0
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixListingQuantities() {
  console.log('Connecting to DB...');

  const broken = await prisma.listing.findMany({
    where: {
      quantity: { lte: 0 },
    },
    select: { id: true, estimatedWeight: true, quantity: true, status: true },
  });

  console.log(`Found ${broken.length} listing(s) with quantity <= 0:`, broken);

  for (const listing of broken) {
    await prisma.listing.update({
      where: { id: listing.id },
      data: { quantity: listing.estimatedWeight },
    });
    console.log(
      `  ✓ Fixed listing #${listing.id} [${listing.status}]: quantity ${listing.quantity} → ${listing.estimatedWeight}`
    );
  }

  console.log('All done!');
  await prisma.$disconnect();
}

fixListingQuantities().catch(async (e) => {
  console.error('Error:', e);
  await prisma.$disconnect();
  process.exit(1);
});
