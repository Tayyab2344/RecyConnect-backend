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

async function waitForNotificationByType(userId, type) {
    for (let i = 0; i < 15; i++) {
        const notif = await prisma.notification.findFirst({
            where: { userId, type },
            orderBy: { createdAt: 'desc' }
        });
        if (notif) {
            return notif;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return null;
}

describe('System E2E Workflow: Notifications Journey', () => {
    let buyer;
    let seller;
    let buyerToken;
    let sellerToken;
    let listing;
    let orderId;

    beforeAll(async () => {
        buyer = await createTestUser({
            name: 'Notification Buyer',
            email: `buyer-notif-${Date.now()}@journey.com`,
            role: 'individual',
            emailVerified: true
        });

        seller = await createTestUser({
            name: 'Notification Seller',
            email: `seller-notif-${Date.now()}@journey.com`,
            role: 'individual',
            emailVerified: true
        });

        buyerToken = generateTestToken(buyer);
        sellerToken = generateTestToken(seller);

        listing = await createTestListing(seller.id, {
            materialType: 'PLASTIC',
            estimatedWeight: 20.0,
            status: 'PUBLISHED',
            category: 'PLASTIC'
        });
    });

    afterAll(async () => {
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
        await prisma.notification.deleteMany({
            where: { userId: { in: [buyer.id, seller.id] } }
        }).catch(() => {});
        await prisma.user.deleteMany({
            where: { id: { in: [buyer.id, seller.id] } }
        }).catch(() => {});
    });

    it('Workflow 1: Order creation triggers notification record in database for seller', async () => {
        const res = await request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${buyerToken}`)
            .send({
                listingId: listing.id,
                weight: 10.0,
                paymentMethod: 'cod',
                deliveryMethod: 'SELF_TRANSPORTATION'
            });

        expect(res.status).toBe(201);
        orderId = res.body.data.id;

        // Verify notification was created in database for the seller
        const dbNotif = await waitForNotificationByType(seller.id, 'ORDER');
        expect(dbNotif).not.toBeNull();
        expect(dbNotif.title.toLowerCase()).toContain('new order');
    });

    it('Workflow 2: Sending a chat message triggers notification record for recipient', async () => {
        // Retrieve the conversation automatically created during order creation
        const conversation = await prisma.conversation.findFirst({
            where: { orderId }
        });
        expect(conversation).not.toBeNull();

        // Send a message from seller to buyer
        const res = await request(app)
            .post('/api/chat/messages')
            .set('Authorization', `Bearer ${sellerToken}`)
            .send({
                conversationId: conversation.id,
                content: 'Hello! I received your order.'
            });

        expect(res.status).toBe(201);

        // Verify notification was created for the buyer regarding the new message
        const dbNotif = await waitForNotificationByType(buyer.id, 'CHAT_MESSAGE');
        expect(dbNotif).not.toBeNull();
        expect(dbNotif.title).toBe(seller.name);
        expect(dbNotif.message).toBe('Hello! I received your order.');
    });
});
