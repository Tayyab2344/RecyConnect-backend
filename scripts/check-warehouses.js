import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function checkWarehouseAccounts() {
    try {
        console.log("🔍 Checking all warehouse accounts...\n");

        const warehouses = await prisma.user.findMany({
            where: { role: "warehouse" },
            select: {
                id: true,
                businessName: true,
                email: true,
                verificationStatus: true,
                emailVerified: true,
                kycStage: true,
                createdAt: true,
                password: true // Check if password exists
            },
            orderBy: { createdAt: "desc" }
        });

        if (warehouses.length === 0) {
            console.log("❌ No warehouse accounts found in database");
            return;
        }

        console.log(`Found ${warehouses.length} warehouse account(s):\n`);

        warehouses.forEach((w, index) => {
            console.log(`${index + 1}. Business: ${w.businessName || 'N/A'}`);
            console.log(`   Email: ${w.email}`);
            console.log(`   Status: ${w.verificationStatus}`);
            console.log(`   Email Verified: ${w.emailVerified}`);
            console.log(`   KYC Stage: ${w.kycStage}`);
            console.log(`   Has Password: ${w.password ? '✅ Yes' : '❌ No'}`);
            console.log(`   Created: ${w.createdAt}`);
            console.log('');
        });

        // Check for the most recent one
        const latest = warehouses[0];
        console.log("📋 Login Checklist for latest warehouse:");
        console.log(`   Email: ${latest.email}`);
        console.log(`   ${latest.password ? '✅' : '❌'} Has password set`);
        console.log(`   ${latest.emailVerified ? '✅' : '❌'} Email verified`);
        console.log(`   ${latest.verificationStatus === 'VERIFIED' ? '✅' : '❌'} Account verified`);

        if (!latest.password) {
            console.log("\n⚠️  WARNING: No password set! This account cannot login.");
            console.log("   This might happen if registration didn't complete properly.");
        }

        if (!latest.emailVerified) {
            console.log("\n⚠️  WARNING: Email not verified! Please verify OTP first.");
        }

        if (latest.verificationStatus !== 'VERIFIED') {
            console.log("\n⚠️  WARNING: Account not verified! Status:", latest.verificationStatus);
        }

    } catch (error) {
        console.error("❌ Error:", error.message);
    } finally {
        await prisma.$disconnect();
    }
}

checkWarehouseAccounts();
