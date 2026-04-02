import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function test() {
  console.log('Testing database queries...');
  
  try {
    const count = await prisma.listing.count();
    console.log('LISTINGS COUNT OK:', count);
  } catch(e) {
    console.error('LISTINGS ERROR:', e.message);
  }
  
  try {
    const count = await prisma.transaction.count();
    console.log('TRANSACTIONS COUNT OK:', count);
  } catch(e) {
    console.error('TRANSACTIONS ERROR:', e.message);
  }
  
  await prisma.$disconnect();
  process.exit(0);
}

test();
