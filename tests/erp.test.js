import 'dotenv/config';
import request from 'supertest';
import prisma from '../src/lib/prisma.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import app from '../src/index.js';

function generateToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    process.env.JWT_ACCESS_SECRET || 'test_secret',
    { expiresIn: '1h' }
  );
}

describe('Warehouse ERP Module Integration Tests', () => {
  let warehouseUser, individualUser;
  let warehouseToken, individualToken;
  let testInventoryItem, testExpense;

  beforeAll(async () => {
    // Suppress logging during tests
    process.env.NODE_ENV = 'test';
    
    const hashedPassword = await bcrypt.hash('TestPassword123!', 10);

    // Create warehouse user
    warehouseUser = await prisma.user.create({
      data: {
        name: 'ERP Warehouse User',
        email: `erpwarehouse${Date.now()}@test.com`,
        password: hashedPassword,
        role: 'warehouse',
        businessName: 'ERP Test Warehouse',
        emailVerified: true
      }
    });
    warehouseToken = generateToken(warehouseUser);

    // Create individual user
    individualUser = await prisma.user.create({
      data: {
        name: 'ERP Individual User',
        email: `erpindividual${Date.now()}@test.com`,
        password: hashedPassword,
        role: 'individual',
        emailVerified: true
      }
    });
    individualToken = generateToken(individualUser);
  });

  afterAll(async () => {
    // Clean up created records
    if (testInventoryItem) {
      await prisma.inventoryMovement.deleteMany({ where: { inventoryId: testInventoryItem.id } }).catch(() => {});
      await prisma.warehouseInventory.delete({ where: { id: testInventoryItem.id } }).catch(() => {});
    }

    if (testExpense) {
      await prisma.expense.delete({ where: { id: testExpense.id } }).catch(() => {});
    }

    await prisma.financialTransaction.deleteMany({ where: { warehouseId: warehouseUser.id } }).catch(() => {});
    await prisma.expense.deleteMany({ where: { warehouseId: warehouseUser.id } }).catch(() => {});
    await prisma.warehouseInventory.deleteMany({ where: { warehouseId: warehouseUser.id } }).catch(() => {});
    await prisma.user.deleteMany({ where: { email: { contains: 'erpwarehouse' } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { email: { contains: 'erpindividual' } } }).catch(() => {});
  });

  // 1. Authorization
  describe('Authorization Checks', () => {
    it('should fail access without authentication', async () => {
      const res = await request(app).get('/api/warehouse/erp/inventory');
      expect([401, 403]).toContain(res.status);
    });

    it('should fail access for non-warehouse roles', async () => {
      const res = await request(app)
        .get('/api/warehouse/erp/inventory')
        .set('Authorization', `Bearer ${individualToken}`);
      expect(res.status).toBe(403);
    });
  });

  // 2. Inventory Management CRUD
  describe('Inventory Management', () => {
    it('should allow warehouse to add inventory item', async () => {
      const res = await request(app)
        .post('/api/warehouse/erp/inventory')
        .set('Authorization', `Bearer ${warehouseToken}`)
        .send({
          materialType: 'plastic',
          category: 'PET Bottles',
          quantityInStock: 250,
          reorderLevel: 100,
          purchasePrice: 40,
          sellingPrice: 85,
          location: 'Bin A',
          notes: 'Test plastic inventory'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.materialType).toBe('plastic');
      testInventoryItem = res.body.data;
    });

    it('should fetch the warehouse inventory list', async () => {
      const res = await request(app)
        .get('/api/warehouse/erp/inventory')
        .set('Authorization', `Bearer ${warehouseToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('should update an existing inventory item', async () => {
      const res = await request(app)
        .put(`/api/warehouse/erp/inventory/${testInventoryItem.id}`)
        .set('Authorization', `Bearer ${warehouseToken}`)
        .send({
          quantityInStock: 300,
          notes: 'Updated note details'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.quantityInStock).toBe(300);
    });
  });

  // 3. Expense Management
  describe('Expense Management', () => {
    it('should allow warehouse to log an expense', async () => {
      const res = await request(app)
        .post('/api/warehouse/erp/expenses')
        .set('Authorization', `Bearer ${warehouseToken}`)
        .send({
          category: 'TRANSPORTATION',
          amount: 2500,
          description: 'Truck dispatch charge',
          date: new Date().toISOString()
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.amount).toBe(2500);
      testExpense = res.body.data;
    });

    it('should fetch expenses list', async () => {
      const res = await request(app)
        .get('/api/warehouse/erp/expenses')
        .set('Authorization', `Bearer ${warehouseToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  // 4. Financial Calculations & Reports
  describe('Financial Summaries & Reports', () => {
    it('should return calculations of revenues and expenses', async () => {
      const res = await request(app)
        .get('/api/warehouse/erp/financial-summary')
        .set('Authorization', `Bearer ${warehouseToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.summary).toBeDefined();
      expect(res.body.data.summary.totalExpenses).toBe(2500);
    });

    it('should generate business reports', async () => {
      const res = await request(app)
        .get('/api/warehouse/erp/reports?type=expenses')
        .set('Authorization', `Bearer ${warehouseToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.records).toBeDefined();
    });
  });

  // 5. AI Assistant & Insights
  describe('AI assistant and Insights utilities', () => {
    it('should return structured business insights with fallback heuristics', async () => {
      const res = await request(app)
        .get('/api/warehouse/erp/ai-insights')
        .set('Authorization', `Bearer ${warehouseToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].title).toBeDefined();
    });

    it('should communicate with AI Business assistant successfully', async () => {
      const res = await request(app)
        .post('/api/warehouse/erp/ai-assistant')
        .set('Authorization', `Bearer ${warehouseToken}`)
        .send({
          message: 'What is my current net profit estimate?'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.reply).toBeDefined();
    });
  });
});
