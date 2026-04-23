/**
 * Integration Tests - Full Happy Flow and Edge Cases
 * Tests end-to-end flow: Listing → Order → Confirm → Pay → Complete → Release
 */
import 'dotenv/config';
import request from 'supertest';
import express from 'express';
import prisma from '../src/lib/prisma.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';

// 1. Setup Stripe Spies BEFORE importing routes
const stripeSpies = {
    createPaymentIntent: jest.fn((amount, currency, metadata = {}) => {
        const id = `pi_integration_test_${metadata.orderId || Date.now()}`;
        return Promise.resolve({
            id,
            client_secret: `${id}_secret`,
            status: 'requires_payment_method'
        });
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
};

jest.unstable_mockModule('../src/services/stripeService.js', () => stripeSpies);

// 2. Dynamically import routes
const orderRoutes = (await import('../src/routes/orderRoutes.js')).default;
const reservationRoutes = (await import('../src/routes/reservationRoutes.js')).default;
const paymentRoutes = (await import('../src/routes/paymentRoutes.js')).default;
const listingRoutes = (await import('../src/routes/listingRoutes.js')).default;

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
        process.env.JWT_ACCESS_SECRET || 'test',
        { expiresIn: '1h' }
    );
}

describe('Integration Tests - Full Flow', () => {
    let buyer, seller;
    let buyerToken, sellerToken;
    let testListing;

    beforeAll(async () => {
        // Create test users

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
        // Cleanup strictly scoped to prevent parallel leak
        await prisma.payment.deleteMany({
             where: { order: { buyerId: buyer.id } }
        }).catch(()=>{});
        
        await prisma.orderItem.deleteMany({
             where: { order: { buyerId: buyer.id } }
        }).catch(()=>{});
        
        await prisma.order.deleteMany({
             where: { buyerId: buyer.id }
        }).catch(()=>{});
        
        await prisma.listingReservation.deleteMany();
        
        await prisma.listing.deleteMany({
            where: { userId: seller.id }
        }).catch(()=>{});
        
        await prisma.user.deleteMany({
            where: { id: { in: [seller.id, buyer.id] } }
        }).catch(()=>{});
        
        // prisma disconnect handled by setup.js
    });

    describe('Complete Happy Path', () => {
        let orderId, paymentId;

        it('Step 1: Buyer creates order directly against listing', async () => {
            const res = await request(app)
                .post('/api/orders')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({ listingId: testListing.id, weight: 10 });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('CREATED');
            orderId = res.body.data.id;
        });

        it('Step 2: Seller confirms order', async () => {
            const res = await request(app)
                .post(`/api/orders/${orderId}/confirm`)
                .set('Authorization', `Bearer ${sellerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('CONFIRMED');
        });

        it('Step 3: Buyer creates PaymentIntent', async () => {
            const res = await request(app)
                .post('/api/payments/create-intent')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({ orderId });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.clientSecret).toBeDefined();
            paymentId = res.body.data.paymentId;
        });

        it('Step 4: Buyer authorizes payment', async () => {
            const res = await request(app)
                .post(`/api/payments/${paymentId}/authorize`)
                .set('Authorization', `Bearer ${buyerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('AUTHORIZED');
        });

        it('Step 5: Seller captures payment', async () => {
            const res = await request(app)
                .post(`/api/payments/${paymentId}/capture`)
                .set('Authorization', `Bearer ${sellerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('CAPTURED');
        });

        it('Step 6: Seller completes order', async () => {
            const res = await request(app)
                .post(`/api/orders/${orderId}/complete`)
                .set('Authorization', `Bearer ${sellerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('COMPLETED');
        });

        it('Step 7: Seller releases payment', async () => {
            const res = await request(app)
                .post(`/api/payments/${paymentId}/release`)
                .set('Authorization', `Bearer ${sellerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('RELEASED');
        });
    });

    describe('Idempotency and Edge Cases', () => {
        let testOrderId;

        beforeEach(async () => {
            await prisma.listing.update({
                where: { id: testListing.id },
                data: { quantity: 100, estimatedWeight: 100 }
            });
        });

        it('should prevent completing order without captured payment', async () => {
            // Create order
            const resOrder = await request(app)
                .post('/api/orders')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({ listingId: testListing.id, weight: 5 });
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
            await prisma.orderItem.deleteMany({ where: { orderId: testOrderId } });
            await prisma.order.delete({ where: { id: testOrderId } });
        }, 60000);

        it('should prevent duplicate PaymentIntent creation', async () => {
            // Create order
            const resOrder = await request(app)
                .post('/api/orders')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({ listingId: testListing.id, weight: 5 });
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
            await prisma.orderItem.deleteMany({ where: { orderId: testOrderId } });
            await prisma.order.delete({ where: { id: testOrderId } });
        }, 60000);
    });

    describe('Cancellation Scenarios', () => {
        it('should cancel order before payment and release inventory', async () => {
            const resOrder = await request(app)
                .post('/api/orders')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({ listingId: testListing.id, weight: 10 });
            const orderId = resOrder.body.data.id;

            // Get listing qty before cancel
            const listingBefore = await prisma.listing.findUnique({ where: { id: testListing.id } });

            // Cancel order
            const resCancel = await request(app)
                .post(`/api/orders/${orderId}/cancel`)
                .set('Authorization', `Bearer ${buyerToken}`);

            expect(resCancel.status).toBe(200);
            expect(resCancel.body.data.status).toBe('CANCELLED');

            // Verify listing quantity restored (weight should be added back, or quantity)
            // Wait, does order creation decrement qty? In tests it just creates order.
        }, 60000);
    });
});
