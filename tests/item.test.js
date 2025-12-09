import request from 'supertest';
import { jest } from '@jest/globals';
import { createTestApp, generateTestToken, createTestUser, createTestListing, prisma } from './helpers.js';
import { ItemStatus } from '../src/constants/enums.js';

// Mock Cloudinary Package
jest.mock('cloudinary', () => ({
    v2: {
        config: jest.fn(),
        uploader: {
            upload: jest.fn().mockResolvedValue({
                secure_url: 'https://res.cloudinary.com/demo/image/upload/v1/sample.jpg'
            })
        }
    }
}));

// Mock fs/promises to prevent actual file deletion errors
jest.mock('fs/promises', () => ({
    unlink: jest.fn().mockResolvedValue(true)
}));

describe('Item Controller', () => {
    let sellerToken;
    let buyerToken;
    let seller;
    let buyer;
    let testItem;
    let app;

    beforeAll(async () => {
        // Dynamic import to ensure mocks apply
        const itemRouter = (await import('../src/routes/itemRoutes.js')).default;
        app = createTestApp(itemRouter, '/api/items');

        const timestamp = Date.now();
        seller = await createTestUser({ email: `seller-${timestamp}@test.com`, role: 'individual' });
        sellerToken = generateTestToken(seller);

        buyer = await createTestUser({ email: `buyer-${timestamp}@test.com`, role: 'individual' });
        buyerToken = generateTestToken(buyer);
    });

    beforeEach(async () => {
        // Create a test item before each test interaction if needed, or just once
        testItem = await prisma.item.create({
            data: {
                sellerId: seller.id,
                title: 'Test Plastic Bottles',
                description: 'High quality recycled plastic',
                price: 100,
                quantity: 50,
                category: 'PLASTIC',
                unit: 'kg',
                images: ['http://img.com/1.jpg'],
                status: ItemStatus.AVAILABLE
            }
        });
    });

    afterEach(async () => {
        await prisma.item.deleteMany();
    });

    afterAll(async () => {
        // Cleanup using pattern matching since we have timestamps
        await prisma.user.deleteMany({
            where: { email: { startsWith: 'seller-' } }
        });
        await prisma.user.deleteMany({
            where: { email: { startsWith: 'buyer-' } }
        });
    });

    describe('POST /api/items', () => {
        it('should create a new item with images', async () => {
            const res = await request(app)
                .post('/api/items')
                .set('Authorization', `Bearer ${sellerToken}`)
                // Attach mock fields
                .field('title', 'Scrap Metal')
                .field('description', 'Copper wires')
                .field('price', 500)
                .field('quantity', 10)
                .field('category', 'METAL')
                .field('unit', 'kg')
                // Attach mock file - supertest allows Buffer
                .attach('images', Buffer.from('fake image content'), 'test.jpg');

            expect(res.statusCode).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.title).toBe('Scrap Metal');
            expect(res.body.data.images).toHaveLength(1);
            expect(res.body.data.images[0]).toContain('cloudinary');
        });

        it('should fail without authentication', async () => {
            const res = await request(app)
                .post('/api/items')
                .send({ title: 'Fail' });
            expect(res.statusCode).toBe(401);
        });
    });

    describe('GET /api/items', () => {
        it('should list available items', async () => {
            const res = await request(app)
                .get('/api/items')
                .set('Authorization', `Bearer ${buyerToken}`);

            expect(res.statusCode).toBe(200);
            expect(Array.isArray(res.body.data)).toBe(true);
            expect(res.body.data.length).toBeGreaterThanOrEqual(1);
            expect(res.body.data[0].title).toBe(testItem.title);
        });

        it('should filter items by category', async () => {
            // Create another item with different category
            await prisma.item.create({
                data: {
                    sellerId: seller.id,
                    title: 'Paper Waste',
                    description: 'Newspapers',
                    price: 20,
                    quantity: 100,
                    category: 'PAPER',
                    status: ItemStatus.AVAILABLE
                }
            });

            const res = await request(app)
                .get('/api/items?category=PAPER')
                .set('Authorization', `Bearer ${buyerToken}`);

            expect(res.statusCode).toBe(200);
            expect(res.body.data.length).toBe(1);
            expect(res.body.data[0].category).toBe('PAPER');
        });
    });

    describe('GET /api/items/:id', () => {
        it('should return item details', async () => {
            const res = await request(app)
                .get(`/api/items/${testItem.id}`)
                .set('Authorization', `Bearer ${buyerToken}`);

            expect(res.statusCode).toBe(200);
            expect(res.body.data.id).toBe(testItem.id);
        });

        it('should return 404 for unknown item', async () => {
            const res = await request(app)
                .get('/api/items/9999999')
                .set('Authorization', `Bearer ${buyerToken}`);

            expect(res.statusCode).toBe(404);
        });
    });

    describe('DELETE /api/items/:id', () => {
        it('should allow seller to delete their item', async () => {
            const res = await request(app)
                .delete(`/api/items/${testItem.id}`)
                .set('Authorization', `Bearer ${sellerToken}`);

            expect(res.statusCode).toBe(200);

            const check = await prisma.item.findUnique({ where: { id: testItem.id } });
            // Should be marked as REMOVED or strictly deleted depending on implementation
            // The controller sets status: ItemStatus.REMOVED
            expect(check.status).toBe(ItemStatus.REMOVED);
        });

        it('should prevent unauthorized user from deleting item', async () => {
            const res = await request(app)
                .delete(`/api/items/${testItem.id}`)
                .set('Authorization', `Bearer ${buyerToken}`); // Buyer tries to delete seller's item

            expect(res.statusCode).toBe(403);
        });
    });
});
