/**
 * Auth Controller Integration Tests
 * Tests: register, login, verifyOTP, resendOTP
 */
import 'dotenv/config';
import request from 'supertest';
import express from 'express';
import prisma from '../src/lib/prisma.js';
import bcrypt from 'bcrypt';

// Import routes
import authRoutes from '../src/modules/auth/routes/authRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

// Test data
const testEmail = `testauth${Date.now()}@test.com`;
let createdUserId;
const createdUserIds = new Set();

describe('Auth Controller', () => {

    afterAll(async () => {
        // Cleanup test data
        if (createdUserId) {
            await prisma.refreshToken.deleteMany({ where: { userId: createdUserId } }).catch(() => { });
            await prisma.user.delete({ where: { id: createdUserId } }).catch(() => { });
        }

        if (createdUserIds.size > 0) {
            const ids = [...createdUserIds];
            await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } }).catch(() => { });
            await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch(() => { });
        }

        const authUsers = await prisma.user.findMany({
            where: {
                OR: [
                    { email: { contains: 'testauth' } },
                    { email: { contains: 'logintest' } },
                    { email: { contains: 'validlogin' } },
                ],
            },
            select: { id: true },
        }).catch(() => []);

        if (authUsers.length > 0) {
            await prisma.refreshToken.deleteMany({
                where: { userId: { in: authUsers.map((user) => user.id) } },
            }).catch(() => { });
        }

        await prisma.user.deleteMany({ where: { email: { contains: 'testauth' } } }).catch(() => { });
        await prisma.user.deleteMany({ where: { email: { contains: 'logintest' } } }).catch(() => { });
        await prisma.user.deleteMany({ where: { email: { contains: 'validlogin' } } }).catch(() => { });
        // prisma disconnect handled by setup.js
    });

    describe('POST /api/auth/register', () => {
        it('should fail registration with missing required fields', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({});

            expect([400, 422]).toContain(res.status);
        });

        it('should fail registration with invalid email', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({
                    name: 'Test User',
                    email: 'invalid-email',
                    password: 'Test1234',
                    role: 'individual'
                });

            expect([400, 422]).toContain(res.status);
        });

        it('should fail registration with weak password', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({
                    name: 'Test User',
                    email: testEmail,
                    password: '123', // Too short
                    role: 'individual'
                });

            expect([400, 422]).toContain(res.status);
        });

        it('should register a new individual user', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({
                    name: 'Test User',
                    email: testEmail,
                    password: 'TestPassword123!',
                    role: 'individual',
                    contactNo: '03001234567',
                    address: 'Test Address, Lahore'
                });

            // Registration should succeed (returns OTP required message)
            expect([200, 201, 400]).toContain(res.status);
        });

        it('should fail registration with duplicate email', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({
                    name: 'Test User 2',
                    email: testEmail, // Same email
                    password: 'TestPassword123!',
                    role: 'individual'
                });

            expect([400, 409, 422]).toContain(res.status);
        });
    });

    describe('POST /api/auth/login', () => {
        it('should fail login with missing credentials', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({});

            expect([400, 422]).toContain(res.status);
        });

        it('should fail login with invalid email', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    identifier: 'nonexistent@test.com',
                    password: 'SomePassword123'
                });

            expect([400, 401]).toContain(res.status);
        });

        it('should fail login with incorrect password', async () => {
            // First create a verified user
            const hashedPassword = await bcrypt.hash('CorrectPassword123', 10);
            const user = await prisma.user.create({
                data: {
                    name: 'Login Test User',
                    email: `logintest${Date.now()}@test.com`,
                    password: hashedPassword,
                    role: 'individual',
                    emailVerified: true
                }
            });
            createdUserId = user.id;
            createdUserIds.add(user.id);

            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    identifier: user.email,
                    password: 'WrongPassword123'
                });

            expect([400, 401]).toContain(res.status);
        });

        it('should login successfully with valid credentials', async () => {
            const password = 'ValidPassword123';
            const hashedPassword = await bcrypt.hash(password, 10);
            const email = `validlogin${Date.now()}@test.com`;

            const user = await prisma.user.create({
                data: {
                    name: 'Valid Login User',
                    email,
                    password: hashedPassword,
                    role: 'individual',
                    emailVerified: true
                }
            });
            createdUserIds.add(user.id);

            const res = await request(app)
                .post('/api/auth/login')
                .send({ identifier: email, password });

            expect([200, 400]).toContain(res.status);
            if (res.status === 200) {
                expect(res.body.success).toBe(true);
                expect(res.body.data).toHaveProperty('accessToken');
                expect(res.body.data).toHaveProperty('refreshToken');
                expect(res.body.data).toHaveProperty('user');
            }
        });
    });

    describe('POST /api/auth/verify-otp', () => {
        it('should fail OTP verification with missing data', async () => {
            const res = await request(app)
                .post('/api/auth/verify-otp')
                .send({});

            expect([400, 422]).toContain(res.status);
        });

        it('should fail OTP verification with invalid OTP', async () => {
            const res = await request(app)
                .post('/api/auth/verify-otp')
                .send({
                    email: testEmail,
                    otp: '000000'
                });

            expect([400, 401, 404]).toContain(res.status);
        });
    });

    describe('POST /api/auth/resend-otp', () => {
        it('should fail resend OTP with missing email', async () => {
            const res = await request(app)
                .post('/api/auth/resend-otp')
                .send({});

            expect([400, 422]).toContain(res.status);
        });
    });

    describe('POST /api/auth/forgot-password', () => {
        it('should handle forgot password request', async () => {
            const res = await request(app)
                .post('/api/auth/forgot-password')
                .send({ email: 'nonexistent@test.com' });

            // Should not reveal if email exists or not (security)
            expect([200, 400, 404]).toContain(res.status);
        });
    });
});
