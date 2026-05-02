import 'dotenv/config';
import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';
import prisma from '../src/lib/prisma.js';
import jwt from 'jsonwebtoken';
import { traceMiddleware } from '../src/middlewares/traceMiddleware.js';

jest.unstable_mockModule('../src/lib/redis.js', () => ({
    invalidateCache: jest.fn().mockResolvedValue(),
    default: { get: jest.fn(), setex: jest.fn() },
    isRedisConnected: jest.fn().mockReturnValue(false)
}));

describe('System E2E Tests: Bootstrap Integration', () => {
    let app;
    let mockUser;
    let mockEmail;
    
    beforeAll(async () => {
        mockEmail = `e2e-${Date.now()}@test.recyconnect.com`;

        // Assemble dummy express pipeline combining Trace logic and the route
        app = express();
        app.use(express.json());
        
        // Inject Phase 7 Tracing Layer
        app.use(traceMiddleware);
        
        // Import the bootstrap route dynamically after mocks are loaded
        const appRoutes = (await import('../src/routes/appRoutes.js')).default;
        app.use('/api/app', appRoutes);
        
        // Create Mock User directly bypassing auth pipeline
        mockUser = await prisma.user.create({
            data: {
                name: 'E2E Tester',
                email: mockEmail,
                password: 'hash',
                role: 'individual',
                emailVerified: true
            }
        });
    });

    afterAll(async () => {
        await prisma.user.deleteMany({ where: { email: mockEmail } }).catch(() => {});
        // prisma disconnect handled by setup.js
    });

    it('GET /api/app/bootstrap - Returns combined system payload & trace injection', async () => {
        // Generate valid mock JWT
         const validToken = jwt.sign(
            { userId: mockUser.id, email: mockEmail, role: 'individual' },
            process.env.JWT_ACCESS_SECRET || 'test-secret-key-for-jest-testing',
            { expiresIn: '1h' }
        );

        const res = await request(app)
            .get('/api/app/bootstrap')
            .set('Authorization', `Bearer ${validToken}`);
        
        // Ensure standard HTTP success
        expect(res.status).toBe(200);
        
        // Verify Phase 7: Deep Tracing Headers injected natively into the edge HTTP response
        expect(res.headers).toHaveProperty('x-trace-id');
        expect(res.headers['x-trace-id'].length).toBeGreaterThan(10);
        
        // Verify Phase 5: App Optimization combined nested payload execution
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty('user');
        expect(res.body.data).toHaveProperty('activity');
        
        // Assure payload mapped properly down to the database row
        expect(res.body.data.user.email).toBe(mockEmail);
    });
});
