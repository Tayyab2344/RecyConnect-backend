import { jest } from '@jest/globals';
import request from 'supertest';
import prisma from '../../../src/lib/prisma.js';

// Setup ES module mocks at the top level
jest.unstable_mockModule('../../../src/lib/redis.js', () => ({
    invalidateCache: jest.fn().mockResolvedValue(),
    getCache: jest.fn().mockResolvedValue(null),
    setCache: jest.fn().mockResolvedValue(),
    deleteCache: jest.fn().mockResolvedValue(),
    default: { get: jest.fn(), setex: jest.fn() },
    isRedisConnected: jest.fn().mockReturnValue(false)
}));

jest.unstable_mockModule('../../../src/services/emailService.js', () => ({
    sendEmail: jest.fn().mockResolvedValue({ success: true })
}));

jest.unstable_mockModule('../../../src/services/ocrService.js', () => ({
    extractTextFromUrl: jest.fn().mockResolvedValue('CNIC 35201-1234567-1'),
    extractCNIC: jest.fn().mockReturnValue('35201-1234567-1'),
    extractNTN: jest.fn().mockReturnValue('1234567-8')
}));

jest.unstable_mockModule('../../../src/config/cloudinary.js', () => ({
    default: {
        uploader: {
            upload: jest.fn().mockResolvedValue({ secure_url: 'http://cloudinary.mock/doc.jpg' }),
            upload_stream: jest.fn().mockImplementation((options, callback) => {
                callback(null, { secure_url: 'http://cloudinary.mock/profile.jpg' });
                return {
                    end: jest.fn()
                };
            })
        }
    }
}));

jest.unstable_mockModule('../../../src/utils/uploadHelper.js', () => ({
    uploadToCloudinary: jest.fn().mockResolvedValue({ secure_url: 'http://cloudinary.mock/profile.jpg' }),
    uploadEncryptedToCloudinary: jest.fn().mockResolvedValue({
        secure_url: 'http://cloudinary.mock/cnic.pdf',
        encryption: {
            encryptionAlgorithm: 'aes-256-gcm',
            encryptionIv: 'iv',
            encryptionAuthTag: 'tag',
            encryptionKeyVersion: '1'
        },
        originalMimeType: 'application/pdf',
        originalSize: 100
    }),
    encryptedDocumentData: jest.fn().mockReturnValue({
        docType: 'CNIC',
        fileUrl: 'http://cloudinary.mock/cnic.pdf',
        encrypted: true,
        fileName: 'cnic.pdf'
    }),
    uploadBase64ToCloudinary: jest.fn().mockResolvedValue('http://cloudinary.mock/listing.jpg'),
    deleteCloudinaryAsset: jest.fn().mockResolvedValue()
}));

// Import app dynamically after mocks are set up
const { default: app } = await import('../../../src/index.js');
const { sendEmail } = await import('../../../src/services/emailService.js');

describe('System E2E Workflow: Authentication & Onboarding Journey', () => {
    const emails = [];

    beforeEach(() => {
        sendEmail.mockClear();
    });

    afterAll(async () => {
        // Clean up created test users
        if (emails.length > 0) {
            await prisma.refreshToken.deleteMany({
                where: { user: { email: { in: emails } } }
            }).catch(() => {});
            await prisma.userDocument.deleteMany({
                where: { user: { email: { in: emails } } }
            }).catch(() => {});
            await prisma.otp.deleteMany({
                where: { email: { in: emails } }
            }).catch(() => {});
            await prisma.user.deleteMany({
                where: { email: { in: emails } }
            }).catch(() => {});
        }
    });

    it('Workflow 1: Register and verify a new Individual user', async () => {
        const email = `ind-${Date.now()}@journey.com`;
        emails.push(email);

        // 1. Submit registration details
        const regRes = await request(app)
            .post('/api/auth/register')
            .send({
                role: 'individual',
                email,
                password: 'Password123!',
                name: 'Jane Doe',
                address: '123 Green Street',
                contactNo: '03001234567'
            });

        expect(regRes.status).toBe(201);
        expect(regRes.body.success).toBe(true);

        // 2. Fetch the OTP code directly from mock email call
        expect(sendEmail).toHaveBeenCalled();
        const emailCallArgs = sendEmail.mock.calls[0][0];
        const emailText = emailCallArgs.text;
        const otp = emailText.match(/\d{6}/)[0];
        expect(otp).toBeDefined();

        // 3. Verify OTP code
        const verifyRes = await request(app)
            .post('/api/auth/verify-otp')
            .send({
                email,
                otp
            });

        expect(verifyRes.status).toBe(200);
        expect(verifyRes.body.success).toBe(true);

        // 4. Verify user record matches in Database
        const dbUser = await prisma.user.findUnique({ where: { email } });
        expect(dbUser).not.toBeNull();
        expect(dbUser.name).toBe('Jane Doe');
        expect(dbUser.role).toBe('individual');
        expect(dbUser.emailVerified).toBe(true);
    });

    it('Workflow 2: Register and verify a new Warehouse user (requires uploads & CNIC)', async () => {
        const email = `wh-${Date.now()}@journey.com`;
        const cnic = `35201-${Math.floor(1000000 + Math.random() * 9000000)}-1`;
        emails.push(email);

        // 1. Submit registration details with simulated documents
        const regRes = await request(app)
            .post('/api/auth/register')
            .field('role', 'warehouse')
            .field('email', email)
            .field('password', 'Password123!')
            .field('businessName', 'Eco Recycle Depot')
            .field('address', '45 Industrial Area')
            .field('contactNo', '03217654321')
            .field('cnic', cnic)
            .attach('profileImage', Buffer.from('profile_img_data'), 'profile.jpg')
            .attach('cnic', Buffer.from('cnic_doc_data'), 'cnic.pdf');

        expect(regRes.status).toBe(201);
        expect(regRes.body.success).toBe(true);

        // 2. Fetch the OTP code directly from mock email call
        expect(sendEmail).toHaveBeenCalled();
        const emailCallArgs = sendEmail.mock.calls[0][0];
        const emailText = emailCallArgs.text;
        const otp = emailText.match(/\d{6}/)[0];
        expect(otp).toBeDefined();

        // 3. Verify OTP code
        const verifyRes = await request(app)
            .post('/api/auth/verify-otp')
            .send({
                email,
                otp
            });

        expect(verifyRes.status).toBe(200);
        expect(verifyRes.body.success).toBe(true);

        // 4. Verify user record matches in Database
        const dbUser = await prisma.user.findUnique({
            where: { email },
            include: { documents: true }
        });
        expect(dbUser).not.toBeNull();
        expect(dbUser.businessName).toBe('Eco Recycle Depot');
        expect(dbUser.role).toBe('warehouse');
        expect(dbUser.cnic).toBe(cnic);
    });

    it('Workflow 3: Authenticate (Login) successfully', async () => {
        const email = `login-${Date.now()}@journey.com`;
        emails.push(email);

        // Create verified user
        const user = await prisma.user.create({
            data: {
                name: 'Tester Login',
                email,
                password: await (await import('bcrypt')).default.hash('SecretPass123!', 10),
                role: 'individual',
                emailVerified: true
            }
        });

        // Attempt login
        const loginRes = await request(app)
            .post('/api/auth/login')
            .send({
                identifier: email,
                password: 'SecretPass123!'
            });

        expect(loginRes.status).toBe(200);
        expect(loginRes.body.success).toBe(true);
        expect(loginRes.body.data).toHaveProperty('accessToken');
    });

    it('Workflow 4: Reject login requests with incorrect credentials', async () => {
        const loginRes = await request(app)
            .post('/api/auth/login')
            .send({
                identifier: 'does-not-exist@test.com',
                password: 'WrongPassword'
            });

        expect(loginRes.status).toBe(401);
        expect(loginRes.body.success).toBe(false);
        expect(loginRes.body.message).toContain('Invalid credentials');
    });

    it('Workflow 5: Verify protected routes require valid authentication headers', async () => {
        const res = await request(app)
            .get('/api/user/profile');

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });
});
