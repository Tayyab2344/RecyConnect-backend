import { jest } from '@jest/globals';
import request from 'supertest';
import prisma from '../../../src/lib/prisma.js';
import { createTestUser, generateTestToken, createTestListing } from '../../helpers.js';

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

const { default: app } = await import('../../../src/index.js');

describe('System E2E Workflow: Order Lifecycle Journey', () => {
    let seller;
    let buyer;
    let sellerToken;
    let buyerToken;
    let listing;
    let orderId;

    beforeAll(async () => {
        seller = await createTestUser({
            name: 'Order Seller',
            email: `seller-ord-${Date.now()}@journey.com`,
            role: 'individual',
            emailVerified: true
        });

        buyer = await createTestUser({
            name: 'Order Buyer',
            email: `buyer-ord-${Date.now()}@journey.com`,
            role: 'individual',
            emailVerified: true
        });

        sellerToken = generateTestToken(seller);
        buyerToken = generateTestToken(buyer);

        listing = await createTestListing(seller.id, {
            materialType: 'PLASTIC',
            estimatedWeight: 10.0,
            pickupAddress: 'Sector D, Lahore',
            status: 'PUBLISHED',
            category: 'PLASTIC'
        });
    });

    afterAll(async () => {
        // Clean up database records
        if (orderId) {
            await prisma.orderItem.deleteMany({ where: { orderId } }).catch(() => {});
            await prisma.order.deleteMany({ where: { id: orderId } }).catch(() => {});
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
            where: { id: { in: [seller.id, buyer.id] } }
        }).catch(() => {});
    });

    it('Workflow 1: Buyer creates/places an order on listing', async () => {
        const res = await request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${buyerToken}`)
            .send({
                listingId: listing.id,
                weight: 5.0,
                paymentMethod: 'cod',
                deliveryMethod: 'SELF_TRANSPORTATION'
            });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty('id');
        expect(res.body.data.status).toBe('CREATED');

        orderId = res.body.data.id;

        // Verify DB updates
        const dbOrder = await prisma.order.findUnique({ where: { id: orderId } });
        expect(dbOrder).not.toBeNull();
        expect(dbOrder.buyerId).toBe(buyer.id);
        expect(dbOrder.sellerId).toBe(seller.id);
    });

    it('Workflow 2: Seller accepts and confirms the order', async () => {
        const res = await request(app)
            .post(`/api/orders/${orderId}/confirm`)
            .set('Authorization', `Bearer ${sellerToken}`)
            .send();

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.status).toBe('CONFIRMED');

        // Verify DB update
        const dbOrder = await prisma.order.findUnique({ where: { id: orderId } });
        expect(dbOrder.status).toBe('CONFIRMED');
    });

    it('Workflow 3: Buyer retrieves order listing history', async () => {
        const res = await request(app)
            .get('/api/orders/buyer')
            .set('Authorization', `Bearer ${buyerToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.length).toBeGreaterThanOrEqual(1);

        const foundOrder = res.body.data.find(o => o.id === orderId);
        expect(foundOrder).toBeDefined();
        expect(foundOrder.seller.name).toBe('Order Seller');
    });
});
