import 'dotenv/config';
import request from 'supertest';
import express from 'express';
import prisma from '../src/lib/prisma.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

// Import routes
import transactionRoutes from '../src/modules/transaction/routes/transactionRoutes.js';
import { ItemStatus, TransactionStatus } from '../src/constants/enums.js';

const app = express();
app.use(express.json());
app.use('/api/transactions', transactionRoutes);

function generateToken(user) {
    return jwt.sign(
        { userId: user.id, email: user.email, role: user.role },
        process.env.JWT_ACCESS_SECRET || 'test-secret',
        { expiresIn: '1h' }
    );
}

describe('Transaction Controller', () => {
    let buyer, seller;
    let buyerToken, sellerToken;
    let item;

    beforeAll(async () => {
        const hashedPassword = await bcrypt.hash('password123', 10);
        buyer = await prisma.user.create({
            data: {
                name: 'Tx Buyer',
                email: `txbuyer${Date.now()}@test.com`,
                password: hashedPassword,
                role: 'individual',
                emailVerified: true
            }
        });
        seller = await prisma.user.create({
            data: {
                name: 'Tx Seller',
                email: `txseller${Date.now()}@test.com`,
                password: hashedPassword,
                role: 'individual',
                emailVerified: true
            }
        });
        buyerToken = generateToken(buyer);
        sellerToken = generateToken(seller);

        item = await prisma.item.create({
            data: {
                sellerId: seller.id,
                title: 'Test Item',
                price: 10,
                quantity: 50,
                category: 'Electronics',
                status: ItemStatus.AVAILABLE
            }
        });
    });

    afterAll(async () => {
        if (item) {
            await prisma.transaction.deleteMany({ where: { itemId: item.id } });
            await prisma.item.delete({ where: { id: item.id } });
        }
        if (buyer && seller) {
            await prisma.user.deleteMany({ where: { id: { in: [buyer.id, seller.id] } } });
        }
        // prisma disconnect handled by setup.js
    });

    describe('POST /api/transactions', () => {
        it('should create a transaction and update item quantity', async () => {
            const res = await request(app)
                .post('/api/transactions')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({
                    itemId: item.id,
                    quantity: 5
                });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.itemId).toBe(item.id);

            const updatedItem = await prisma.item.findUnique({ where: { id: item.id } });
            expect(updatedItem.quantity).toBe(45);
        });

        it('should fail if stock is insufficient', async () => {
            const res = await request(app)
                .post('/api/transactions')
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({
                    itemId: item.id,
                    quantity: 100
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Insufficient quantity');
        });
    });

    describe('GET /api/transactions', () => {
        it('should return transactions for the user', async () => {
            const res = await request(app)
                .get('/api/transactions')
                .set('Authorization', `Bearer ${buyerToken}`);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data)).toBe(true);
            expect(res.body.data.length).toBeGreaterThan(0);
        });
    });

    describe('PUT /api/transactions/:id/status', () => {
        it('should allow seller to update status', async () => {
            const tx = await prisma.transaction.findFirst({ where: { buyerId: buyer.id } });

            const res = await request(app)
                .put(`/api/transactions/${tx.id}/status`)
                .set('Authorization', `Bearer ${sellerToken}`)
                .send({ status: TransactionStatus.COMPLETED });

            expect(res.status).toBe(200);
            expect(res.body.data.status).toBe(TransactionStatus.COMPLETED);
        }, 60000);

        it('should fail if unauthorized user tries to update status', async () => {
            const tx = await prisma.transaction.findFirst({ where: { buyerId: buyer.id } });

            const res = await request(app)
                .put(`/api/transactions/${tx.id}/status`)
                .set('Authorization', `Bearer ${buyerToken}`)
                .send({ status: TransactionStatus.CANCELLED });

            expect(res.status).toBe(403);
        });
    });
});
