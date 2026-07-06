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
    uploadBase64ToCloudinary: jest.fn().mockResolvedValue('http://cloudinary.mock/listing.jpg'),
    deleteCloudinaryAsset: jest.fn().mockResolvedValue()
}));

jest.unstable_mockModule('../../../src/services/imageClassificationService.js', () => ({
    classifyImage: jest.fn().mockResolvedValue({
        materialType: 'PLASTIC',
        confidence: 0.98,
        details: 'HDPE Plastic Bottle'
    })
}));

// Import app dynamically after mocks are set up
const { default: app } = await import('../../../src/index.js');

describe('System E2E Workflow: Marketplace Discovery Journey', () => {
    let seller;
    let buyer;
    let sellerToken;
    let buyerToken;
    let listingId;

    beforeAll(async () => {
        // Create verified users
        seller = await createTestUser({
            name: 'Eco Warehouse Lahore',
            email: `wh-seller-${Date.now()}@journey.com`,
            role: 'warehouse',
            businessName: 'Eco Warehouse Lahore',
            emailVerified: true
        });

        buyer = await createTestUser({
            name: 'Eco Green Buyer',
            email: `buyer-${Date.now()}@journey.com`,
            role: 'individual',
            emailVerified: true
        });

        sellerToken = generateTestToken(seller);
        buyerToken = generateTestToken(buyer);
    });

    afterAll(async () => {
        // Clean up database records in order
        if (listingId) {
            await prisma.orderItem.deleteMany({ where: { listingId } }).catch(() => {});
            await prisma.listing.deleteMany({ where: { id: listingId } }).catch(() => {});
        }
        if (seller) {
            await prisma.listing.deleteMany({ where: { userId: seller.id } }).catch(() => {});
        }
        await prisma.user.deleteMany({
            where: { id: { in: [seller.id, buyer.id] } }
        }).catch(() => {});
    });

    it('Workflow 1: Seller creates a new recyclable listing', async () => {
        const dummyBase64Image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

        const res = await request(app)
            .post('/api/listings')
            .set('Authorization', `Bearer ${sellerToken}`)
            .send({
                materialType: 'Plastic',
                estimatedWeight: 25.5,
                pickupAddress: 'Sector H, Phase 2, Lahore',
                latitude: 31.4805,
                longitude: 74.3210,
                price: 150.0,
                quantity: 25.5,
                title: 'Clean Plastic Bottles Batch',
                notes: 'Baled and sorted HDPE plastic bottles.',
                images: [dummyBase64Image]
            });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty('id');
        
        listingId = res.body.data.id;

        // Verify entry was written to DB
        const dbListing = await prisma.listing.findUnique({ where: { id: listingId } });
        expect(dbListing).not.toBeNull();
        expect(dbListing.estimatedWeight).toBe(25.5);
        expect(dbListing.price).toBe(150.0);
    });

    it('Workflow 2: Listing appears in the public marketplace feed & search', async () => {
        const res = await request(app)
            .get('/api/listings')
            .set('Authorization', `Bearer ${buyerToken}`)
            .query({ search: 'Plastic', view: 'marketplace' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.length).toBeGreaterThanOrEqual(1);

        const foundListing = res.body.data.find(item => item.id === listingId);
        expect(foundListing).toBeDefined();
        expect(foundListing.user.name).toBe('Eco Warehouse Lahore');
        expect(foundListing.user.role).toBe('warehouse');
    });

    it('Workflow 3: Buyer views listing details (seller role & currentLevel mapped)', async () => {
        const res = await request(app)
            .get(`/api/listings/${listingId}`)
            .set('Authorization', `Bearer ${buyerToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.id).toBe(listingId);
        
        // Assert user context details
        expect(res.body.data.user.name).toBe('Eco Warehouse Lahore');
        expect(res.body.data.user.role).toBe('warehouse');
        expect(res.body.data.user).toHaveProperty('currentLevel');
        expect(res.body.data.user).toHaveProperty('badges');
    });
});
