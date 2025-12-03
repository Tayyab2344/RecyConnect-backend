import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function approveWarehouse() {
    try {
        // Find the most recent warehouse with PENDING status
        const warehouse = await prisma.user.findFirst({
            where: {
                role: "warehouse",
                verificationStatus: "PENDING",
                emailVerified: true
            },
            orderBy: {
                createdAt: "desc"
            }
        });

        if (!warehouse) {
            console.log("❌ No pending warehouse found");
            console.log("Looking for any warehouse accounts...");

            const allWarehouses = await prisma.user.findMany({
                where: { role: "warehouse" },
                select: {
                    id: true,
                    businessName: true,
                    email: true,
                    verificationStatus: true,
                    emailVerified: true,
                    createdAt: true
                }
            });

            console.log("\nAll warehouse accounts:");
            console.table(allWarehouses);
            return;
        }

        console.log(`\n✅ Found warehouse: ${warehouse.businessName || warehouse.email}`);
        console.log(`   Email: ${warehouse.email}`);
        console.log(`   Current Status: ${warehouse.verificationStatus}`);
        console.log(`   Email Verified: ${warehouse.emailVerified}`);

        // Approve the warehouse
        const updated = await prisma.user.update({
            where: { id: warehouse.id },
            data: {
                verificationStatus: "VERIFIED",
                kycStage: "VERIFIED",
                rejectionReason: null
            }
        });

        console.log(`\n🎉 Warehouse approved successfully!`);
        console.log(`   New Status: ${updated.verificationStatus}`);
        console.log(`   KYC Stage: ${updated.kycStage}`);
        console.log(`\n✅ You can now login with:`);
        console.log(`   Email: ${updated.email}`);
        console.log(`   Password: [your password]`);

    } catch (error) {
        console.error("❌ Error:", error.message);
    } finally {
        await prisma.$disconnect();
    }
}

approveWarehouse();
