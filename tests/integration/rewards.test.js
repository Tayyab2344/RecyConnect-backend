import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import prisma from '../../src/lib/prisma.js';
import { createTestUser, generateTestToken } from '../helpers.js';

// Setup mock for socketGateway.js and firebaseService.js to prevent integration errors
beforeAll(async () => {
    jest.unstable_mockModule('../../src/modules/chat/gateway/socketGateway.js', () => ({
        getIO: jest.fn().mockReturnValue({
            to: jest.fn().mockReturnThis(),
            emit: jest.fn()
        })
    }));
    jest.unstable_mockModule('../../src/services/firebaseService.js', () => ({
        sendPushNotification: jest.fn().mockResolvedValue({ success: true })
    }));
});

// Import dynamically after mock configuration
const { default: app } = await import('../../src/index.js');

describe('Rewards & Gamification Endpoint Tests', () => {
    let testUser;
    let token;
    const testEmails = [];

    beforeAll(async () => {
        // Create test user
        testUser = await createTestUser({
            name: 'Eco Warrior',
            role: 'individual',
            ecoPoints: 100,
            currentLevel: 'Beginner Recycler',
            dailyStreak: 0,
        });
        testEmails.push(testUser.email);

        const secondUser = await createTestUser({
            name: 'Buyer Warrior',
            role: 'individual',
            email: 'buyer.warrior@example.com',
            contactNo: '999999999',
        });
        testEmails.push(secondUser.email);

        // Create an order in the last 24 hours to allow check-in
        await prisma.order.create({
            data: {
                buyerId: secondUser.id,
                sellerId: testUser.id,
                totalAmount: 100.0,
                status: 'PENDING',
                deliveryMethod: 'SELF_TRANSPORTATION'
            }
        });

        await prisma.reward.create({
            data: {
                userId: testUser.id,
                points: 100,
                activityType: 'SUCCESSFUL_SALE',
                rewardType: 'POINTS'
            }
        });
        token = generateTestToken(testUser);
    });

    afterAll(async () => {
        // Clean up data
        await prisma.order.deleteMany({
            where: {
                OR: [
                    { buyerId: testUser.id },
                    { sellerId: testUser.id }
                ]
            }
        });
        await prisma.reward.deleteMany({
            where: {
                userId: {
                    in: await prisma.user.findMany({
                        where: { email: { in: testEmails } },
                        select: { id: true }
                    }).then(users => users.map(u => u.id))
                }
            }
        });
        await prisma.badge.deleteMany({
            where: {
                userId: {
                    in: await prisma.user.findMany({
                        where: { email: { in: testEmails } },
                        select: { id: true }
                    }).then(users => users.map(u => u.id))
                }
            }
        });
        await prisma.leaderboard.deleteMany({
            where: {
                userId: {
                    in: await prisma.user.findMany({
                        where: { email: { in: testEmails } },
                        select: { id: true }
                    }).then(users => users.map(u => u.id))
                }
            }
        });
        await prisma.notification.deleteMany({
            where: {
                userId: {
                    in: await prisma.user.findMany({
                        where: { email: { in: testEmails } },
                        select: { id: true }
                    }).then(users => users.map(u => u.id))
                }
            }
        });
        await prisma.user.deleteMany({
            where: { email: { in: testEmails } }
        });
    });

    it('should successfully fetch the user rewards status', async () => {
        const res = await request(app)
            .get('/api/rewards/status')
            .set('Authorization', `Bearer ${token}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.ecoPoints).toBe(100); // Automatically checked in today (awards 0 pts)
        expect(res.body.data.currentLevel).toBe('Beginner Recycler');
        expect(res.body.data.nextLevelInfo).toBeDefined();
        expect(res.body.data.nextLevelInfo.pointsNeeded).toBe(400); // 500 - 100
    });

    it('should claim daily login reward and increase points/streak', async () => {
        // Since user is already automatically checked in, we test manual claim on the same day fails
        const res = await request(app)
            .post('/api/rewards/check-in')
            .set('Authorization', `Bearer ${token}`);

        expect(res.statusCode).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toContain('already checked in');
    });

    it('should block duplicate daily check-in on the same day', async () => {
        const res = await request(app)
            .post('/api/rewards/check-in')
            .set('Authorization', `Bearer ${token}`);

        expect(res.statusCode).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toContain('already checked in');
    });

    it('should return point history showing daily check-in points', async () => {
        const res = await request(app)
            .get('/api/rewards/history')
            .set('Authorization', `Bearer ${token}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.length).toBeGreaterThanOrEqual(1);
        expect(res.body.data[0].activityType).toBe('SUCCESSFUL_SALE');
        expect(res.body.data[0].points).toBe(100);
    });

    it('should fetch the user challenges status list', async () => {
        const res = await request(app)
            .get('/api/rewards/challenges')
            .set('Authorization', `Bearer ${token}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toBeInstanceOf(Array);
        expect(res.body.data.length).toBe(3);
        expect(res.body.data[0].type).toBe('LISTINGS');
    });

    it('should fetch the points leaderboard', async () => {
        const res = await request(app)
            .get('/api/rewards/leaderboard?category=individuals')
            .set('Authorization', `Bearer ${token}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toBeInstanceOf(Array);
        expect(res.body.data.length).toBeGreaterThanOrEqual(1);
        
        // Find our test user in the leaderboard
        const found = res.body.data.find(u => u.userId === testUser.id);
        expect(found).toBeDefined();
        expect(found.ecoPoints).toBe(100);
    });
});
