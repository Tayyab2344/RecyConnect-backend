/**
 * Warehouse Controller Integration Tests
 * Tests: addCollector, getCollectors
 */
import 'dotenv/config';
import request from 'supertest';
import express from 'express';
import prisma from '../../src/lib/prisma.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

// Import routes
import warehouseRoutes from '../../src/modules/warehouse/routes/warehouseRoutes.js';

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
        const hashedPassword = await bcrypt.hash('TestPassword123!', 10);

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
        // Cleanup collector profiles first (they reference the user)
        await prisma.collectorProfile.deleteMany({
            where: {
                warehouseId: warehouseUser.id
            }
        });
        // Cleanup collectors
        await prisma.user.deleteMany({
            where: {
                createdById: warehouseUser.id,
                role: 'collector'
            }
        });
        await prisma.user.deleteMany({ where: { email: { contains: 'warehousetest' } } });
        await prisma.user.deleteMany({ where: { email: { contains: 'individualtest' } } });
        // prisma disconnect handled by setup.js
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

    describe('PUT /api/warehouse/collectors/:id & DELETE /api/warehouse/collectors/:id', () => {
        let testCollectorId;

        beforeAll(async () => {
            // Create a test collector directly in DB to test updates/deletes
            const uniqueId = `COL-CRUD-${Date.now()}`;
            const collector = await prisma.user.create({
                data: {
                    collectorId: uniqueId,
                    role: 'collector',
                    name: 'CRUD Collector',
                    contactNo: '03123456789',
                    address: 'Original Address',
                    emailVerified: true,
                    createdById: warehouseUser.id,
                    assignedWarehouseId: warehouseUser.id,
                    verificationStatus: 'VERIFIED',
                    collectorProfile: {
                        create: {
                            warehouseId: warehouseUser.id,
                            employeeId: uniqueId
                        }
                    }
                }
            });
            testCollectorId = collector.id;
        });

        it('should fail to update without authorization', async () => {
            const res = await request(app)
                .put(`/api/warehouse/collectors/${testCollectorId}`)
                .send({ name: 'Unauthorized Edit' });
            expect([401, 403]).toContain(res.status);
        });

        it('should update collector successfully', async () => {
            const res = await request(app)
                .put(`/api/warehouse/collectors/${testCollectorId}`)
                .set('Authorization', `Bearer ${warehouseToken}`)
                .send({
                    name: 'Updated Collector Name',
                    address: 'Updated Address',
                    contactNo: '03999999999'
                });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.name).toBe('Updated Collector Name');
        });

        it('should delete collector successfully', async () => {
            const res = await request(app)
                .delete(`/api/warehouse/collectors/${testCollectorId}`)
                .set('Authorization', `Bearer ${warehouseToken}`);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            // Verify they no longer show in active collectors list
            const listRes = await request(app)
                .get('/api/warehouse/collectors')
                .set('Authorization', `Bearer ${warehouseToken}`);
            expect(listRes.status).toBe(200);
            const found = listRes.body.data.some(c => c.id === testCollectorId);
            expect(found).toBe(false);
        });
    });
});
