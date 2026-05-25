/**
 * Order Controller Integration Tests
 */
import 'dotenv/config';
import request from 'supertest';
import express from 'express';
import prisma from '../src/lib/prisma.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

// Import routes
import orderRoutes from '../src/modules/order/routes/orderRoutes.js';
import listingRoutes from '../src/modules/listing/routes/listingRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/orders', orderRoutes);
app.use('/api/listings', listingRoutes);

// Helper to generate token
function generateToken(user) {
    return jwt.sign(
        { userId: user.id, email: user.email, role: user.role },
        process.env.JWT_ACCESS_SECRET || 'test-secret',
        { expiresIn: '1h' }
    );
}

describe('Order Controller', () => {
    let buyer, seller;
    let buyerToken, sellerToken;
    let testListing;

    beforeAll(async () => {
        // Create test users
        const hashedPassword = await bcrypt.hash('TestPassword123!', 10);

        seller = await prisma.user.create({
            data: {
                name: 'Order Test Seller',
                email: `ordertestseller${Date.now()}@test.com`,
                password: hashedPassword,
                role: 'individual',
                emailVerified: true
            }
        });

        buyer = await prisma.user.create({
            data: {
                name: 'Order Test Buyer',
                email: `ordertestbuyer${Date.now()}@test.com`,
                password: hashedPassword,
                role: 'warehouse',
                emailVerified: true
            }
        });

        buyerToken = generateToken(buyer);
        sellerToken = generateToken(seller);

        // Create a test listing
        testListing = await prisma.listing.create({
            data: {
                userId: seller.id,
                category: 'Plastic',
                materialType: 'plastic',
                estimatedWeight: 50,
                price: 10.0,
                quantity: 100,
                status: 'PUBLISHED',
                images: []
            }
        });
    });

    afterAll(async () => {
        // Cleanup in proper order (respecting foreign key constraints)
        await prisma.payment.deleteMany({
             where: { order: { buyerId: buyer.id } }
        }).catch(() => {});
        await prisma.orderItem.deleteMany({
             where: { order: { buyerId: buyer.id } }
        });
        await prisma.order.deleteMany({
             where: { OR: [{ buyerId: buyer.id }, { sellerId: seller.id }] }
        });
        await prisma.listingReservation.deleteMany();
        await prisma.listing.deleteMany({
            where: { userId: { in: [seller.id, buyer.id] } }
        });
        await prisma.notification.deleteMany({
            where: { userId: { in: [seller.id, buyer.id] } }
        });
        await prisma.user.deleteMany({
            where: { id: { in: [seller.id, buyer.id] } }
        });
        // prisma disconnect handled by setup.js
    });

    describe('POST /api/orders', () => {
        afterEach(async () => {
            await prisma.payment.deleteMany({
                 where: { order: { buyerId: buyer.id } }
            }).catch(() => {});
            await prisma.orderItem.deleteMany({
                 where: { order: { buyerId: buyer.id } }
            });
            await prisma.order.deleteMany({
                 where: { buyerId: buyer.id }
            });
            await prisma.listing.update({
                where: { id: testListing.id },
                data: { estimatedWeight: 50, quantity: 100 }
            });
        });

        it('should fail without authentication', async () => {
            const res = await request(app)
                .post('/api/orders')
                .send({ listingId: testListing.id, weight: 10 });
            expect([401, 403]).toContain(res.status);
        });

        it('should fail without listingId', async () => {
             const res = await request(app)
                .post('/api/orders')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({ weight: 10 });
             expect(res.status).toBe(400);
             expect(res.body.message).toContain('listingId is required');
        });

        it('should create order successfully', async () => {
            const res = await request(app)
                .post('/api/orders')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({ listingId: testListing.id, weight: 10 });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('CREATED');
            expect(res.body.data.buyerId).toBe(buyer.id);
            expect(res.body.data.totalAmount).toBe(100); // 10 weight * 10 price
        });
        
        it('should fail if buyer equals seller', async () => {
            const res = await request(app)
                .post('/api/orders')
                .set('Authorization', `Bearer ${sellerToken}`)
                .send({ listingId: testListing.id, weight: 10 });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('cannot create an order for your own listing');
        });
        
        it('should fail if quantity exceeds available stock', async () => {
            const res = await request(app)
                .post('/api/orders')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({ listingId: testListing.id, weight: 1000 });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('exceeds available stock');
        });
    });

    describe('POST /api/orders/:id/confirm', () => {
        let testOrder;
        beforeEach(async () => {
            testOrder = await prisma.order.create({
                data: {
                    buyerId: buyer.id,
                    sellerId: seller.id,
                    status: 'CREATED',
                    totalAmount: 100,
                    items: {
                        create: { listingId: testListing.id, quantity: 10, price: 10 }
                    }
                }
            });
        });
        
        afterEach(async () => {
            await prisma.payment.deleteMany({
                 where: { order: { buyerId: buyer.id } }
            }).catch(() => {});
            await prisma.orderItem.deleteMany({
                 where: { order: { buyerId: buyer.id } }
            });
            await prisma.order.deleteMany({
                 where: { buyerId: buyer.id }
            });
        });

        it('should allow seller to confirm', async () => {
            const res = await request(app)
                .post(`/api/orders/${testOrder.id}/confirm`)
                .set('Authorization', `Bearer ${sellerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.status).toBe('CONFIRMED');
        });
    });

    describe('POST /api/orders/:id/cancel', () => {
        let testOrder;
        beforeEach(async () => {
            testOrder = await prisma.order.create({
                data: {
                    buyerId: buyer.id,
                    sellerId: seller.id,
                    status: 'CREATED',
                    totalAmount: 100,
                    items: {
                        create: { listingId: testListing.id, quantity: 10, price: 10 }
                    }
                }
            });
        });
        
        afterEach(async () => {
            await prisma.payment.deleteMany({
                 where: { order: { buyerId: buyer.id } }
            }).catch(() => {});
            await prisma.orderItem.deleteMany({
                 where: { order: { buyerId: buyer.id } }
            });
            await prisma.order.deleteMany({
                 where: { buyerId: buyer.id }
            });
        });

        it('should allow buyer to cancel order', async () => {
            const res = await request(app)
                .post(`/api/orders/${testOrder.id}/cancel`)
                .set('Authorization', `Bearer ${buyerToken}`);

            if (res.status !== 200) {
                console.error('CANCELLATION_ERROR_BODY:' + JSON.stringify(res.body));
            }
            expect(res.status).toBe(200);
            expect(res.body.data.status).toBe('CANCELLED');
        });
        
        it('should successfully cancel a confirmed order', async () => {
            await prisma.order.update({ where: { id: testOrder.id }, data: { status: 'CONFIRMED'} });
            const res = await request(app)
                .post(`/api/orders/${testOrder.id}/cancel`)
                .set('Authorization', `Bearer ${buyerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.status).toBe('CANCELLED');
        }, 60000);
    });
});
