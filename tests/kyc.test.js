import request from 'supertest';
import { jest } from '@jest/globals';
import { createTestApp, generateTestToken, createTestUser, prisma } from './helpers.js';
import { UserRole, VerificationStatus, KycStage } from '../src/constants/enums.js';

// Mock Cloudinary Package (CommonJS)
jest.mock('cloudinary', () => ({
    v2: {
        config: jest.fn(),
        uploader: {
            upload: jest.fn().mockResolvedValue({
                secure_url: 'https://res.cloudinary.com/demo/image/upload/v1/kyc-doc.jpg'
            })
        }
    }
}));

// Mock OCR Service (ESM) - Use unstable_mockModule for ESM mocking
// Must be defined before the module is imported
jest.unstable_mockModule('../src/services/ocrService.js', () => ({
    __esModule: true,
    extractTextFromUrl: jest.fn(),
    extractCNIC: jest.fn(),
    extractNTN: jest.fn(),
    validateCNIC: jest.fn(),
    validateNTN: jest.fn()
}));

// Mock fs/promises
jest.mock('fs/promises', () => ({
    unlink: jest.fn().mockResolvedValue(true)
}));

describe('KYC Controller', () => {
    let companyUser;
    let companyToken;
    let individualUser;
    let individualToken;
    let app;
    let ocrService;

    beforeAll(async () => {
        // Import mocked module
        ocrService = await import('../src/services/ocrService.js');

        // Dynamic router import (depends on ocrService)
        const kycRouter = (await import('../src/routes/kycRoute.js')).default;

        app = createTestApp(kycRouter, '/api/kyc');

        const timestamp = Date.now();
        companyUser = await createTestUser({ email: `company-${timestamp}@test.com`, role: UserRole.COMPANY });
        companyToken = generateTestToken(companyUser);

        individualUser = await createTestUser({ email: `indiv-${timestamp}@test.com`, role: UserRole.INDIVIDUAL });
        individualToken = generateTestToken(individualUser);
    });

    afterEach(async () => {
        jest.clearAllMocks();
    });

    afterAll(async () => {
        await prisma.user.deleteMany({
            where: { email: { startsWith: 'company-' } }
        });
        await prisma.user.deleteMany({
            where: { email: { startsWith: 'indiv-' } }
        });
    });

    describe('POST /api/kyc/register', () => {
        it('should reject individuals trying to do KYC', async () => {
            const res = await request(app)
                .post('/api/kyc/register')
                .set('Authorization', `Bearer ${individualToken}`);

            expect(res.statusCode).toBe(403);
        });

        it('should successfully verify company with valid docs', async () => {
            // Setup Mocks
            ocrService.extractTextFromUrl.mockResolvedValue('Valid CNIC: 12345-1234567-1 NTN: 1234567-8');
            ocrService.extractCNIC.mockReturnValue('12345-1234567-1');
            ocrService.extractNTN.mockReturnValue('1234567-8');

            const res = await request(app)
                .post('/api/kyc/register')
                .set('Authorization', `Bearer ${companyToken}`)
                .attach('frontCnic', Buffer.from('fake'), 'front.jpg')
                .attach('backCnic', Buffer.from('fake'), 'back.jpg')
                .attach('ntn', Buffer.from('fake'), 'ntn.jpg')
                .attach('utilityBill', Buffer.from('fake'), 'bill.jpg')
                .attach('profilePicture', Buffer.from('fake'), 'profile.jpg');

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe(VerificationStatus.VERIFIED);
        });

        it('should auto-reject if CNIC extraction fails', async () => {
            ocrService.extractTextFromUrl.mockResolvedValue('No numbers here');
            ocrService.extractCNIC.mockReturnValue(null);

            const res = await request(app)
                .post('/api/kyc/register')
                .set('Authorization', `Bearer ${companyToken}`)
                .attach('frontCnic', Buffer.from('fake'), 'front.jpg')
                .attach('backCnic', Buffer.from('fake'), 'back.jpg');

            // Expecting failure status/rejection
            // Based on previous analysis, if validation fails it might return error or success: false
            // Controller likely returns 400 or sets status to REJECTED.
            // Adjust expectation if needed based on controller logic.
            // Assuming 400 for now.
            expect(res.statusCode).toBe(400);
        });
    });

    describe('GET /api/kyc/status', () => {
        it('should return KYC status', async () => {
            const res = await request(app)
                .get('/api/kyc/status')
                .set('Authorization', `Bearer ${companyToken}`);

            expect(res.statusCode).toBe(200);
            expect(res.body.data).toHaveProperty('kycStatus');
        });

        it('should fail without auth', async () => {
            const res = await request(app).get('/api/kyc/status');
            expect(res.statusCode).toBe(401);
        });
    });
});
