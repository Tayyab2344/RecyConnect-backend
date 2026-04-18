import 'dotenv/config';
import request from 'supertest';
import express from 'express';
import prisma from '../src/lib/prisma.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

// Import routes
import chatRoutes from '../src/routes/chatRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/chat', chatRoutes);

function generateToken(user) {
    return jwt.sign(
        { userId: user.id, email: user.email, role: user.role },
        process.env.JWT_ACCESS_SECRET || 'test-secret',
        { expiresIn: '1h' }
    );
}

describe('Chat Controller', () => {
    let user1, user2;
    let token1, token2;
    let conversationId;

    beforeAll(async () => {
        const hashedPassword = await bcrypt.hash('password123', 10);
        user1 = await prisma.user.create({
            data: {
                name: 'Chat User 1',
                email: `chat1${Date.now()}@test.com`,
                password: hashedPassword,
                role: 'individual',
                emailVerified: true
            }
        });
        user2 = await prisma.user.create({
            data: {
                name: 'Chat User 2',
                email: `chat2${Date.now()}@test.com`,
                password: hashedPassword,
                role: 'individual',
                emailVerified: true
            }
        });
        token1 = generateToken(user1);
        token2 = generateToken(user2);
    });

    afterAll(async () => {
        // Dependencies: Message -> Conversation -> User
        if (conversationId) {
            await prisma.message.deleteMany({ where: { conversationId } });
            await prisma.conversation.delete({ where: { id: conversationId } });
        }
        await prisma.user.deleteMany({ where: { id: { in: [user1.id, user2.id] } } });
        // prisma disconnect handled by setup.js
    });

    describe('POST /api/chat/conversations', () => {
        it('should create or get a conversation', async () => {
            const res = await request(app)
                .post('/api/chat/conversations')
                .set('Authorization', `Bearer ${token1}`)
                .send({ otherUserId: user2.id });

            expect([200, 201]).toContain(res.status);
            expect(res.body.success).toBe(true);
            conversationId = res.body.data.id;
        });

        it('should fail if otherUserId is missing', async () => {
            const res = await request(app)
                .post('/api/chat/conversations')
                .set('Authorization', `Bearer ${token1}`)
                .send({});

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/chat/messages', () => {
        it('should send a message', async () => {
            const res = await request(app)
                .post('/api/chat/messages')
                .set('Authorization', `Bearer ${token1}`)
                .send({
                    conversationId,
                    content: 'Hello from User 1'
                });

            expect(res.status).toBe(201);
            expect(res.body.data.content).toBe('Hello from User 1');
            expect(res.body.data.senderId).toBe(user1.id);
        });
    });

    describe('GET /api/chat/conversations/:id/messages', () => {
        it('should return message history', async () => {
            const res = await request(app)
                .get(`/api/chat/conversations/${conversationId}/messages`)
                .set('Authorization', `Bearer ${token2}`);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data)).toBe(true);
            expect(res.body.data.length).toBeGreaterThan(0);
        });
    });

    describe('GET /api/chat/conversations', () => {
        it('should return list of conversations for the user', async () => {
            const res = await request(app)
                .get('/api/chat/conversations')
                .set('Authorization', `Bearer ${token1}`);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data)).toBe(true);
            expect(res.body.data[0].id).toBe(conversationId);
        });
    });
});
