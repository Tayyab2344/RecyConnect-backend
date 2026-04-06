// Cleanup: release all orphaned PENDING/ACTIVE reservations and restore listing stock
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanup() {
  // Find all non-completed, non-released reservations (orphaned)
  const orphaned = await prisma.listingReservation.findMany({
    where: {
      status: { in: ['ACTIVE', 'PENDING'] },
    },
    select: { id: true, listingId: true, quantity: true, status: true },
  });

  console.log(`Found ${orphaned.length} orphaned reservations:`, orphaned);

  for (const resv of orphaned) {
    // Release the reservation
    await prisma.listingReservation.update({
      where: { id: resv.id },
      data: { status: 'RELEASED' },
    });

    // Restore the stock
    await prisma.listing.update({
      where: { id: resv.listingId },
      data: { quantity: { increment: resv.quantity } },
    });

    console.log(`  ✓ Released reservation #${resv.id} (listing #${resv.listingId}, qty: ${resv.quantity})`);
  }

  // Show final state
  const listings = await prisma.listing.findMany({
    select: { id: true, estimatedWeight: true, quantity: true, status: true },
  });
  console.log('\nFinal listing state:');
  console.table(listings);

  await prisma.$disconnect();
}

cleanup().catch(async (e) => {
  console.error('Error:', e);
  await prisma.$disconnect();
  process.exit(1);
});
