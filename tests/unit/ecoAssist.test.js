import 'dotenv/config';
import request from 'supertest';
import express from 'express';
import prisma from '../../src/lib/prisma.js';
import appRoutes from '../../src/modules/app/routes/appRoutes.js';
import { generateTestToken } from '../helpers.js';

// Setup mock express app with app routes
const app = express();
app.use(express.json());

// Mock authenticateToken middleware for tests by setting req.user
app.use((req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    req.user = { id: 1, role: 'individual' }; // Mock test user context
  }
  next();
});

app.use('/api/app', appRoutes);

describe('EcoAssist Controller Integration Tests', () => {
  let testUser;
  let authToken;

  beforeAll(async () => {
    // Find or create test user to satisfy prisma lookup in controller
    testUser = await prisma.user.findFirst({
      where: { id: 1 }
    });

    if (!testUser) {
      testUser = await prisma.user.create({
        data: {
          id: 1,
          name: 'Test Assistant User',
          email: 'assistanttest@recyconnect.com',
          role: 'individual',
          ecoPoints: 50,
          dailyStreak: 3,
          currentLevel: 'Beginner Recycler',
          city: 'Abbottabad',
          area: 'Jinnahabad'
        }
      });
    }

    authToken = generateTestToken(testUser);
  });

  afterAll(async () => {
    // Clean up if we explicitly created it
    if (testUser && testUser.email === 'assistanttest@recyconnect.com') {
      await prisma.user.delete({ where: { id: 1 } }).catch(() => {});
    }
  });

  describe('POST /api/app/eco-assist/chat', () => {
    it('should return error 401 if unauthorized', async () => {
      const res = await request(app)
        .post('/api/app/eco-assist/chat')
        .send({ message: 'Hello' });

      expect(res.status).toBe(401);
    });

    it('should return error 400 if message is missing', async () => {
      const res = await request(app)
        .post('/api/app/eco-assist/chat')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Message query is required');
    });

    it('should return valid JSON with reply, intent, and suggestions structure', async () => {
      const res = await request(app)
        .post('/api/app/eco-assist/chat')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ message: 'I want to sell plastic bottles' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('reply');
      expect(res.body.data).toHaveProperty('intent');
      expect(res.body.data.intent).toHaveProperty('action');
      expect(res.body.data.intent).toHaveProperty('params');
      expect(res.body.data).toHaveProperty('suggestions');
    });

    it('should map "sell plastic" to NAVIGATE_SELL_ITEM action with category Plastic', async () => {
      const res = await request(app)
        .post('/api/app/eco-assist/chat')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ message: 'I want to sell plastic' });

      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(data.intent.action).toBe('NAVIGATE_SELL_ITEM');
      expect(data.intent.params.category).toBe('Plastic');
      expect(data.intent.params.triggerCamera).toBe(true);
    });

    it('should map "show e-waste within 5 km" to NAVIGATE_MARKETPLACE with distance filter', async () => {
      const res = await request(app)
        .post('/api/app/eco-assist/chat')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ message: 'show e-waste within 5 km' });

      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(data.intent.action).toBe('NAVIGATE_MARKETPLACE');
      expect(data.intent.params.category).toBe('E-Waste');
      expect(data.intent.params.maxDistance).toBe(5);
    });

    it('should map Urdu/Roman Urdu request for collector to REQUEST_COLLECTOR', async () => {
      const res = await request(app)
        .post('/api/app/eco-assist/chat')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ message: 'Mujhe kabaria bulana hai' });

      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(data.intent.action).toBe('REQUEST_COLLECTOR');
      expect(data.intent.params.autofill).toBe(true);
    });
  });
});
