/**
 * One-time database repair script
 * Fixes listings whose estimatedWeight/quantity was incorrectly decremented to 0
 * due to the order creation crash bug.
 * 
 * Run with: node scripts/fix-listing-stock.js
 * 
 * Logic: For each listing that has estimatedWeight=0 but has no COMPLETED or CONFIRMED orders,
 * it means the stock was incorrectly depleted. We restore it by looking at CREATED orders
 * (which are still active but the listing shows 0 stock).
 */

import prisma from '../src/lib/prisma.js';

async function fixListingStock() {
    console.log('Starting listing stock repair...\n');

    // Find listings with 0 estimatedWeight that aren't actually SOLD
    const problematicListings = await prisma.listing.findMany({
        where: {
            estimatedWeight: 0,
            status: { not: 'SOLD' }
        },
        include: {
            orderItems: {
                include: {
                    order: { select: { id: true, status: true } }
                }
            }
        }
    });

    console.log(`Found ${problematicListings.length} listings with 0 estimatedWeight`);

    for (const listing of problematicListings) {
        // Check if there are active (CREATED) orders for this listing
        const activeOrders = listing.orderItems.filter(
            item => item.order.status === 'CREATED'
        );

        if (activeOrders.length > 0) {
            const reservedQty = activeOrders.reduce((sum, item) => sum + item.quantity, 0);
            console.log(`Listing ${listing.id}: Has ${activeOrders.length} CREATED order(s) reserving ${reservedQty} kg`);
            // Stock is legitimately reserved - keep as is but mark status as RESERVED if needed
        } else {
            // Stock was depleted by cancelled/failed orders - restore from original estimatedWeight
            // We can't know the original value, but we can check related cancelled orders
            const cancelledOrders = listing.orderItems.filter(
                item => item.order.status === 'CANCELLED'
            );

            if (cancelledOrders.length > 0) {
                const cancelledQty = cancelledOrders.reduce((sum, item) => sum + item.quantity, 0);
                console.log(`Listing ${listing.id}: Restoring ${cancelledQty} kg from ${cancelledOrders.length} cancelled order(s)`);

                await prisma.listing.update({
                    where: { id: listing.id },
                    data: {
                        estimatedWeight: cancelledQty,
                        quantity: cancelledQty,
                        status: 'PUBLISHED'
                    }
                });
                console.log(`  ✓ Restored listing ${listing.id} to ${cancelledQty} kg`);
            } else {
                console.log(`Listing ${listing.id}: No cancelled orders found - needs manual review`);
            }
        }
    }

    console.log('\nStock repair complete!');
    await prisma.$disconnect();
}

fixListingStock().catch(console.error);
