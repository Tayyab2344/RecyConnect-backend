import 'dotenv/config';
import request from 'supertest';
import express from 'express';
import prisma from '../src/lib/prisma.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { EventBus } from '../src/events/eventBus.js';
import { jest } from '@jest/globals';

// Import routers
import dispatchRoutes from '../src/modules/warehouse/routes/dispatchRoutes.js';
import orderRoutes from '../src/modules/order/routes/orderRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/dispatch', dispatchRoutes);
app.use('/api/orders', orderRoutes);

function generateToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    process.env.JWT_ACCESS_SECRET || 'test-secret-key-for-jest-testing',
    { expiresIn: '1h' }
  );
}

describe('Dispatch & Logistics System Integration Tests', () => {
  let warehouseUser, individualUser, collectorUser;
  let warehouseToken, individualToken, collectorToken;
  let listing, order1, order2, tripId, collectorProfile;

  beforeAll(async () => {
    // Mock EventBus.emit to avoid async database queries after test suite finishes
    jest.spyOn(EventBus, 'emit').mockImplementation(() => {});

    const hashedPassword = await bcrypt.hash('TestPassword123!', 10);

    // 1. Create Users
    warehouseUser = await prisma.user.create({
      data: {
        name: 'Logistics Warehouse',
        email: `log_wh_${Date.now()}@test.com`,
        password: hashedPassword,
        role: 'warehouse',
        businessName: 'Logistics Center',
        latitude: 31.4015,
        longitude: 74.2405,
        emailVerified: true
      }
    });
    warehouseToken = generateToken(warehouseUser);

    individualUser = await prisma.user.create({
      data: {
        name: 'Waste Seller Individual',
        email: `seller_ind_${Date.now()}@test.com`,
        password: hashedPassword,
        role: 'individual',
        latitude: 31.4050,
        longitude: 74.2420,
        emailVerified: true
      }
    });
    individualToken = generateToken(individualUser);

    collectorUser = await prisma.user.create({
      data: {
        name: 'Collector Ali',
        email: `col_ali_${Date.now()}@test.com`,
        password: hashedPassword,
        role: 'collector',
        collectorId: `COL-${Date.now()}`,
        emailVerified: true
      }
    });
    collectorToken = generateToken(collectorUser);

    // 2. Create Collector Profile under Warehouse
    collectorProfile = await prisma.collectorProfile.create({
      data: {
        userId: collectorUser.id,
        warehouseId: warehouseUser.id,
        employeeId: collectorUser.collectorId,
        availabilityStatus: 'ONLINE',
        vehicleInfo: { type: 'Bike', payloadCapacityKg: 50.0 },
        reliabilityScore: 98.0,
        currentLatitude: 31.4015,
        currentLongitude: 74.2405
      }
    });

    // 3. Create Listing
    listing = await prisma.listing.create({
      data: {
        userId: individualUser.id,
        category: 'Plastic',
        materialType: 'plastic',
        estimatedWeight: 10.0,
        quantity: 1.0,
        price: 20.0,
        title: 'PET Bottles bulk',
        status: 'PUBLISHED'
      }
    });

    // 4. Create Orders requiring Warehouse Collector Service
    order1 = await prisma.order.create({
      data: {
        buyerId: warehouseUser.id,
        sellerId: individualUser.id,
        status: 'CONFIRMED',
        totalAmount: 200.0,
        deliveryMethod: 'WAREHOUSE_COLLECTOR_SERVICE',
        items: {
          create: {
            listingId: listing.id,
            quantity: 10.0,
            price: 20.0
          }
        }
      }
    });

    order2 = await prisma.order.create({
      data: {
        buyerId: warehouseUser.id,
        sellerId: individualUser.id,
        status: 'CONFIRMED',
        totalAmount: 200.0,
        deliveryMethod: 'WAREHOUSE_COLLECTOR_SERVICE',
        items: {
          create: {
            listingId: listing.id,
            quantity: 5.0,
            price: 20.0
          }
        }
      }
    });
  });

  afterAll(async () => {
    if (EventBus.emit.mockRestore) {
      EventBus.emit.mockRestore();
    }

    const testUserIds = [warehouseUser.id, individualUser.id, collectorUser.id];
    // Cleanup database entries
    await prisma.reward.deleteMany({ where: { userId: { in: testUserIds } } });
    await prisma.badge.deleteMany({ where: { userId: { in: testUserIds } } });
    await prisma.leaderboard.deleteMany({ where: { userId: { in: testUserIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: testUserIds } } });
    await prisma.message.deleteMany({ where: { senderId: { in: testUserIds } } });
    await prisma.conversation.deleteMany({ where: { tripId: { not: null } } });
    await prisma.collectorTask.deleteMany({ where: { warehouseId: warehouseUser.id } });
    await prisma.trip.deleteMany({ where: { warehouseId: warehouseUser.id } });
    await prisma.collectorProfile.deleteMany({ where: { userId: collectorUser.id } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: [order1.id, order2.id] } } });
    await prisma.order.deleteMany({ where: { id: { in: [order1.id, order2.id] } } });
    await prisma.listing.delete({ where: { id: listing.id } });
    await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
  });

  describe('Route Clustering & Optimization Engine', () => {
    it('should fail optimization with unauthorized access', async () => {
      const res = await request(app)
        .post('/api/dispatch/optimize')
        .send({ orderIds: [order1.id, order2.id] });
      
      expect(res.status).toBe(401);
    });

    it('should fail optimization for individual roles', async () => {
      const res = await request(app)
        .post('/api/dispatch/optimize')
        .set('Authorization', `Bearer ${individualToken}`)
        .send({ orderIds: [order1.id, order2.id] });
      
      expect(res.status).toBe(403);
    });

    it('should cluster orders and create a draft trip sequence successfully', async () => {
      const res = await request(app)
        .post('/api/dispatch/optimize')
        .set('Authorization', `Bearer ${warehouseToken}`)
        .send({ orderIds: [order1.id, order2.id] });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.tripId).toBeDefined();
      expect(res.body.data.totalStops).toBe(2);
      expect(res.body.data.tasks.length).toBe(2);

      tripId = res.body.data.tripId;
    });
  });

  describe('Smart Collector Recommendation Scoring', () => {
    it('should return matching online collectors scored by distance and utilization', async () => {
      const res = await request(app)
        .get(`/api/dispatch/recommendations?tripId=${tripId}`)
        .set('Authorization', `Bearer ${warehouseToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.recommendations.length).toBeGreaterThan(0);
      expect(res.body.data.recommendations[0].collectorId).toBe(collectorUser.id);
      expect(res.body.data.recommendations[0].score).toBeGreaterThan(80);
    });
  });

  describe('Trip Assignment & Live Socket Dispatch', () => {
    it('should assign a trip to the compatible collector', async () => {
      const res = await request(app)
        .post('/api/dispatch/assign')
        .set('Authorization', `Bearer ${warehouseToken}`)
        .send({ tripId, collectorId: collectorUser.id });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ASSIGNED');
    });
  });

  describe('Secure OTP Handshake: Self Transportation', () => {
    let selfOrder;

    beforeAll(async () => {
      // Create a direct order requiring self transportation
      selfOrder = await prisma.order.create({
        data: {
          buyerId: warehouseUser.id,
          sellerId: individualUser.id,
          status: 'CONFIRMED',
          totalAmount: 100.0,
          deliveryMethod: 'SELF_TRANSPORTATION',
          handshakeOtp: '1234',
          items: {
            create: {
              listingId: listing.id,
              quantity: 5.0,
              price: 20.0
            }
          },
          payment: {
            create: {
              amount: 100.0,
              provider: 'COD',
              status: 'CAPTURED'
            }
          }
        }
      });
    });

    afterAll(async () => {
      await prisma.payment.deleteMany({ where: { orderId: selfOrder.id } });
      await prisma.orderItem.deleteMany({ where: { orderId: selfOrder.id } });
      await prisma.order.deleteMany({ where: { id: selfOrder.id } });
    });

    it('should block order completion with missing handshake OTP code', async () => {
      const res = await request(app)
        .post(`/api/orders/${selfOrder.id}/complete`)
        .set('Authorization', `Bearer ${individualToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Handshake OTP is required');
    });

    it('should block order completion with wrong handshake OTP code', async () => {
      const res = await request(app)
        .post(`/api/orders/${selfOrder.id}/complete`)
        .set('Authorization', `Bearer ${individualToken}`)
        .send({ handshakeOtp: '9999' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid Handshake OTP');
    });

    it('should complete order with correct handshake OTP verification', async () => {
      const res = await request(app)
        .post(`/api/orders/${selfOrder.id}/complete`)
        .set('Authorization', `Bearer ${individualToken}`)
        .send({ handshakeOtp: '1234' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('COMPLETED');
    });
  });
});
