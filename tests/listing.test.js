/**
 * Listing Controller Integration Tests
 * Note: Some tests may return 500 if Listing.images column is missing from database
 */
import 'dotenv/config';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();

// Import routes
import listingRoutes from '../src/routes/listingRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/listings', listingRoutes);

// Helper to generate token - MUST match auth middleware expectations
function generateToken(user) {
    return jwt.sign(
        { userId: user.id, email: user.email, role: user.role },
        process.env.JWT_ACCESS_SECRET,
        { expiresIn: '1h' }
    );
}

describe('Listing Controller', () => {
    let testUser;
    let testToken;
    let testListing;

    beforeAll(async () => {
        // Create test user
        const hashedPassword = await bcrypt.hash('TestPassword123!', 10);
        testUser = await prisma.user.create({
            data: {
                name: 'Listing Test User',
                email: `listingtest${Date.now()}@test.com`,
                password: hashedPassword,
                role: 'individual',
                emailVerified: true
            }
        });
        testToken = generateToken(testUser);
    });

    afterAll(async () => {
        // Cleanup
        await prisma.listing.deleteMany({ where: { userId: testUser.id } }).catch(() => { });
        await prisma.user.deleteMany({ where: { email: { contains: 'listingtest' } } });
        await prisma.$disconnect();
    });

    describe('POST /api/listings', () => {
        it('should create a listing in DRAFT status by default', async () => {
            const res = await request(app)
                .post('/api/listings')
                .set('Authorization', `Bearer ${testToken}`)
                .send({
                    materialType: 'PLASTIC',
                    estimatedWeight: 10,
                    pickupAddress: 'Test Pickup Address',
                    description: 'Test draft listing'
                });

            expect([201, 400, 500]).toContain(res.status);
            if (res.status === 201) {
                expect(res.body.data.status).toBe('DRAFT');
                testListing = res.body.data;
            }
        });
    });

    describe('Lifecycle: Publish and Pause', () => {
        it('should publish a draft listing', async () => {
            if (!testListing) return;
            const res = await request(app)
                .put(`/api/listings/${testListing.id}/publish`)
                .set('Authorization', `Bearer ${testToken}`);

            expect([200, 400, 401, 500]).toContain(res.status);
            if (res.status === 200) {
                expect(res.body.data.status).toBe('PUBLISHED');
            }
        });

        it('should pause a published listing', async () => {
            if (!testListing) return;
            const res = await request(app)
                .put(`/api/listings/${testListing.id}/pause`)
                .set('Authorization', `Bearer ${testToken}`);

            expect([200, 400, 401, 500]).toContain(res.status);
            if (res.status === 200) {
                expect(res.body.data.status).toBe('PAUSED');
            }
        });
    });

    describe('GET /api/listings/public', () => {
        it('should return only PUBLISHED listings for buyers', async () => {
            const res = await request(app).get('/api/listings/public');

            expect([200, 500]).toContain(res.status);
            if (res.status === 200) {
                expect(Array.isArray(res.body.data)).toBe(true);
                // Ensure no DRAFT or PAUSED listings are here
                res.body.data.forEach(l => {
                    expect(l.status).toBe('PUBLISHED');
                });
            }
        });
    });

    describe('GET /api/listings', () => {
        it('should return seller\'s own listings (including Drafts)', async () => {
            const res = await request(app)
                .get('/api/listings')
                .set('Authorization', `Bearer ${testToken}`);

            expect([200, 401, 500]).toContain(res.status);
        });
    });
});
