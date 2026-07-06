import { jest } from '@jest/globals';
import request from 'supertest';
import prisma from '../../../src/lib/prisma.js';
import jwt from 'jsonwebtoken';
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

describe('System E2E Workflow: Role-Based Authorization & Token Integrity Journey', () => {
    let individual;
    let collector;
    let warehouse;
    let individualToken;
    let collectorToken;
    let warehouseToken;

    beforeAll(async () => {
        individual = await createTestUser({
            email: `ind-auth-${Date.now()}@journey.com`,
            role: 'individual',
            emailVerified: true
        });

        collector = await createTestUser({
            email: `coll-auth-${Date.now()}@journey.com`,
            role: 'collector',
            emailVerified: true
        });

        warehouse = await createTestUser({
            email: `wh-auth-${Date.now()}@journey.com`,
            role: 'warehouse',
            emailVerified: true
        });

        individualToken = generateTestToken(individual);
        collectorToken = generateTestToken(collector);
        warehouseToken = generateTestToken(warehouse);
    });

    afterAll(async () => {
        await prisma.user.deleteMany({
            where: { id: { in: [individual.id, collector.id, warehouse.id] } }
        });
    });

    it('Workflow 1: Individual user is blocked from Admin endpoints', async () => {
        const res = await request(app)
            .get('/api/admin/users')
            .set('Authorization', `Bearer ${individualToken}`);

        expect(res.status).toBe(403);
    });

    it('Workflow 2: Individual user is blocked from Warehouse endpoints', async () => {
        const res = await request(app)
            .post('/api/warehouse/collector-tasks')
            .set('Authorization', `Bearer ${individualToken}`)
            .send({});

        expect(res.status).toBe(403);
    });

    it('Workflow 3: Collector user is blocked from Admin endpoints', async () => {
        const res = await request(app)
            .get('/api/admin/dashboard')
            .set('Authorization', `Bearer ${collectorToken}`);

        expect(res.status).toBe(403);
    });

    it('Workflow 4: Warehouse user is blocked from Admin endpoints', async () => {
        const res = await request(app)
            .get('/api/admin/users')
            .set('Authorization', `Bearer ${warehouseToken}`);

        expect(res.status).toBe(403);
    });

    it('Workflow 5: Request with an invalid JWT signature is rejected', async () => {
        const res = await request(app)
            .get('/api/user/profile')
            .set('Authorization', `Bearer invalid-token-string`);

        expect(res.status).toBe(401);
    });

    it('Workflow 6: Request with an expired JWT token is rejected', async () => {
        const secret = process.env.JWT_ACCESS_SECRET || 'test-secret-key-for-jest-testing';
        const expiredToken = jwt.sign(
            { userId: individual.id, email: individual.email, role: 'individual' },
            secret,
            { expiresIn: '-10s' }
        );

        const res = await request(app)
            .get('/api/user/profile')
            .set('Authorization', `Bearer ${expiredToken}`);

        expect(res.status).toBe(401);
    });
});
