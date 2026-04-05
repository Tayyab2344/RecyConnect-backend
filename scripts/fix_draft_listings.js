import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const result = await prisma.listing.updateMany({
    where: {
      status: 'DRAFT',
    },
    data: {
      status: 'PUBLISHED',
    },
  });
  console.log(`Updated ${result.count} existing listings from DRAFT to PUBLISHED.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
