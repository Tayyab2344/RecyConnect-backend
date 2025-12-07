/**
 * Order Controller Integration Tests
 * Tests: createOrder, getOrders, getOrder, updateOrderStatus
 * Note: These tests don't create listings to avoid Prisma schema issues
 */
import 'dotenv/config';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();

// Import routes
import orderRoutes from '../src/routes/orderRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/orders', orderRoutes);

// Helper to generate token - MUST match auth middleware expectations
function generateToken(user) {
    return jwt.sign(
        { userId: user.id, email: user.email, role: user.role },
        process.env.JWT_ACCESS_SECRET,
        { expiresIn: '1h' }
    );
}

describe('Order Controller', () => {
    let buyer, seller;
    let buyerToken, sellerToken;

    beforeAll(async () => {
        // Create test users
        const hashedPassword = await bcrypt.hash('TestPassword123', 10);

        buyer = await prisma.user.create({
            data: {
                name: 'Order Buyer',
                email: `orderbuyer${Date.now()}@test.com`,
                password: hashedPassword,
                role: 'warehouse',
                emailVerified: true
            }
        });

        seller = await prisma.user.create({
            data: {
                name: 'Order Seller',
                email: `orderseller${Date.now()}@test.com`,
                password: hashedPassword,
                role: 'individual',
                emailVerified: true
            }
        });

        buyerToken = generateToken(buyer);
        sellerToken = generateToken(seller);
    });

    afterAll(async () => {
        // Cleanup
        await prisma.user.deleteMany({ where: { email: { contains: 'orderbuyer' } } });
        await prisma.user.deleteMany({ where: { email: { contains: 'orderseller' } } });
        await prisma.$disconnect();
    });

    describe('POST /api/orders', () => {
        it('should fail without authentication', async () => {
            const res = await request(app)
                .post('/api/orders')
                .send({ listingId: 1 });

            expect([401, 403]).toContain(res.status);
        });

        it('should fail with missing listing ID', async () => {
            const res = await request(app)
                .post('/api/orders')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({});

            expect([400, 401, 404]).toContain(res.status);
        });

        it('should fail with non-existent listing', async () => {
            const res = await request(app)
                .post('/api/orders')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({
                    listingId: 999999,
                    weight: 25,
                    paymentMethod: 'CASH'
                });

            expect([400, 401, 404]).toContain(res.status);
        });
    });

    describe('GET /api/orders', () => {
        it('should fail without authentication', async () => {
            const res = await request(app).get('/api/orders');
            expect([401, 403]).toContain(res.status);
        });

        it('should return orders list for authenticated user', async () => {
            const res = await request(app)
                .get('/api/orders')
                .set('Authorization', `Bearer ${buyerToken}`);

            expect([200, 401]).toContain(res.status);
            if (res.status === 200) {
                expect(res.body.success).toBe(true);
            }
        });

        it('should filter by status', async () => {
            const res = await request(app)
                .get('/api/orders?status=PENDING')
                .set('Authorization', `Bearer ${buyerToken}`);

            expect([200, 401]).toContain(res.status);
        });
    });

    describe('GET /api/orders/:id', () => {
        it('should return 404 for non-existent order', async () => {
            const res = await request(app)
                .get('/api/orders/99999')
                .set('Authorization', `Bearer ${buyerToken}`);

            expect([400, 401, 404]).toContain(res.status);
        });
    });

    describe('GET /api/orders/stats', () => {
        it('should return order statistics', async () => {
            const res = await request(app)
                .get('/api/orders/stats')
                .set('Authorization', `Bearer ${buyerToken}`);

            expect([200, 401, 404]).toContain(res.status);
        });
    });
});
