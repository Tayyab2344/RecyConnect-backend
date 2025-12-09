import request from 'supertest';
import { jest } from '@jest/globals';
import { createTestApp, generateTestToken, createTestUser, createAdminUser, prisma } from './helpers.js';
import adminRouter from '../src/routes/adminRoute.js';
import { UserRole, VerificationStatus, KycStage } from '../src/constants/enums.js';

const app = createTestApp(adminRouter, '/api/admin');

describe('Admin Controller', () => {
    let adminToken;
    let userToken;
    let adminUser;
    let regularUser;
    let pendingUser;

    beforeAll(async () => {
        adminUser = await createAdminUser();
        adminToken = generateTestToken(adminUser);

        const timestamp = Date.now();
        // createAdminUser uses date.now internally, but we can pass unique for safety or rely on helper
        // But helper createAdminUser generates unique email. 
        // regularUser does NOT.
        regularUser = await createTestUser({ email: `regular-${timestamp}@test.com`, role: UserRole.INDIVIDUAL });
        userToken = generateTestToken(regularUser);
    });

    beforeEach(async () => {
        // Create a user with pending KYC for each test to ensure clean state
        pendingUser = await createTestUser({
            email: `pending${Date.now()}@test.com`,
            role: UserRole.COMPANY, // Company role usually needs KYC
            verificationStatus: VerificationStatus.PENDING,
            kycStage: KycStage.DOCUMENTS_UPLOADED
        });
    });

    afterEach(async () => {
        // Cleanup only pending users created in beforeEach
        await prisma.user.deleteMany({
            where: { email: { startsWith: 'pending' } }
        });
    });

    afterAll(async () => {
        // Cleanup only admin specific users
        await prisma.user.deleteMany({
            where: { email: { contains: 'admin' } } // cleanup emails containing 'admin' which createAdminUser uses
        });
        await prisma.user.deleteMany({
            where: { email: { startsWith: 'pending' } }
        });
    });

    describe('GET /api/admin/kyc/pending', () => {
        it('should return 401 if not authenticated', async () => {
            const res = await request(app).get('/api/admin/kyc/pending');
            expect(res.statusCode).toBe(401);
        });

        it('should return 403 if not admin', async () => {
            const res = await request(app)
                .get('/api/admin/kyc/pending')
                .set('Authorization', `Bearer ${userToken}`);
            expect(res.statusCode).toBe(403);
        });

        it('should return pending KYC users for admin', async () => {
            const res = await request(app)
                .get('/api/admin/kyc/pending')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data)).toBe(true);
            // Check if our pending user is in the list
            const found = res.body.data.find(u => u.id === pendingUser.id);
            expect(found).toBeTruthy();
        });
    });

    describe('POST /api/admin/kyc/approve', () => {
        it('should approve a user KYC', async () => {
            const res = await request(app)
                .post('/api/admin/kyc/approve')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ userId: pendingUser.id });

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);

            const updatedUser = await prisma.user.findUnique({ where: { id: pendingUser.id } });
            expect(updatedUser.verificationStatus).toBe(VerificationStatus.VERIFIED);
            expect(updatedUser.kycStage).toBe(KycStage.VERIFIED);
        });

        it('should return 404 for non-existent user', async () => {
            const res = await request(app)
                .post('/api/admin/kyc/approve')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ userId: 999999 });

            expect(res.statusCode).toBe(404);
        });
    });

    describe('POST /api/admin/kyc/reject', () => {
        it('should reject a user KYC with reason', async () => {
            const res = await request(app)
                .post('/api/admin/kyc/reject')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    userId: pendingUser.id,
                    reason: 'Blurry documents'
                });

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);

            const updatedUser = await prisma.user.findUnique({ where: { id: pendingUser.id } });
            expect(updatedUser.verificationStatus).toBe(VerificationStatus.REJECTED);
            expect(updatedUser.rejectionReason).toBe('Blurry documents');
        });

        it('should fail if reason is missing', async () => {
            const res = await request(app)
                .post('/api/admin/kyc/reject')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ userId: pendingUser.id });

            expect(res.statusCode).toBe(400);
        });
    });

    describe('PUT /api/admin/users/:id/suspend', () => {
        it('should suspend a user', async () => {
            const res = await request(app)
                .put(`/api/admin/users/${pendingUser.id}/suspend`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ suspended: true });

            expect(res.statusCode).toBe(200);

            const updatedUser = await prisma.user.findUnique({ where: { id: pendingUser.id } });
            expect(updatedUser.verificationStatus).toBe(VerificationStatus.SUSPENDED);
        });

        it('should activate a user', async () => {
            // First suspend
            await prisma.user.update({
                where: { id: pendingUser.id },
                data: { verificationStatus: VerificationStatus.SUSPENDED }
            });

            const res = await request(app)
                .put(`/api/admin/users/${pendingUser.id}/suspend`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ suspended: false });

            expect(res.statusCode).toBe(200);

            const updatedUser = await prisma.user.findUnique({ where: { id: pendingUser.id } });
            expect(updatedUser.verificationStatus).toBe(VerificationStatus.VERIFIED);
        });
    });

    describe('PUT /api/admin/rates', () => {
        it('should update rates', async () => {
            const res = await request(app)
                .post('/api/admin/rates')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    category: 'PLASTIC',
                    pricePerUnit: 50.5
                });

            expect(res.statusCode).toBe(200);
            expect(res.body.data.pricePerUnit).toBe(50.5);

            const rate = await prisma.rate.findUnique({ where: { category: 'PLASTIC' } });
            expect(rate.pricePerUnit).toBe(50.5);
        });
    });
});
