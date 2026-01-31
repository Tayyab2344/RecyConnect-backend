/**
 * Payment Controller Integration Tests
 * Tests: Stripe PaymentIntent flow - create, authorize, capture, release, refund
 */
import 'dotenv/config';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();

// Import routes
import paymentRoutes from '../src/routes/paymentRoutes.js';
import orderRoutes from '../src/routes/orderRoutes.js';

// Mock Stripe service for testing
jest.mock('../src/services/stripeService.js', () => ({
    createPaymentIntent: jest.fn().mockResolvedValue({
        id: 'pi_test_123456',
        client_secret: 'pi_test_123456_secret_test',
        status: 'requires_payment_method'
    }),
    retrievePaymentIntent: jest.fn().mockResolvedValue({
        id: 'pi_test_123456',
        status: 'requires_capture',
        payment_method_types: ['card']
    }),
    capturePaymentIntent: jest.fn().mockResolvedValue({
        id: 'pi_test_123456',
        status: 'succeeded'
    }),
    cancelPaymentIntent: jest.fn().mockResolvedValue({
        id: 'pi_test_123456',
        status: 'canceled'
    }),
    createRefund: jest.fn().mockResolvedValue({
        id: 're_test_123456',
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
app.use('/api/payments', paymentRoutes);
app.use('/api/orders', orderRoutes);

// Helper to generate token
function generateToken(user) {
    return jwt.sign(
        { userId: user.id, email: user.email, role: user.role },
        process.env.JWT_ACCESS_SECRET,
        { expiresIn: '1h' }
    );
}

describe('Payment Controller - Stripe Integration', () => {
    let buyer, seller;
    let buyerToken, sellerToken;
    let testListing, testOrder;

    beforeAll(async () => {
        // Create test users
        const hashedPassword = await bcrypt.hash('TestPassword123!', 10);

        seller = await prisma.user.create({
            data: {
                name: 'Payment Test Seller',
                email: `paymenttestseller${Date.now()}@test.com`,
                password: hashedPassword,
                role: 'individual',
                emailVerified: true
            }
        });

        buyer = await prisma.user.create({
            data: {
                name: 'Payment Test Buyer',
                email: `paymenttestbuyer${Date.now()}@test.com`,
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
                price: 100.0,
                quantity: 100,
                status: 'PUBLISHED',
                images: []
            }
        });

        // Create a CONFIRMED order
        testOrder = await prisma.order.create({
            data: {
                buyerId: buyer.id,
                sellerId: seller.id,
                status: 'CONFIRMED',
                totalAmount: 500,
                items: {
                    create: {
                        listingId: testListing.id,
                        quantity: 5,
                        price: 100
                    }
                }
            }
        });
    });

    afterAll(async () => {
        // Cleanup
        await prisma.payment.deleteMany({
            where: { orderId: testOrder?.id }
        });
        await prisma.orderItem.deleteMany({
            where: { orderId: testOrder?.id }
        });
        await prisma.order.deleteMany({
            where: { id: testOrder?.id }
        });
        await prisma.listing.deleteMany({
            where: { userId: seller?.id }
        });
        await prisma.user.deleteMany({
            where: { email: { contains: 'paymenttestbuyer' } }
        });
        await prisma.user.deleteMany({
            where: { email: { contains: 'paymenttestseller' } }
        });
        await prisma.$disconnect();
    });

    describe('POST /api/payments/create-intent', () => {
        afterEach(async () => {
            // Clean up any payments created
            await prisma.payment.deleteMany({
                where: { orderId: testOrder.id }
            });
        });

        it('should fail without authentication', async () => {
            const res = await request(app)
                .post('/api/payments/create-intent')
                .send({ orderId: testOrder.id });

            expect([401, 403]).toContain(res.status);
        });

        it('should fail without orderId', async () => {
            const res = await request(app)
                .post('/api/payments/create-intent')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({});

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Order ID is required');
        });

        it('should fail if user is not the buyer', async () => {
            const res = await request(app)
                .post('/api/payments/create-intent')
                .set('Authorization', `Bearer ${sellerToken}`)
                .send({ orderId: testOrder.id });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Only the buyer can initiate payment');
        });

        it('should fail if order is not CONFIRMED', async () => {
            // Create a CREATED order
            const createdOrder = await prisma.order.create({
                data: {
                    buyerId: buyer.id,
                    sellerId: seller.id,
                    status: 'CREATED',
                    totalAmount: 200,
                    items: {
                        create: {
                            listingId: testListing.id,
                            quantity: 2,
                            price: 100
                        }
                    }
                }
            });

            const res = await request(app)
                .post('/api/payments/create-intent')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({ orderId: createdOrder.id });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Order status must be CONFIRMED');

            // Cleanup
            await prisma.orderItem.deleteMany({ where: { orderId: createdOrder.id } });
            await prisma.order.delete({ where: { id: createdOrder.id } });
        });

        it('should create PaymentIntent successfully', async () => {
            const res = await request(app)
                .post('/api/payments/create-intent')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({ orderId: testOrder.id });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.clientSecret).toBeDefined();
            expect(res.body.data.paymentIntentId).toBe('pi_test_123456');
            expect(res.body.data.amount).toBe(500);

            // Verify payment record exists
            const payment = await prisma.payment.findUnique({
                where: { orderId: testOrder.id }
            });
            expect(payment).toBeDefined();
            expect(payment.status).toBe('INITIATED');
        });

        it('should fail if payment already exists for order', async () => {
            // First create a payment
            await prisma.payment.create({
                data: {
                    orderId: testOrder.id,
                    amount: 500,
                    currency: 'PKR',
                    provider: 'STRIPE',
                    status: 'INITIATED',
                    paymentIntentId: 'pi_existing_123'
                }
            });

            const res = await request(app)
                .post('/api/payments/create-intent')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({ orderId: testOrder.id });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Payment already exists');
        });
    });

    describe('POST /api/payments/:id/authorize', () => {
        let testPayment;

        beforeEach(async () => {
            testPayment = await prisma.payment.create({
                data: {
                    orderId: testOrder.id,
                    amount: 500,
                    currency: 'PKR',
                    provider: 'STRIPE',
                    status: 'INITIATED',
                    paymentIntentId: 'pi_test_123456'
                }
            });
        });

        afterEach(async () => {
            await prisma.payment.deleteMany({
                where: { orderId: testOrder.id }
            });
        });

        it('should authorize payment successfully', async () => {
            const res = await request(app)
                .post(`/api/payments/${testPayment.id}/authorize`)
                .set('Authorization', `Bearer ${buyerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('AUTHORIZED');
        });

        it('should fail if already authorized', async () => {
            await prisma.payment.update({
                where: { id: testPayment.id },
                data: { status: 'AUTHORIZED' }
            });

            const res = await request(app)
                .post(`/api/payments/${testPayment.id}/authorize`)
                .set('Authorization', `Bearer ${buyerToken}`);

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Cannot authorize payment');
        });
    });

    describe('POST /api/payments/:id/capture', () => {
        let testPayment;

        beforeEach(async () => {
            testPayment = await prisma.payment.create({
                data: {
                    orderId: testOrder.id,
                    amount: 500,
                    currency: 'PKR',
                    provider: 'STRIPE',
                    status: 'AUTHORIZED',
                    paymentIntentId: 'pi_test_123456'
                }
            });
        });

        afterEach(async () => {
            await prisma.payment.deleteMany({
                where: { orderId: testOrder.id }
            });
        });

        it('should capture payment successfully', async () => {
            const res = await request(app)
                .post(`/api/payments/${testPayment.id}/capture`)
                .set('Authorization', `Bearer ${sellerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('CAPTURED');
        });

        it('should fail if not seller', async () => {
            const res = await request(app)
                .post(`/api/payments/${testPayment.id}/capture`)
                .set('Authorization', `Bearer ${buyerToken}`);

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Only the seller can capture');
        });

        it('should fail if not AUTHORIZED', async () => {
            await prisma.payment.update({
                where: { id: testPayment.id },
                data: { status: 'INITIATED' }
            });

            const res = await request(app)
                .post(`/api/payments/${testPayment.id}/capture`)
                .set('Authorization', `Bearer ${sellerToken}`);

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Must be AUTHORIZED');
        });
    });

    describe('POST /api/payments/:id/release', () => {
        let testPayment;

        beforeEach(async () => {
            // Update order to COMPLETED
            await prisma.order.update({
                where: { id: testOrder.id },
                data: { status: 'COMPLETED' }
            });

            testPayment = await prisma.payment.create({
                data: {
                    orderId: testOrder.id,
                    amount: 500,
                    currency: 'PKR',
                    provider: 'STRIPE',
                    status: 'CAPTURED',
                    paymentIntentId: 'pi_test_123456'
                }
            });
        });

        afterEach(async () => {
            await prisma.payment.deleteMany({
                where: { orderId: testOrder.id }
            });
            // Reset order status
            await prisma.order.update({
                where: { id: testOrder.id },
                data: { status: 'CONFIRMED' }
            });
        });

        it('should release payment successfully', async () => {
            const res = await request(app)
                .post(`/api/payments/${testPayment.id}/release`)
                .set('Authorization', `Bearer ${sellerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('RELEASED');
        });

        it('should fail if order not COMPLETED', async () => {
            await prisma.order.update({
                where: { id: testOrder.id },
                data: { status: 'CONFIRMED' }
            });

            const res = await request(app)
                .post(`/api/payments/${testPayment.id}/release`)
                .set('Authorization', `Bearer ${sellerToken}`);

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Order status must be COMPLETED');
        });
    });

    describe('POST /api/payments/:id/refund', () => {
        let testPayment;

        beforeEach(async () => {
            // Update order to CANCELLED
            await prisma.order.update({
                where: { id: testOrder.id },
                data: { status: 'CANCELLED' }
            });

            testPayment = await prisma.payment.create({
                data: {
                    orderId: testOrder.id,
                    amount: 500,
                    currency: 'PKR',
                    provider: 'STRIPE',
                    status: 'CAPTURED',
                    paymentIntentId: 'pi_test_123456'
                }
            });
        });

        afterEach(async () => {
            await prisma.payment.deleteMany({
                where: { orderId: testOrder.id }
            });
            // Reset order status
            await prisma.order.update({
                where: { id: testOrder.id },
                data: { status: 'CONFIRMED' }
            });
        });

        it('should refund payment successfully', async () => {
            const res = await request(app)
                .post(`/api/payments/${testPayment.id}/refund`)
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({ reason: 'requested_by_customer' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('REFUNDED');
        });

        it('should fail if order not CANCELLED', async () => {
            await prisma.order.update({
                where: { id: testOrder.id },
                data: { status: 'CONFIRMED' }
            });

            const res = await request(app)
                .post(`/api/payments/${testPayment.id}/refund`)
                .set('Authorization', `Bearer ${buyerToken}`);

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Order must be CANCELLED');
        });

        it('should fail if payment already RELEASED', async () => {
            await prisma.payment.update({
                where: { id: testPayment.id },
                data: { status: 'RELEASED' }
            });

            const res = await request(app)
                .post(`/api/payments/${testPayment.id}/refund`)
                .set('Authorization', `Bearer ${buyerToken}`);

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Cannot refund payment after it has been released');
        });
    });

    describe('GET /api/payments/order/:orderId', () => {
        let testPayment;

        beforeEach(async () => {
            testPayment = await prisma.payment.create({
                data: {
                    orderId: testOrder.id,
                    amount: 500,
                    currency: 'PKR',
                    provider: 'STRIPE',
                    status: 'CAPTURED',
                    paymentIntentId: 'pi_test_123456'
                }
            });
        });

        afterEach(async () => {
            await prisma.payment.deleteMany({
                where: { orderId: testOrder.id }
            });
        });

        it('should get payment status successfully', async () => {
            const res = await request(app)
                .get(`/api/payments/order/${testOrder.id}`)
                .set('Authorization', `Bearer ${buyerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.id).toBe(testPayment.id);
            expect(res.body.data.status).toBe('CAPTURED');
        });

        it('should return 404 for non-existent payment', async () => {
            const res = await request(app)
                .get('/api/payments/order/999999')
                .set('Authorization', `Bearer ${buyerToken}`);

            expect(res.status).toBe(404);
        });
    });
});
