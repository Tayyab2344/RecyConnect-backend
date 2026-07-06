import { jest } from '@jest/globals';
import request from 'supertest';
import prisma from '../../../src/lib/prisma.js';
import { createTestUser, generateTestToken } from '../../helpers.js';

// Setup ES module mocks at the top level
jest.unstable_mockModule('../../../src/lib/redis.js', () => ({
    invalidateCache: jest.fn().mockResolvedValue(),
    getCache: jest.fn().mockResolvedValue(null),
    setCache: jest.fn().mockResolvedValue(),
    deleteCache: jest.fn().mockResolvedValue(),
    default: { get: jest.fn(), setex: jest.fn() },
    isRedisConnected: jest.fn().mockReturnValue(false)
}));

const { default: app } = await import('../../../src/index.js');

describe('System E2E Workflow: Failure Scenarios & Robustness', () => {
    let user;
    let token;

    beforeAll(async () => {
        user = await createTestUser({
            name: 'Failure Tester',
            email: `fail-test-${Date.now()}@journey.com`,
            role: 'individual',
            emailVerified: true
        });

        token = generateTestToken(user);
    });

    afterAll(async () => {
        await prisma.user.deleteMany({ where: { id: user.id } });
    });

    it('Scenario 1: Fetching listing with a non-existent ID returns 404', async () => {
        const res = await request(app)
            .get('/api/listings/999999')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
    });

    it('Scenario 2: Fetching order with a non-existent ID returns 404', async () => {
        const res = await request(app)
            .get('/api/orders/999999')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
    });

    it('Scenario 3: Placing order with missing listingId returns 400 validation error', async () => {
        const res = await request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${token}`)
            .send({
                weight: 5.0,
                paymentMethod: 'cod',
                deliveryMethod: 'SELF_TRANSPORTATION'
            });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it('Scenario 4: Creating listing with invalid negative weight returns 400', async () => {
        const res = await request(app)
            .post('/api/listings')
            .set('Authorization', `Bearer ${token}`)
            .send({
                materialType: 'Plastic',
                estimatedWeight: -10,
                pickupAddress: 'Lahore Address',
                images: ['http://mock.img']
            });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it('Scenario 5: Creating payment intent for non-existent order returns 400', async () => {
        const res = await request(app)
            .post('/api/payments/create-intent')
            .set('Authorization', `Bearer ${token}`)
            .send({ orderId: 999999 });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });
});
