/**
 * User Controller Integration Tests
 * Tests: getProfile, updateProfile, changePassword, checkCnic
 */
import 'dotenv/config';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();

// Import routes
import userRoutes from '../src/routes/userRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/user', userRoutes);

// Helper to generate token - MUST match auth middleware expectations
function generateToken(user) {
    return jwt.sign(
        { userId: user.id, email: user.email, role: user.role },
        process.env.JWT_ACCESS_SECRET,
        { expiresIn: '1h' }
    );
}

describe('User Controller', () => {
    let testUser;
    let testToken;

    beforeAll(async () => {
        // Create test user
        const hashedPassword = await bcrypt.hash('TestPassword123', 10);
        testUser = await prisma.user.create({
            data: {
                name: 'User Test',
                email: `usertest${Date.now()}@test.com`,
                password: hashedPassword,
                role: 'individual',
                emailVerified: true,
                contactNo: '03001234567',
                address: 'Test Address'
            }
        });
        testToken = generateToken(testUser);
    });

    afterAll(async () => {
        // Cleanup
        await prisma.user.deleteMany({ where: { email: { contains: 'usertest' } } });
        await prisma.user.deleteMany({ where: { email: { contains: 'cnictest' } } });
        await prisma.$disconnect();
    });

    describe('GET /api/user/profile', () => {
        it('should fail without authentication', async () => {
            const res = await request(app).get('/api/user/profile');
            expect([401, 403]).toContain(res.status);
        });

        it('should return user profile with valid token', async () => {
            const res = await request(app)
                .get('/api/user/profile')
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toHaveProperty('name', testUser.name);
            expect(res.body.data).toHaveProperty('email', testUser.email);
            expect(res.body.data).not.toHaveProperty('password');
        });
    });

    describe('PUT /api/user/profile', () => {
        it('should fail without authentication', async () => {
            const res = await request(app)
                .put('/api/user/profile')
                .send({ name: 'New Name' });

            expect([401, 403]).toContain(res.status);
        });

        it('should update user profile', async () => {
            const res = await request(app)
                .put('/api/user/profile')
                .set('Authorization', `Bearer ${testToken}`)
                .send({ name: 'Updated Name' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('should reject empty update', async () => {
            const res = await request(app)
                .put('/api/user/profile')
                .set('Authorization', `Bearer ${testToken}`)
                .send({});

            expect(res.status).toBe(400);
        });
    });

    describe('PUT /api/user/profile/password', () => {
        it('should fail without authentication', async () => {
            const res = await request(app)
                .put('/api/user/profile/password')
                .send({ currentPassword: 'old', newPassword: 'new' });

            expect([401, 403]).toContain(res.status);
        });

        it('should fail with incorrect current password', async () => {
            const res = await request(app)
                .put('/api/user/profile/password')
                .set('Authorization', `Bearer ${testToken}`)
                .send({
                    currentPassword: 'WrongPassword',
                    newPassword: 'NewPassword123'
                });

            expect([400, 401]).toContain(res.status);
        });

        it('should fail with short new password', async () => {
            const res = await request(app)
                .put('/api/user/profile/password')
                .set('Authorization', `Bearer ${testToken}`)
                .send({
                    currentPassword: 'TestPassword123',
                    newPassword: '123'
                });

            expect(res.status).toBe(400);
        });

        it('should change password successfully', async () => {
            const res = await request(app)
                .put('/api/user/profile/password')
                .set('Authorization', `Bearer ${testToken}`)
                .send({
                    currentPassword: 'TestPassword123',
                    newPassword: 'NewPassword123'
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });

    describe('GET /api/user/check-cnic/:cnic', () => {
        it('should validate CNIC format', async () => {
            const res = await request(app)
                .get('/api/user/check-cnic/12345'); // Invalid format

            expect(res.status).toBe(400);
        });

        it('should check valid CNIC that does not exist', async () => {
            const res = await request(app)
                .get('/api/user/check-cnic/1234567890123');

            expect(res.status).toBe(200);
            expect(res.body.data.exists).toBe(false);
        });

        it('should detect existing CNIC', async () => {
            // Create user with CNIC
            const userWithCnic = await prisma.user.create({
                data: {
                    name: 'CNIC Test User',
                    email: `cnictest${Date.now()}@test.com`,
                    password: 'hashedpwd',
                    role: 'individual',
                    cnic: '3520112345678'
                }
            });

            const res = await request(app)
                .get('/api/user/check-cnic/3520112345678');

            expect(res.status).toBe(200);
            expect(res.body.data.exists).toBe(true);
            expect(res.body.data.role).toBe('individual');

            // Cleanup
            await prisma.user.delete({ where: { id: userWithCnic.id } });
        });
    });
});
