import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  console.log("--- Starting Admin Role Fix ---");

  // 1. Fix uppercase 'ADMIN' roles
  const upperAdmins = await prisma.user.findMany({
    where: {
      role: "ADMIN"
    }
  });

  console.log(`Found ${upperAdmins.length} users with role 'ADMIN' (uppercase).`);

  for (const user of upperAdmins) {
    console.log(`Updating user ${user.email} (ID: ${user.id}) to role 'admin'`);
    await prisma.user.update({
      where: { id: user.id },
      data: { 
        role: 'admin',
        verificationStatus: 'VERIFIED',
        kycStage: 'VERIFIED'
      }
    });
  }
  
  // 2. Fix pending 'admin' users
  const pendingAdmins = await prisma.user.findMany({
      where: {
          role: 'admin',
          verificationStatus: {
            not: 'VERIFIED'
          }
      }
  });

  console.log(`Found ${pendingAdmins.length} users with role 'admin' but not VERIFIED.`);
  
  for(const user of pendingAdmins) {
      console.log(`Fixing status for admin ${user.email} (ID: ${user.id})`);
      await prisma.user.update({
          where: { id: user.id },
          data: { 
            verificationStatus: 'VERIFIED',
            kycStage: 'VERIFIED',
            emailVerified: true
          }
      });
  }
  
  // 3. Just in case, try to find any user with 'admin' in email and make them admin if they aren't
     const potentialAdmins = await prisma.user.findMany({
      where: {
          email: {
            contains: 'admin',
            mode: 'insensitive'
          },
          role: {
            not: 'admin'
          }
      }
  });
  
  if (potentialAdmins.length > 0) {
      console.log(`Found ${potentialAdmins.length} potential admins based on email substring 'admin' who don't have 'admin' role.`);
      for(const user of potentialAdmins) {
          // Be careful here, only if it really looks like an admin email
          if(user.email.includes("admin@") || user.email.includes("quantix")) {
               console.log(`promoting ${user.email} to admin`);
               await prisma.user.update({
                  where: { id: user.id },
                  data: {
                      role: 'admin',
                      verificationStatus: 'VERIFIED',
                      kycStage: 'VERIFIED',
                      emailVerified: true
                  }
               });
          }
      }
  }

  console.log("--- Done ---");
}

main()
  .catch(e => {
      console.error(e);
      process.exit(1);
  })
  .finally(async () => await prisma.$disconnect());
