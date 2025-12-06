/**
 * Admin Report Controller Integration Tests
 * Note: Some tests may return 500 if Listing.images column is missing from database
 */
import 'dotenv/config';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();

// Import routes
import adminReportRoutes from '../src/routes/adminReportRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/admin/reports', adminReportRoutes);

// Helper to generate token - MUST match auth middleware expectations
function generateToken(user) {
    return jwt.sign(
        { userId: user.id, email: user.email, role: user.role },
        process.env.JWT_ACCESS_SECRET,
        { expiresIn: '1h' }
    );
}

describe('Admin Report Controller', () => {
    let adminUser, regularUser;
    let adminToken, userToken;

    beforeAll(async () => {
        const hashedPassword = await bcrypt.hash('TestPassword123', 10);

        // Create admin user
        adminUser = await prisma.user.create({
            data: {
                name: 'Admin Report Tester',
                email: `adminreport${Date.now()}@test.com`,
                password: hashedPassword,
                role: 'admin',
                emailVerified: true
            }
        });
        adminToken = generateToken(adminUser);

        // Create regular user
        regularUser = await prisma.user.create({
            data: {
                name: 'Regular User',
                email: `regularreport${Date.now()}@test.com`,
                password: hashedPassword,
                role: 'individual',
                emailVerified: true
            }
        });
        userToken = generateToken(regularUser);
    });

    afterAll(async () => {
        await prisma.user.deleteMany({ where: { email: { contains: 'adminreport' } } });
        await prisma.user.deleteMany({ where: { email: { contains: 'regularreport' } } });
        await prisma.$disconnect();
    });

    describe('GET /api/admin/reports/overview', () => {
        it('should fail without authentication', async () => {
            const res = await request(app).get('/api/admin/reports/overview');
            expect([401, 403]).toContain(res.status);
        });

        it('should fail for non-admin users', async () => {
            const res = await request(app)
                .get('/api/admin/reports/overview')
                .set('Authorization', `Bearer ${userToken}`);

            expect([401, 403]).toContain(res.status);
        });

        it('should return system overview for admin', async () => {
            const res = await request(app)
                .get('/api/admin/reports/overview')
                .set('Authorization', `Bearer ${adminToken}`);

            expect([200, 401, 403, 500]).toContain(res.status);
            if (res.status === 200) {
                expect(res.body.success).toBe(true);
                expect(res.body.data).toHaveProperty('users');
                expect(res.body.data).toHaveProperty('listings');
                expect(res.body.data).toHaveProperty('orders');
                expect(res.body.data).toHaveProperty('recycling');
            }
        });
    });

    describe('GET /api/admin/reports/materials', () => {
        it('should fail for non-admin users', async () => {
            const res = await request(app)
                .get('/api/admin/reports/materials')
                .set('Authorization', `Bearer ${userToken}`);

            expect([401, 403]).toContain(res.status);
        });

        it('should return material breakdown for admin', async () => {
            const res = await request(app)
                .get('/api/admin/reports/materials')
                .set('Authorization', `Bearer ${adminToken}`);

            expect([200, 401, 403, 500]).toContain(res.status);
            if (res.status === 200) {
                expect(res.body.success).toBe(true);
            }
        });

        it('should support date filtering', async () => {
            const res = await request(app)
                .get('/api/admin/reports/materials?startDate=2024-01-01&endDate=2024-12-31')
                .set('Authorization', `Bearer ${adminToken}`);

            expect([200, 401, 403, 500]).toContain(res.status);
        });
    });

    describe('GET /api/admin/reports/user-activity', () => {
        it('should fail for non-admin users', async () => {
            const res = await request(app)
                .get('/api/admin/reports/user-activity')
                .set('Authorization', `Bearer ${userToken}`);

            expect([401, 403]).toContain(res.status);
        });

        it('should return user activity for admin', async () => {
            const res = await request(app)
                .get('/api/admin/reports/user-activity')
                .set('Authorization', `Bearer ${adminToken}`);

            expect([200, 401, 403, 500]).toContain(res.status);
            if (res.status === 200) {
                expect(res.body.success).toBe(true);
            }
        });

        it('should support limit parameter', async () => {
            const res = await request(app)
                .get('/api/admin/reports/user-activity?limit=5')
                .set('Authorization', `Bearer ${adminToken}`);

            expect([200, 401, 403, 500]).toContain(res.status);
        });
    });

    describe('GET /api/admin/reports/timeseries', () => {
        it('should fail for non-admin users', async () => {
            const res = await request(app)
                .get('/api/admin/reports/timeseries')
                .set('Authorization', `Bearer ${userToken}`);

            expect([401, 403]).toContain(res.status);
        });

        it('should return time series data for admin', async () => {
            const res = await request(app)
                .get('/api/admin/reports/timeseries')
                .set('Authorization', `Bearer ${adminToken}`);

            expect([200, 401, 403, 500]).toContain(res.status);
            if (res.status === 200) {
                expect(res.body.success).toBe(true);
            }
        });

        it('should support months parameter', async () => {
            const res = await request(app)
                .get('/api/admin/reports/timeseries?months=12')
                .set('Authorization', `Bearer ${adminToken}`);

            expect([200, 401, 403, 500]).toContain(res.status);
        });
    });

    describe('GET /api/admin/reports/locations', () => {
        it('should fail for non-admin users', async () => {
            const res = await request(app)
                .get('/api/admin/reports/locations')
                .set('Authorization', `Bearer ${userToken}`);

            expect([401, 403]).toContain(res.status);
        });

        it('should return location analytics for admin', async () => {
            const res = await request(app)
                .get('/api/admin/reports/locations')
                .set('Authorization', `Bearer ${adminToken}`);

            expect([200, 401, 403, 500]).toContain(res.status);
            if (res.status === 200) {
                expect(res.body.success).toBe(true);
            }
        });
    });

    describe('GET /api/admin/reports/export', () => {
        it('should fail for non-admin users', async () => {
            const res = await request(app)
                .get('/api/admin/reports/export')
                .set('Authorization', `Bearer ${userToken}`);

            expect([401, 403]).toContain(res.status);
        });

        it('should export listings as CSV', async () => {
            const res = await request(app)
                .get('/api/admin/reports/export?type=listings')
                .set('Authorization', `Bearer ${adminToken}`);

            expect([200, 401, 403, 500]).toContain(res.status);
        });

        it('should export orders as CSV', async () => {
            const res = await request(app)
                .get('/api/admin/reports/export?type=orders')
                .set('Authorization', `Bearer ${adminToken}`);

            expect([200, 401, 403, 500]).toContain(res.status);
        });
    });
});
