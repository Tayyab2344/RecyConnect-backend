import 'dotenv/config';
import request from 'supertest';
import express from 'express';
import prisma from '../../src/lib/prisma.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

// Import routes
import reportRoutes from '../../src/modules/report/routes/reportRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/reports', reportRoutes);

function generateToken(user) {
    return jwt.sign(
        { userId: user.id, email: user.email, role: user.role },
        process.env.JWT_ACCESS_SECRET || 'test-secret',
        { expiresIn: '1h' }
    );
}

describe('Report Controller', () => {
    let testUser;
    let testToken;

    beforeAll(async () => {
        const hashedPassword = await bcrypt.hash('password123', 10);
        testUser = await prisma.user.create({
            data: {
                name: 'Report Test User',
                email: `report${Date.now()}@test.com`,
                password: hashedPassword,
                role: 'individual',
                emailVerified: true
            }
        });
        testToken = generateToken(testUser);
    });

    afterAll(async () => {
        await prisma.user.delete({ where: { id: testUser.id } });
        // prisma disconnect handled by setup.js
    });

    describe('GET /api/reports/dashboard', () => {
        it('should return dashboard stats', async () => {
            const res = await request(app)
                .get('/api/reports/dashboard')
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toHaveProperty('selling');
            expect(res.body.data).toHaveProperty('buying');
        });
    });

    describe('GET /api/reports/activity', () => {
        it('should return activity feed', async () => {
            const res = await request(app)
                .get('/api/reports/activity')
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data)).toBe(true);
        });
    });

    describe('GET /api/reports/trends', () => {
        it('should return trend analysis', async () => {
            const res = await request(app)
                .get('/api/reports/trends')
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });
});
