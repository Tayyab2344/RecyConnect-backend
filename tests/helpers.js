import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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
            id: user.id,
            email: user.email,
            role: user.role
        },
        process.env.JWT_SECRET || 'test-secret',
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
        materialType: 'PLASTIC',
        estimatedWeight: 10,
        pickupAddress: 'Test Address',
        status: 'ACTIVE',
        ...data
    };

    return prisma.listing.create({ data: defaultData });
}

/**
 * Create a test order
 */
export async function createTestOrder(buyerId, sellerId, listingId, data = {}) {
    const defaultData = {
        buyerId,
        sellerId,
        listingId,
        materialType: 'PLASTIC',
        weight: 10,
        pickupAddress: 'Test Address',
        status: 'PENDING',
        paymentMethod: 'CASH',
        ...data
    };

    return prisma.order.create({ data: defaultData });
}

export { request, prisma };
