/**
 * Integration Tests - Full Happy Flow and Edge Cases
 * Tests end-to-end flow: Listing → Reserve → Order → Confirm → Pay → Complete → Release
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
import paymentRoutes from '../src/routes/paymentRoutes.js';
import listingRoutes from '../src/routes/listingRoutes.js';

// Mock Stripe service for testing
jest.mock('../src/services/stripeService.js', () => ({
    createPaymentIntent: jest.fn().mockResolvedValue({
        id: 'pi_integration_test_123',
        client_secret: 'pi_integration_test_123_secret',
        status: 'requires_payment_method'
    }),
    retrievePaymentIntent: jest.fn().mockResolvedValue({
        id: 'pi_integration_test_123',
        status: 'requires_capture',
        payment_method_types: ['card']
    }),
    capturePaymentIntent: jest.fn().mockResolvedValue({
        id: 'pi_integration_test_123',
        status: 'succeeded'
    }),
    cancelPaymentIntent: jest.fn().mockResolvedValue({
        id: 'pi_integration_test_123',
        status: 'canceled'
    }),
    createRefund: jest.fn().mockResolvedValue({
        id: 're_integration_test_123',
        status: 'succeeded'
    }),
    mapStripeStatusToPaymentStatus: jest.fn((status) => {
        const map = {
            'requires_capture': 'AUTHORIZED',
            'succeeded': 'CAPTURED',
            'canceled': 'FAILED'
        };
        return map[status] || 'INITIATED';
    })
}));

const app = express();
app.use(express.json());
app.use('/api/orders', orderRoutes);
app.use('/api/reservations', reservationRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/listings', listingRoutes);

// Helper to generate token
function generateToken(user) {
    return jwt.sign(
        { userId: user.id, email: user.email, role: user.role },
        process.env.JWT_ACCESS_SECRET,
        { expiresIn: '1h' }
    );
}

describe('Integration Tests - Full Flow', () => {
    let buyer, seller;
    let buyerToken, sellerToken;
    let testListing;

    beforeAll(async () => {
        // Create test users
        const hashedPassword = await bcrypt.hash('TestPassword123!', 10);

        seller = await prisma.user.create({
            data: {
                name: 'Integration Test Seller',
                email: `integrationseller${Date.now()}@test.com`,
                password: hashedPassword,
                role: 'individual',
                emailVerified: true
            }
        });

        buyer = await prisma.user.create({
            data: {
                name: 'Integration Test Buyer',
                email: `integrationbuyer${Date.now()}@test.com`,
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
                estimatedWeight: 100,
                price: 50.0,
                quantity: 100,
                status: 'PUBLISHED',
                images: []
            }
        });
    });

    afterAll(async () => {
        // Cleanup
        await prisma.payment.deleteMany({
            where: { order: { OR: [{ buyerId: buyer?.id }, { sellerId: seller?.id }] } }
        });
        await prisma.orderItem.deleteMany({
            where: { order: { OR: [{ buyerId: buyer?.id }, { sellerId: seller?.id }] } }
        });
        await prisma.order.deleteMany({
            where: { OR: [{ buyerId: buyer?.id }, { sellerId: seller?.id }] }
        });
        await prisma.listingReservation.deleteMany({
            where: { OR: [{ buyerId: buyer?.id }, { listing: { userId: seller?.id } }] }
        });
        await prisma.listing.deleteMany({
            where: { userId: seller?.id }
        });
        await prisma.user.deleteMany({
            where: { email: { contains: 'integrationbuyer' } }
        });
        await prisma.user.deleteMany({
            where: { email: { contains: 'integrationseller' } }
        });
        await prisma.$disconnect();
    });

    describe('Complete Happy Path', () => {
        let reservationId, orderId, paymentId;

        it('Step 1: Buyer reserves inventory', async () => {
            const res = await request(app)
                .post('/api/reservations')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({ listingId: testListing.id, quantity: 10 });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            reservationId = res.body.data.reservation.id;

            // Verify listing quantity reduced
            const listing = await prisma.listing.findUnique({ where: { id: testListing.id } });
            expect(listing.quantity).toBe(90);
        });

        it('Step 2: Buyer creates order from reservation', async () => {
            const res = await request(app)
                .post('/api/orders')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({ reservationId });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('CREATED');
            orderId = res.body.data.id;
        });

        it('Step 3: Seller confirms order', async () => {
            const res = await request(app)
                .post(`/api/orders/${orderId}/confirm`)
                .set('Authorization', `Bearer ${sellerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('CONFIRMED');
        });

        it('Step 4: Buyer creates PaymentIntent', async () => {
            const res = await request(app)
                .post('/api/payments/create-intent')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({ orderId });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.clientSecret).toBeDefined();
            paymentId = res.body.data.paymentId;
        });

        it('Step 5: Buyer authorizes payment', async () => {
            const res = await request(app)
                .post(`/api/payments/${paymentId}/authorize`)
                .set('Authorization', `Bearer ${buyerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('AUTHORIZED');
        });

        it('Step 6: Seller captures payment', async () => {
            const res = await request(app)
                .post(`/api/payments/${paymentId}/capture`)
                .set('Authorization', `Bearer ${sellerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('CAPTURED');
        });

        it('Step 7: Seller completes order', async () => {
            const res = await request(app)
                .post(`/api/orders/${orderId}/complete`)
                .set('Authorization', `Bearer ${sellerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('COMPLETED');
        });

        it('Step 8: Seller releases payment', async () => {
            const res = await request(app)
                .post(`/api/payments/${paymentId}/release`)
                .set('Authorization', `Bearer ${sellerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('RELEASED');
        });
    });

    describe('Idempotency and Edge Cases', () => {
        let testReservationId, testOrderId;

        beforeEach(async () => {
            // Reset listing quantity for each test
            await prisma.listing.update({
                where: { id: testListing.id },
                data: { quantity: 100 }
            });
        });

        it('should prevent duplicate active reservations for same listing', async () => {
            // First reservation
            const res1 = await request(app)
                .post('/api/reservations')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({ listingId: testListing.id, quantity: 5 });

            expect(res1.status).toBe(201);
            testReservationId = res1.body.data.reservation.id;

            // Second reservation should fail
            const res2 = await request(app)
                .post('/api/reservations')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({ listingId: testListing.id, quantity: 5 });

            expect(res2.status).toBe(400);
            expect(res2.body.message).toContain('already have an active reservation');

            // Cleanup
            await prisma.listingReservation.delete({ where: { id: testReservationId } });
        });

        it('should prevent self-reservation', async () => {
            const res = await request(app)
                .post('/api/reservations')
                .set('Authorization', `Bearer ${sellerToken}`)
                .send({ listingId: testListing.id, quantity: 5 });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('cannot reserve your own listing');
        });

        it('should prevent completing order without captured payment', async () => {
            // Create reservation
            const resReserve = await request(app)
                .post('/api/reservations')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({ listingId: testListing.id, quantity: 5 });
            testReservationId = resReserve.body.data.reservation.id;

            // Create order
            const resOrder = await request(app)
                .post('/api/orders')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({ reservationId: testReservationId });
            testOrderId = resOrder.body.data.id;

            // Confirm order
            await request(app)
                .post(`/api/orders/${testOrderId}/confirm`)
                .set('Authorization', `Bearer ${sellerToken}`);

            // Try to complete without payment
            const resComplete = await request(app)
                .post(`/api/orders/${testOrderId}/complete`)
                .set('Authorization', `Bearer ${sellerToken}`);

            expect(resComplete.status).toBe(400);
            expect(resComplete.body.message).toContain('No payment found');

            // Cleanup
            await prisma.order.delete({ where: { id: testOrderId } });
            await prisma.listingReservation.delete({ where: { id: testReservationId } });
        });

        it('should prevent duplicate PaymentIntent creation', async () => {
            // Create reservation
            const resReserve = await request(app)
                .post('/api/reservations')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({ listingId: testListing.id, quantity: 5 });
            testReservationId = resReserve.body.data.reservation.id;

            // Create order
            const resOrder = await request(app)
                .post('/api/orders')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({ reservationId: testReservationId });
            testOrderId = resOrder.body.data.id;

            // Confirm order
            await request(app)
                .post(`/api/orders/${testOrderId}/confirm`)
                .set('Authorization', `Bearer ${sellerToken}`);

            // Create first PaymentIntent
            const resPay1 = await request(app)
                .post('/api/payments/create-intent')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({ orderId: testOrderId });

            expect(resPay1.status).toBe(201);

            // Try to create second PaymentIntent - should fail
            const resPay2 = await request(app)
                .post('/api/payments/create-intent')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({ orderId: testOrderId });

            expect(resPay2.status).toBe(400);
            expect(resPay2.body.message).toContain('Payment already exists');

            // Cleanup
            await prisma.payment.deleteMany({ where: { orderId: testOrderId } });
            await prisma.order.delete({ where: { id: testOrderId } });
            await prisma.listingReservation.delete({ where: { id: testReservationId } });
        });
    });

    describe('Cancellation Scenarios', () => {
        it('should cancel order before payment and release reservation', async () => {
            // Setup
            const resReserve = await request(app)
                .post('/api/reservations')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({ listingId: testListing.id, quantity: 10 });
            const reservationId = resReserve.body.data.reservation.id;

            const resOrder = await request(app)
                .post('/api/orders')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({ reservationId });
            const orderId = resOrder.body.data.id;

            // Get listing qty before cancel
            const listingBefore = await prisma.listing.findUnique({ where: { id: testListing.id } });

            // Cancel order
            const resCancel = await request(app)
                .post(`/api/orders/${orderId}/cancel`)
                .set('Authorization', `Bearer ${buyerToken}`);

            expect(resCancel.status).toBe(200);
            expect(resCancel.body.data.status).toBe('CANCELLED');

            // Verify listing quantity restored
            const listingAfter = await prisma.listing.findUnique({ where: { id: testListing.id } });
            expect(listingAfter.quantity).toBe(listingBefore.quantity + 10);
        });
    });
});
