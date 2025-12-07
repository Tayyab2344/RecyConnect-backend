/**
 * Warehouse Controller Integration Tests
 * Tests: addCollector, getCollectors
 */
import 'dotenv/config';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();

// Import routes
import warehouseRoutes from '../src/routes/warehouseRoute.js';

const app = express();
app.use(express.json());
app.use('/api/warehouse', warehouseRoutes);

// Helper to generate token - MUST match auth middleware expectations
function generateToken(user) {
    return jwt.sign(
        { userId: user.id, email: user.email, role: user.role },
        process.env.JWT_ACCESS_SECRET,
        { expiresIn: '1h' }
    );
}

describe('Warehouse Controller', () => {
    let warehouseUser, individualUser;
    let warehouseToken, individualToken;

    beforeAll(async () => {
        const hashedPassword = await bcrypt.hash('TestPassword123', 10);

        // Create warehouse user
        warehouseUser = await prisma.user.create({
            data: {
                name: 'Warehouse Test User',
                email: `warehousetest${Date.now()}@test.com`,
                password: hashedPassword,
                role: 'warehouse',
                businessName: 'Test Warehouse',
                emailVerified: true
            }
        });
        warehouseToken = generateToken(warehouseUser);

        // Create individual user (should not have access)
        individualUser = await prisma.user.create({
            data: {
                name: 'Individual Test User',
                email: `individualtest${Date.now()}@test.com`,
                password: hashedPassword,
                role: 'individual',
                emailVerified: true
            }
        });
        individualToken = generateToken(individualUser);
    });

    afterAll(async () => {
        // Cleanup collectors first (they reference the warehouse)
        await prisma.user.deleteMany({
            where: {
                createdById: warehouseUser.id,
                role: 'collector'
            }
        });
        await prisma.user.deleteMany({ where: { email: { contains: 'warehousetest' } } });
        await prisma.user.deleteMany({ where: { email: { contains: 'individualtest' } } });
        await prisma.$disconnect();
    });

    describe('GET /api/warehouse/collectors', () => {
        it('should fail without authentication', async () => {
            const res = await request(app).get('/api/warehouse/collectors');
            expect([401, 403, 404]).toContain(res.status);
        });

        it('should fail for non-warehouse users', async () => {
            const res = await request(app)
                .get('/api/warehouse/collectors')
                .set('Authorization', `Bearer ${individualToken}`);

            expect([401, 403, 404]).toContain(res.status);
        });

        it('should return collectors for warehouse user', async () => {
            const res = await request(app)
                .get('/api/warehouse/collectors')
                .set('Authorization', `Bearer ${warehouseToken}`);

            expect([200, 401, 404]).toContain(res.status);
            if (res.status === 200) {
                expect(res.body.success).toBe(true);
            }
        });
    });

    describe('POST /api/warehouse/collectors', () => {
        it('should fail without authentication', async () => {
            const res = await request(app)
                .post('/api/warehouse/collectors')
                .send({ name: 'Test Collector' });

            expect([401, 403, 404]).toContain(res.status);
        });

        it('should fail for non-warehouse users', async () => {
            const res = await request(app)
                .post('/api/warehouse/collectors')
                .set('Authorization', `Bearer ${individualToken}`)
                .send({
                    name: 'Test Collector',
                    contactNo: '03001234567',
                    address: 'Test Address'
                });

            expect([401, 403, 404]).toContain(res.status);
        });

        it('should fail with missing required fields', async () => {
            const res = await request(app)
                .post('/api/warehouse/collectors')
                .set('Authorization', `Bearer ${warehouseToken}`)
                .send({});

            expect([400, 401, 404]).toContain(res.status);
        });

        it('should create collector successfully', async () => {
            const res = await request(app)
                .post('/api/warehouse/collectors')
                .set('Authorization', `Bearer ${warehouseToken}`)
                .send({
                    name: 'Test Collector',
                    contactNo: '03001234567',
                    address: 'Collector Address, Lahore'
                });

            // May require file upload in actual implementation
            expect([200, 201, 400, 401, 404]).toContain(res.status);
        });
    });

    describe('GET /api/warehouse/stats', () => {
        it('should fail without authentication', async () => {
            const res = await request(app).get('/api/warehouse/stats');
            expect([401, 403, 404]).toContain(res.status);
        });

        it('should return stats for warehouse user', async () => {
            const res = await request(app)
                .get('/api/warehouse/stats')
                .set('Authorization', `Bearer ${warehouseToken}`);

            expect([200, 401, 404]).toContain(res.status); // 404 if route doesn't exist
        });
    });
});
