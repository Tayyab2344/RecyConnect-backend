import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../src/lib/prisma.js';

/**
 * Create a test Express app with routes
 */
export function createTestApp(router, basePath = '/api') {
    const app = express();
    app.use(express.json());
    app.use(basePath, router);
    return app;
}

/**
 * Generate a mock JWT token for testing
 */
export function generateTestToken(user) {
    return jwt.sign(
        {
            userId: user.id,
            email: user.email,
            role: user.role
        },
        process.env.JWT_ACCESS_SECRET || 'test-secret-key-for-jest-testing',
        { expiresIn: '1h' }
    );
}

/**
 * Create a test user in the database
 */
export async function createTestUser(data = {}) {
    const defaultData = {
        name: 'Test User',
        email: `test${Date.now()}@test.com`,
        password: '$2b$10$XYZ', // Pre-hashed password
        role: 'individual',
        emailVerified: true,
        ...data
    };

    return prisma.user.create({ data: defaultData });
}

/**
 * Create an admin user for testing admin endpoints
 */
export async function createAdminUser() {
    return createTestUser({
        name: 'Test Admin',
        email: `admin${Date.now()}@test.com`,
        role: 'admin',
    });
}

/**
 * Clean up test users
 */
export async function cleanupTestUsers(emails) {
    await prisma.user.deleteMany({
        where: { email: { in: emails } }
    });
}

/**
 * Create a test listing
 */
export async function createTestListing(userId, data = {}) {
    const defaultData = {
        userId,
        category: 'PLASTIC',
        materialType: 'PLASTIC',
        estimatedWeight: 10,
        pickupAddress: 'Test Address',
        status: 'PUBLISHED',
        ...data
    };

    return prisma.listing.create({ data: defaultData });
}

/**
 * Create a test order
 */
export async function createTestOrder(buyerId, sellerId, listingId, data = {}) {
    const { materialType, weight, pickupAddress, ...orderData } = data;
    const quantity = weight || 10;
    const price = orderData.totalAmount || 100;

    const defaultData = {
        buyerId,
        sellerId,
        status: 'PENDING',
        paymentMethod: 'CASH',
        totalAmount: price,
        items: {
            create: {
                listingId,
                quantity,
                price
            }
        },
        ...orderData
    };

    return prisma.order.create({ 
        data: defaultData,
        include: { items: true }
    });
}

export { request, prisma };
