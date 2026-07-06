import 'dotenv/config';
import request from 'supertest';
import express from 'express';
import prisma from '../../src/lib/prisma.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { EventBus } from '../../src/events/eventBus.js';
import { jest } from '@jest/globals';

// Import routers
import dispatchRoutes from '../../src/modules/warehouse/routes/dispatchRoutes.js';
import orderRoutes from '../../src/modules/order/routes/orderRoutes.js';
import collectorRoutes from '../../src/modules/warehouse/routes/collectorRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/dispatch', dispatchRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/collector', collectorRoutes);

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
    await prisma.conversation.deleteMany({
      where: {
        OR: [
          { participant1Id: { in: testUserIds } },
          { participant2Id: { in: testUserIds } },
          { tripId: { not: null } }
        ]
      }
    }).catch(() => {});

    // Delete collector records referencing task
    await prisma.wasteVerification.deleteMany({ where: { task: { warehouseId: warehouseUser.id } } }).catch(() => {});
    await prisma.collectorDelivery.deleteMany({ where: { task: { warehouseId: warehouseUser.id } } }).catch(() => {});
    await prisma.collectorEarning.deleteMany({ where: { task: { warehouseId: warehouseUser.id } } }).catch(() => {});
    await prisma.collectorLocation.deleteMany({ where: { collectorId: collectorUser.id } }).catch(() => {});
    await prisma.collectorIncident.deleteMany({ where: { collectorId: collectorUser.id } }).catch(() => {});
    await prisma.inventoryMovement.deleteMany({ where: { performedBy: collectorUser.id } }).catch(() => {});
    await prisma.warehouseInventory.deleteMany({ where: { warehouseId: warehouseUser.id } }).catch(() => {});

    await prisma.collectorTask.deleteMany({ where: { warehouseId: warehouseUser.id } });
    await prisma.trip.deleteMany({ where: { warehouseId: warehouseUser.id } });
    await prisma.collectorProfile.deleteMany({ where: { userId: collectorUser.id } });
    await prisma.orderItem.deleteMany({
      where: {
        OR: [
          { orderId: { in: [order1.id, order2.id] } },
          { order: { buyerId: warehouseUser.id } },
          { order: { sellerId: warehouseUser.id } }
        ]
      }
    });
    await prisma.order.deleteMany({
      where: {
        OR: [
          { id: { in: [order1.id, order2.id] } },
          { buyerId: warehouseUser.id },
          { sellerId: warehouseUser.id }
        ]
      }
    });
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

  describe('Collector Simplified Task Verification Flow', () => {
    let task;

    it('should retrieve assigned tasks for collector', async () => {
      const tasks = await prisma.collectorTask.findMany({
        where: { collectorId: collectorUser.id }
      });
      expect(tasks.length).toBeGreaterThan(0);
      task = tasks[0];
    });

    it('should accept the task as collector', async () => {
      const res = await request(app)
        .post(`/api/collector/tasks/${task.id}/accept`)
        .set('Authorization', `Bearer ${collectorToken}`);

      if (res.status !== 200) {
        console.error("ACCEPT_TASK_FAILED_BODY:", res.text);
      }
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ACCEPTED');
    });

    it('should start route to pickup', async () => {
      const res = await request(app)
        .patch(`/api/collector/tasks/${task.id}/status`)
        .set('Authorization', `Bearer ${collectorToken}`)
        .send({ status: 'EN_ROUTE_TO_PICKUP' });

      if (res.status !== 200) {
        console.error("EN_ROUTE_FAILED_BODY:", res.text);
      }
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('EN_ROUTE_TO_PICKUP');
    });

    it('should mark arrived at pickup', async () => {
      const res = await request(app)
        .patch(`/api/collector/tasks/${task.id}/status`)
        .set('Authorization', `Bearer ${collectorToken}`)
        .send({ status: 'ARRIVED_AT_SOURCE' });

      if (res.status !== 200) {
        console.error("ARRIVED_FAILED_BODY:", res.text);
      }
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ARRIVED_AT_SOURCE');
    });

    it('should verify waste and directly complete task/order', async () => {
      const res = await request(app)
        .post(`/api/collector/tasks/${task.id}/verify`)
        .set('Authorization', `Bearer ${collectorToken}`)
        .send({
          verifiedWeight: 15.0,
          verifiedCategory: 'Plastic',
          verifiedMaterial: 'plastic',
          notes: 'Verified exactly 15.0 kg of clean PET bottles',
          status: 'VERIFIED'
        });

      if (res.status !== 200) {
        console.error("VERIFY_WASTE_FAILED_BODY:", res.text);
      }
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.task).toBeDefined();
      expect(res.body.data.task.status).toBe('COMPLETED');

      // Verify task and order status in DB
      const dbTask = await prisma.collectorTask.findUnique({
        where: { id: task.id },
        include: { order: true, verification: true, delivery: true }
      });
      expect(dbTask.status).toBe('COMPLETED');
      expect(dbTask.order.status).toBe('COMPLETED');
      expect(dbTask.verification).not.toBeNull();
      expect(dbTask.verification.verifiedWeight).toBe(15.0);
      expect(dbTask.delivery).not.toBeNull();
      expect(dbTask.delivery.status).toBe('DELIVERED');
    });
  });

  describe('Direct Collector Assignment to Warehouse Orders', () => {
    it('should assign a collector to a WAREHOUSE_ASSIGNED order', async () => {
      // Create a WAREHOUSE_ASSIGNED order in the database
      const warehouseOrder = await prisma.order.create({
        data: {
          buyerId: warehouseUser.id,
          sellerId: individualUser.id,
          status: 'WAREHOUSE_ASSIGNED',
          totalAmount: 200.0,
          deliveryMethod: 'WAREHOUSE_COLLECTOR_SERVICE',
          handshakeOtp: '5678',
          items: {
            create: {
              listingId: listing.id,
              quantity: 10.0,
              price: 20.0
            }
          }
        }
      });

      const res = await request(app)
        .post('/api/dispatch/assign-orders')
        .set('Authorization', `Bearer ${warehouseToken}`)
        .send({
          collectorId: collectorUser.id,
          orderIds: [warehouseOrder.id]
        });

      if (res.status !== 201) {
        console.error("ASSIGN_ORDERS_FAILED_BODY:", res.text);
      }
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ASSIGNED');
    });
  });
});
