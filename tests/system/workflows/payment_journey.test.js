import { jest } from '@jest/globals';
import request from 'supertest';
import prisma from '../../../src/lib/prisma.js';
import { createTestUser, generateTestToken, createTestListing, createTestOrder } from '../../helpers.js';

// Setup ES module mocks at the top level
jest.unstable_mockModule('../../../src/lib/redis.js', () => ({
    invalidateCache: jest.fn().mockResolvedValue(),
    getCache: jest.fn().mockResolvedValue(null),
    setCache: jest.fn().mockResolvedValue(),
    deleteCache: jest.fn().mockResolvedValue(),
    default: { get: jest.fn(), setex: jest.fn() },
    isRedisConnected: jest.fn().mockReturnValue(false)
}));

jest.unstable_mockModule('../../../src/services/firebaseService.js', () => ({
    sendPushNotification: jest.fn().mockResolvedValue({ success: true })
}));

jest.unstable_mockModule('../../../src/services/stripeService.js', () => ({
    createPaymentIntent: jest.fn().mockResolvedValue({
        id: 'pi_test_123',
        status: 'requires_payment_method',
        client_secret: 'secret_123'
    }),
    retrievePaymentIntent: jest.fn().mockImplementation((id) => {
        if (global.__stripeStatusOverride) {
            return Promise.resolve({ id, status: global.__stripeStatusOverride });
        }
        return Promise.resolve({ id, status: 'requires_capture' });
    }),
    capturePaymentIntent: jest.fn().mockResolvedValue({
        id: 'pi_test_123',
        status: 'succeeded'
    }),
    cancelPaymentIntent: jest.fn().mockResolvedValue({
        id: 'pi_test_123',
        status: 'canceled'
    }),
    createRefund: jest.fn().mockResolvedValue({
        id: 're_test_123',
        status: 'succeeded'
    }),
    mapStripeStatusToPaymentStatus: jest.fn().mockImplementation((stripeStatus) => {
        const statusMap = {
            'requires_payment_method': 'INITIATED',
            'requires_capture': 'AUTHORIZED',
            'canceled': 'FAILED',
            'succeeded': 'CAPTURED'
        };
        return statusMap[stripeStatus] || 'INITIATED';
    })
}));

const { default: app } = await import('../../../src/index.js');

describe('System E2E Workflow: Payment Lifecycle Journey', () => {
    let buyer;
    let seller;
    let buyerToken;
    let sellerToken;
    let listing;
    let order;
    let paymentId;

    beforeAll(async () => {
        buyer = await createTestUser({
            name: 'Wholesale Buyer',
            email: `buyer-pay-${Date.now()}@journey.com`,
            role: 'warehouse',
            emailVerified: true
        });

        seller = await createTestUser({
            name: 'Wholesale Seller',
            email: `seller-pay-${Date.now()}@journey.com`,
            role: 'warehouse',
            emailVerified: true
        });

        buyerToken = generateTestToken(buyer);
        sellerToken = generateTestToken(seller);

        listing = await createTestListing(seller.id, {
            materialType: 'PLASTIC',
            estimatedWeight: 500,
            price: 2.0,
            status: 'PUBLISHED',
            category: 'PLASTIC'
        });

        order = await createTestOrder(buyer.id, seller.id, listing.id, {
            materialType: 'PLASTIC',
            weight: 500,
            status: 'CONFIRMED',
            paymentMethod: 'ONLINE',
            totalAmount: 1000.0
        });
    });

    afterAll(async () => {
        if (paymentId) {
            await prisma.payment.deleteMany({ where: { id: paymentId } }).catch(() => {});
        }
        if (order) {
            await prisma.orderItem.deleteMany({ where: { orderId: order.id } }).catch(() => {});
            await prisma.order.deleteMany({ where: { id: order.id } }).catch(() => {});
        }
        if (listing) {
            await prisma.listing.deleteMany({ where: { id: listing.id } }).catch(() => {});
        }
        if (seller) {
            await prisma.listing.deleteMany({ where: { userId: seller.id } }).catch(() => {});
        }
        if (buyer && seller) {
            const userIds = [buyer.id, seller.id];
            await prisma.message.deleteMany({
                where: { conversation: { OR: [ { participant1Id: { in: userIds } }, { participant2Id: { in: userIds } } ] } }
            }).catch(() => {});
            await prisma.conversation.deleteMany({
                where: { OR: [ { participant1Id: { in: userIds } }, { participant2Id: { in: userIds } } ] }
            }).catch(() => {});
        }
        if (buyer && seller) {
            await prisma.notification.deleteMany({
                where: { userId: { in: [buyer.id, seller.id] } }
            }).catch(() => {});
        }
        await prisma.user.deleteMany({
            where: { id: { in: [buyer.id, seller.id] } }
        }).catch(() => {});
    });

    it('Workflow 1: Create Stripe PaymentIntent for confirmed order', async () => {
        const res = await request(app)
            .post('/api/payments/create-intent')
            .set('Authorization', `Bearer ${buyerToken}`)
            .send({ orderId: order.id });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty('paymentId');
        expect(res.body.data.paymentIntentId).toBe('pi_test_123');

        paymentId = res.body.data.paymentId;

        // Verify record in Database
        const dbPayment = await prisma.payment.findUnique({ where: { id: paymentId } });
        expect(dbPayment).not.toBeNull();
        expect(dbPayment.status).toBe('INITIATED');
        expect(dbPayment.amount).toBe(1000.0);
    });

    it('Workflow 2: Authorize payment after successful client payment authorization', async () => {
        global.__stripeStatusOverride = 'requires_capture';

        const res = await request(app)
            .post(`/api/payments/${paymentId}/authorize`)
            .set('Authorization', `Bearer ${buyerToken}`)
            .send();

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.status).toBe('AUTHORIZED');
    });

    it('Workflow 3: Capture the payment (Seller action)', async () => {
        global.__stripeStatusOverride = 'succeeded';

        const res = await request(app)
            .post(`/api/payments/${paymentId}/capture`)
            .set('Authorization', `Bearer ${sellerToken}`)
            .send();

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.status).toBe('CAPTURED');
    });

    it('Workflow 4: Complete order and release/settle payment funds to seller', async () => {
        await prisma.order.update({
            where: { id: order.id },
            data: { status: 'COMPLETED' }
        });

        const res = await request(app)
            .post(`/api/payments/${paymentId}/release`)
            .set('Authorization', `Bearer ${sellerToken}`)
            .send();

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.status).toBe('RELEASED');

        const dbPayment = await prisma.payment.findUnique({
            where: { id: paymentId }
        });
        expect(dbPayment).not.toBeNull();
        expect(dbPayment.status).toBe('RELEASED');
    });
});
