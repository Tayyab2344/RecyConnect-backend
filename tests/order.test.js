/**
 * Order Controller Integration Tests
 * Tests: Create order from reservation, confirm, cancel, state transitions
 */
import 'dotenv/config';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();

// Import routes
import orderRoutes from '../src/routes/orderRoutes.js';
import reservationRoutes from '../src/routes/reservationRoutes.js';
import listingRoutes from '../src/routes/listingRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/orders', orderRoutes);
app.use('/api/reservations', reservationRoutes);
app.use('/api/listings', listingRoutes);

// Helper to generate token
function generateToken(user) {
    return jwt.sign(
        { userId: user.id, email: user.email, role: user.role },
        process.env.JWT_ACCESS_SECRET,
        { expiresIn: '1h' }
    );
}

describe('Order Controller - Reservation-Based Orders', () => {
    let buyer, seller;
    let buyerToken, sellerToken;
    let testListing, testReservation;

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
        await prisma.orderItem.deleteMany({
            where: {
                order: {
                    OR: [
                        { buyerId: buyer.id },
                        { sellerId: seller.id }
                    ]
                }
            }
        });
        await prisma.order.deleteMany({
            where: {
                OR: [
                    { buyerId: buyer.id },
                    { sellerId: seller.id }
                ]
            }
        });
        await prisma.listingReservation.deleteMany({
            where: { buyerId: buyer.id }
        });
        await prisma.listing.deleteMany({
            where: { userId: seller.id }
        });
        await prisma.user.deleteMany({
            where: {
                email: { contains: 'ordertestbuyer' }
            }
        });
        await prisma.user.deleteMany({
            where: {
                email: { contains: 'ordertestseller' }
            }
        });
        await prisma.$disconnect();
    });

    describe('POST /api/orders - Create Order from Reservation', () => {
        let activeReservation;

        beforeEach(async () => {
            // Create a fresh reservation for each test
            activeReservation = await prisma.listingReservation.create({
                data: {
                    listingId: testListing.id,
                    buyerId: buyer.id,
                    quantity: 5,
                    status: 'ACTIVE',
                    expiresAt: new Date(Date.now() + 20 * 60 * 1000) // 20 min from now
                }
            });

            // Reduce listing quantity
            await prisma.listing.update({
                where: { id: testListing.id },
                data: { quantity: { decrement: 5 } }
            });
        });

        afterEach(async () => {
            // Cleanup reservations and orders created in tests
            await prisma.orderItem.deleteMany({
                where: { order: { buyerId: buyer.id } }
            });
            await prisma.order.deleteMany({
                where: { buyerId: buyer.id }
            });
            await prisma.listingReservation.deleteMany({
                where: { buyerId: buyer.id }
            });
            // Reset listing quantity
            await prisma.listing.update({
                where: { id: testListing.id },
                data: { quantity: 100 }
            });
        });

        it('should fail without authentication', async () => {
            const res = await request(app)
                .post('/api/orders')
                .send({ reservationId: activeReservation.id });

            expect([401, 403]).toContain(res.status);
        });

        it('should fail without reservationId', async () => {
            const res = await request(app)
                .post('/api/orders')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({});

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Reservation ID is required');
        });

        it('should fail with non-existent reservation', async () => {
            const res = await request(app)
                .post('/api/orders')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({ reservationId: 999999 });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Reservation not found');
        });

        it('should fail if reservation does not belong to buyer', async () => {
            const res = await request(app)
                .post('/api/orders')
                .set('Authorization', `Bearer ${sellerToken}`) // Wrong user
                .send({ reservationId: activeReservation.id });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Reservation does not belong to you');
        });

        it('should fail if buyer equals seller', async () => {
            // Create a listing owned by buyer
            const buyerListing = await prisma.listing.create({
                data: {
                    userId: buyer.id,
                    category: 'Metal',
                    materialType: 'metal',
                    estimatedWeight: 20,
                    price: 15.0,
                    quantity: 50,
                    status: 'PUBLISHED',
                    images: []
                }
            });

            // Create reservation for buyer's own listing
            const selfReservation = await prisma.listingReservation.create({
                data: {
                    listingId: buyerListing.id,
                    buyerId: buyer.id,
                    quantity: 3,
                    status: 'ACTIVE',
                    expiresAt: new Date(Date.now() + 20 * 60 * 1000)
                }
            });

            const res = await request(app)
                .post('/api/orders')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({ reservationId: selfReservation.id });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('cannot create an order for your own listing');

            // Cleanup
            await prisma.listingReservation.delete({ where: { id: selfReservation.id } });
            await prisma.listing.delete({ where: { id: buyerListing.id } });
        });

        it('should create order from ACTIVE reservation successfully', async () => {
            const res = await request(app)
                .post('/api/orders')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({ reservationId: activeReservation.id });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('CREATED');
            expect(res.body.data.buyerId).toBe(buyer.id);
            expect(res.body.data.sellerId).toBe(seller.id);
            expect(res.body.data.totalAmount).toBe(50); // 5 qty * 10 price

            // Verify reservation is now PENDING
            const updatedReservation = await prisma.listingReservation.findUnique({
                where: { id: activeReservation.id }
            });
            expect(updatedReservation.status).toBe('PENDING');
            expect(updatedReservation.orderId).toBe(res.body.data.id);
        });

        it('should fail if reservation already has an order', async () => {
            // First, create an order
            await request(app)
                .post('/api/orders')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({ reservationId: activeReservation.id });

            // Try to create another order with same reservation
            const res = await request(app)
                .post('/api/orders')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({ reservationId: activeReservation.id });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('not active');
        });
    });

    describe('POST /api/orders/:id/confirm - Confirm Order', () => {
        let testOrder;

        beforeEach(async () => {
            // Create reservation
            const reservation = await prisma.listingReservation.create({
                data: {
                    listingId: testListing.id,
                    buyerId: buyer.id,
                    quantity: 3,
                    status: 'PENDING',
                    expiresAt: new Date(Date.now() + 20 * 60 * 1000)
                }
            });

            // Create order with CREATED status
            testOrder = await prisma.order.create({
                data: {
                    buyerId: buyer.id,
                    sellerId: seller.id,
                    status: 'CREATED',
                    totalAmount: 30,
                    items: {
                        create: {
                            listingId: testListing.id,
                            quantity: 3,
                            price: 10
                        }
                    }
                }
            });

            // Link reservation to order
            await prisma.listingReservation.update({
                where: { id: reservation.id },
                data: { orderId: testOrder.id }
            });
        });

        afterEach(async () => {
            await prisma.orderItem.deleteMany({ where: { orderId: testOrder?.id } });
            await prisma.listingReservation.deleteMany({ where: { orderId: testOrder?.id } });
            await prisma.order.deleteMany({ where: { id: testOrder?.id } });
        });

        it('should fail if user is not the seller', async () => {
            const res = await request(app)
                .post(`/api/orders/${testOrder.id}/confirm`)
                .set('Authorization', `Bearer ${buyerToken}`); // Buyer, not seller

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Only the seller can confirm');
        });

        it('should confirm order and lock reservation', async () => {
            const res = await request(app)
                .post(`/api/orders/${testOrder.id}/confirm`)
                .set('Authorization', `Bearer ${sellerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('CONFIRMED');

            // Verify reservation is COMPLETED (locked)
            const reservation = await prisma.listingReservation.findFirst({
                where: { orderId: testOrder.id }
            });
            expect(reservation.status).toBe('COMPLETED');
        });

        it('should fail to confirm already confirmed order', async () => {
            // First confirm
            await request(app)
                .post(`/api/orders/${testOrder.id}/confirm`)
                .set('Authorization', `Bearer ${sellerToken}`);

            // Try to confirm again
            const res = await request(app)
                .post(`/api/orders/${testOrder.id}/confirm`)
                .set('Authorization', `Bearer ${sellerToken}`);

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Cannot confirm order');
        });
    });

    describe('POST /api/orders/:id/cancel - Cancel Order', () => {
        let testOrder, testReservation;

        beforeEach(async () => {
            // Reset listing quantity
            await prisma.listing.update({
                where: { id: testListing.id },
                data: { quantity: 95 } // 100 - 5 reserved
            });

            // Create reservation
            testReservation = await prisma.listingReservation.create({
                data: {
                    listingId: testListing.id,
                    buyerId: buyer.id,
                    quantity: 5,
                    status: 'PENDING',
                    expiresAt: new Date(Date.now() + 20 * 60 * 1000)
                }
            });

            // Create order with CREATED status
            testOrder = await prisma.order.create({
                data: {
                    buyerId: buyer.id,
                    sellerId: seller.id,
                    status: 'CREATED',
                    totalAmount: 50,
                    items: {
                        create: {
                            listingId: testListing.id,
                            quantity: 5,
                            price: 10
                        }
                    }
                }
            });

            // Link reservation to order
            await prisma.listingReservation.update({
                where: { id: testReservation.id },
                data: { orderId: testOrder.id }
            });
        });

        afterEach(async () => {
            await prisma.orderItem.deleteMany({ where: { orderId: testOrder?.id } });
            await prisma.listingReservation.deleteMany({ where: { buyerId: buyer.id } });
            await prisma.order.deleteMany({ where: { id: testOrder?.id } });
            // Reset listing quantity
            await prisma.listing.update({
                where: { id: testListing.id },
                data: { quantity: 100 }
            });
        });

        it('should cancel order and restore listing quantity', async () => {
            const listingBefore = await prisma.listing.findUnique({
                where: { id: testListing.id }
            });

            const res = await request(app)
                .post(`/api/orders/${testOrder.id}/cancel`)
                .set('Authorization', `Bearer ${buyerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('CANCELLED');

            // Verify listing quantity is restored
            const listingAfter = await prisma.listing.findUnique({
                where: { id: testListing.id }
            });
            expect(listingAfter.quantity).toBe(listingBefore.quantity + 5);

            // Verify reservation is RELEASED
            const reservation = await prisma.listingReservation.findUnique({
                where: { id: testReservation.id }
            });
            expect(reservation.status).toBe('RELEASED');
            expect(reservation.orderId).toBeNull();
        });

        it('should allow seller to cancel order', async () => {
            const res = await request(app)
                .post(`/api/orders/${testOrder.id}/cancel`)
                .set('Authorization', `Bearer ${sellerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.status).toBe('CANCELLED');
        });

        it('should fail to cancel confirmed order', async () => {
            // Confirm the order first
            await prisma.order.update({
                where: { id: testOrder.id },
                data: { status: 'CONFIRMED' }
            });

            const res = await request(app)
                .post(`/api/orders/${testOrder.id}/cancel`)
                .set('Authorization', `Bearer ${buyerToken}`);

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Cannot cancel order');
            expect(res.body.message).toContain('CONFIRMED');
        });
    });

    describe('GET /api/orders/buyer - Get Buyer Orders', () => {
        it('should return buyer orders with pagination', async () => {
            const res = await request(app)
                .get('/api/orders/buyer')
                .set('Authorization', `Bearer ${buyerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data)).toBe(true);
            expect(res.body.pagination).toBeDefined();
        });

        it('should filter by status', async () => {
            const res = await request(app)
                .get('/api/orders/buyer?status=CREATED')
                .set('Authorization', `Bearer ${buyerToken}`);

            expect(res.status).toBe(200);
        });
    });

    describe('GET /api/orders/seller - Get Seller Orders', () => {
        it('should return seller orders with pagination', async () => {
            const res = await request(app)
                .get('/api/orders/seller')
                .set('Authorization', `Bearer ${sellerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data)).toBe(true);
        });

        it('should filter by buyerId', async () => {
            const res = await request(app)
                .get(`/api/orders/seller?buyerId=${buyer.id}`)
                .set('Authorization', `Bearer ${sellerToken}`);

            expect(res.status).toBe(200);
        });
    });

    describe('State Transition Validation', () => {
        let testOrder;

        beforeEach(async () => {
            testOrder = await prisma.order.create({
                data: {
                    buyerId: buyer.id,
                    sellerId: seller.id,
                    status: 'CONFIRMED', // Already confirmed
                    totalAmount: 50,
                    items: {
                        create: {
                            listingId: testListing.id,
                            quantity: 5,
                            price: 10
                        }
                    }
                }
            });
        });

        afterEach(async () => {
            await prisma.orderItem.deleteMany({ where: { orderId: testOrder?.id } });
            await prisma.order.deleteMany({ where: { id: testOrder?.id } });
        });

        it('should block cancellation of CONFIRMED order', async () => {
            const res = await request(app)
                .post(`/api/orders/${testOrder.id}/cancel`)
                .set('Authorization', `Bearer ${buyerToken}`);

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Cannot cancel');
        });

        it('should block confirmation of CANCELLED order', async () => {
            await prisma.order.update({
                where: { id: testOrder.id },
                data: { status: 'CANCELLED' }
            });

            const res = await request(app)
                .post(`/api/orders/${testOrder.id}/confirm`)
                .set('Authorization', `Bearer ${sellerToken}`);

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Cannot confirm');
        });
    });
});
