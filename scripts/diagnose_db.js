// Diagnostic: show all listings and active reservations
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function diagnose() {
  const listings = await prisma.listing.findMany({
    select: { id: true, estimatedWeight: true, quantity: true, status: true, materialType: true },
  });
  console.log('=== LISTINGS ===');
  console.table(listings);

  const reservations = await prisma.listingReservation.findMany({
    select: { id: true, listingId: true, buyerId: true, quantity: true, status: true, expiresAt: true },
  });
  console.log('\n=== RESERVATIONS ===');
  if (reservations.length === 0) {
    console.log('No reservations found');
  } else {
    console.table(reservations);
  }

  await prisma.$disconnect();
}

diagnose().catch(async (e) => {
  console.error('Error:', e);
  await prisma.$disconnect();
  process.exit(1);
});
