import { jest } from '@jest/globals';
import request from 'supertest';
import prisma from '../../../src/lib/prisma.js';
import { createTestUser, generateTestToken } from '../../helpers.js';

// Setup ES module mocks at the top level
jest.unstable_mockModule('../../../src/lib/redis.js', () => ({
    invalidateCache: jest.fn().mockResolvedValue(),
    getCache: jest.fn().mockResolvedValue(null),
    setCache: jest.fn().mockResolvedValue(),
    deleteCache: jest.fn().mockResolvedValue(),
    default: { get: jest.fn(), setex: jest.fn() },
    isRedisConnected: jest.fn().mockReturnValue(false)
}));

jest.unstable_mockModule('../../../src/utils/uploadHelper.js', () => ({
    uploadToCloudinary: jest.fn().mockResolvedValue({ secure_url: 'http://cloudinary.mock/profile.jpg' }),
    uploadEncryptedToCloudinary: jest.fn().mockResolvedValue({ secure_url: 'http://cloudinary.mock/cnic.pdf' }),
    encryptedDocumentData: jest.fn().mockReturnValue({ docType: 'CNIC', fileUrl: 'http://cloudinary.mock/cnic.pdf', encrypted: true }),
    uploadBase64ToCloudinary: jest.fn().mockResolvedValue('http://cloudinary.mock/classified.jpg'),
    deleteCloudinaryAsset: jest.fn().mockResolvedValue()
}));

jest.unstable_mockModule('../../../src/services/imageClassificationService.js', () => ({
    classifyImage: jest.fn().mockResolvedValue({
        materialType: 'PLASTIC',
        confidence: 0.96,
        details: 'PET Plastic bottle'
    })
}));

const { default: app } = await import('../../../src/index.js');

describe('System E2E Workflow: AI Classification Journey', () => {
    let user;
    let token;
    let listingId;

    beforeAll(async () => {
        user = await createTestUser({
            name: 'AI Tester',
            email: `ai-test-${Date.now()}@journey.com`,
            role: 'individual',
            emailVerified: true
        });

        token = generateTestToken(user);
    });

    afterAll(async () => {
        if (user) {
            await prisma.listing.deleteMany({ where: { userId: user.id } });
            await prisma.user.deleteMany({ where: { id: user.id } });
        }
    });

    it('Workflow 1: Classify image successfully using mock vision system', async () => {
        const res = await request(app)
            .post('/api/listings/classify')
            .set('Authorization', `Bearer ${token}`)
            .send({
                imageBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
            });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.materialType).toBe('PLASTIC');
        expect(res.body.data.confidence).toBe(0.96);
    });

    it('Workflow 2: Apply AI classification results during listing creation', async () => {
        const res = await request(app)
            .post('/api/listings')
            .set('Authorization', `Bearer ${token}`)
            .send({
                materialType: 'Plastic',
                estimatedWeight: 10.0,
                pickupAddress: '456 Street, Lahore',
                latitude: 31.4805,
                longitude: 74.3210,
                price: 15.0,
                quantity: 10.0,
                title: 'PET Water Bottles',
                notes: 'Classified using AI',
                images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==']
            });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data.materialType.toUpperCase()).toBe('PLASTIC');
        
        listingId = res.body.data.id;
    });
});
