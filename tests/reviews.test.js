import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import prisma from '../src/lib/prisma.js';
import { createTestUser, generateTestToken } from './helpers.js';

// Setup mock for socketGateway.js and firebaseService.js to prevent integration errors
beforeAll(async () => {
    jest.unstable_mockModule('../src/modules/chat/gateway/socketGateway.js', () => ({
        getIO: jest.fn().mockReturnValue({
            to: jest.fn().mockReturnThis(),
            emit: jest.fn()
        })
    }));
    jest.unstable_mockModule('../src/services/firebaseService.js', () => ({
        sendPushNotification: jest.fn().mockResolvedValue({ success: true })
    }));
});

const { default: app } = await import('../src/index.js');

describe('Order Reviews & Trust Score Integration Tests', () => {
    let buyer;
    let seller;
    let buyerToken;
    let sellerToken;
    let order;

    beforeAll(async () => {
        // Create buyer and seller
        buyer = await createTestUser({
            name: 'Eco Buyer',
            role: 'individual',
            ecoPoints: 0,
            currentLevel: 'Beginner Recycler',
        });
        seller = await createTestUser({
            name: 'Green Seller',
            role: 'individual',
            ecoPoints: 0,
            currentLevel: 'Beginner Recycler',
        });

        buyerToken = generateTestToken(buyer);
        sellerToken = generateTestToken(seller);

        // Create a completed order
        order = await prisma.order.create({
            data: {
                buyerId: buyer.id,
                sellerId: seller.id,
                status: 'COMPLETED',
                totalAmount: 1000,
                paymentMethod: 'cod',
                deliveryMethod: 'SELF_TRANSPORTATION',
            }
        });
    });

    afterAll(async () => {
        // Clean up review first due to relations
        await prisma.review.deleteMany({ where: { orderId: order.id } });
        await prisma.reward.deleteMany({ where: { userId: { in: [buyer.id, seller.id] } } });
        await prisma.badge.deleteMany({ where: { userId: { in: [buyer.id, seller.id] } } });
        await prisma.leaderboard.deleteMany({ where: { userId: { in: [buyer.id, seller.id] } } });
        await prisma.notification.deleteMany({ where: { userId: { in: [buyer.id, seller.id] } } });
        await prisma.order.delete({ where: { id: order.id } });
        await prisma.user.deleteMany({ where: { id: { in: [buyer.id, seller.id] } } });
    });

    it('should block non-buyers from reviewing the order', async () => {
        const res = await request(app)
            .post(`/api/orders/${order.id}/review`)
            .set('Authorization', `Bearer ${sellerToken}`)
            .send({ rating: 5, feedback: 'Excellent buyer!' });

        expect(res.statusCode).toBe(403);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toContain('Only the buyer');
    });

    it('should successfully submit a positive review and award points', async () => {
        const res = await request(app)
            .post(`/api/orders/${order.id}/review`)
            .set('Authorization', `Bearer ${buyerToken}`)
            .send({ rating: 5, feedback: 'Amazing recycling seller!' });

        expect(res.statusCode).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data.rating).toBe(5);

        // Check buyer received +5 points for submitting rating
        const updatedBuyer = await prisma.user.findUnique({ where: { id: buyer.id } });
        expect(updatedBuyer.ecoPoints).toBe(5);

        // Check seller received +10 points for positive review received
        const updatedSeller = await prisma.user.findUnique({ where: { id: seller.id } });
        expect(updatedSeller.ecoPoints).toBe(10);
    });

    it('should block duplicate review submission for same order', async () => {
        const res = await request(app)
            .post(`/api/orders/${order.id}/review`)
            .set('Authorization', `Bearer ${buyerToken}`)
            .send({ rating: 4, feedback: 'Another feedback' });

        expect(res.statusCode).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toContain('already reviewed');
    });

    it('should calculate trustScore correctly in user rewards status', async () => {
        // Seller has 1 completed order (worth 2 points) and 1 positive rating (worth 1 point) -> Trust Score = 3
        const res = await request(app)
            .get('/api/rewards/status')
            .set('Authorization', `Bearer ${sellerToken}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.trustScore).toBe(3); // (1 order * 2) + (1 positive rating * 1) = 3
    });
});
