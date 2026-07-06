import { jest } from '@jest/globals';
import request from 'supertest';
import prisma from '../../../src/lib/prisma.js';
import { createTestUser, generateTestToken, createAdminUser } from '../../helpers.js';

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

describe('System E2E Workflow: Admin Moderation Journey', () => {
    let admin;
    let user;
    let adminToken;
    let userToken;

    beforeAll(async () => {
        admin = await createAdminUser();
        user = await createTestUser({
            name: 'Regular User',
            email: `reg-admin-${Date.now()}@journey.com`,
            role: 'individual',
            emailVerified: true
        });

        adminToken = generateTestToken(admin);
        userToken = generateTestToken(user);
    });

    afterAll(async () => {
        await prisma.user.deleteMany({
            where: { id: { in: [admin.id, user.id] } }
        });
    });

    it('Workflow 1: Admin retrieves list of all users', async () => {
        const res = await request(app)
            .get('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    });

    it('Workflow 2: Admin retrieves list of all orders', async () => {
        const res = await request(app)
            .get('/api/admin/orders')
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('Workflow 3: Admin suspends a user, blocking their API access', async () => {
        // Suspend the user
        const suspendRes = await request(app)
            .put(`/api/admin/users/${user.id}/suspend`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ suspended: true });

        expect(suspendRes.status).toBe(200);
        expect(suspendRes.body.success).toBe(true);

        // Verify suspended user cannot access a protected route
        const accessRes = await request(app)
            .get('/api/user/profile')
            .set('Authorization', `Bearer ${userToken}`);

        expect(accessRes.status).toBe(403);
        expect(accessRes.body.message).toContain('suspended');
    });

    it('Workflow 4: Admin unsuspends user, restoring API access', async () => {
        // Unsuspend user
        const unsuspendRes = await request(app)
            .put(`/api/admin/users/${user.id}/suspend`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ suspended: false });

        expect(unsuspendRes.status).toBe(200);
        expect(unsuspendRes.body.success).toBe(true);

        // Verify user can access profile again
        const accessRes = await request(app)
            .get('/api/user/profile')
            .set('Authorization', `Bearer ${userToken}`);

        expect(accessRes.status).toBe(200);
        expect(accessRes.body.success).toBe(true);
    });
});
