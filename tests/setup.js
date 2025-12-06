// Load environment variables FIRST before any imports
import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Set test-specific environment variables if not already set
if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test-secret-key-for-jest-testing';
}

// Global test setup
beforeAll(async () => {
    // Connect to database
    await prisma.$connect();
    console.log('Test database connected');
});

// Cleanup after each test
afterEach(async () => {
    // Clean up test data if needed
});

// Global teardown
afterAll(async () => {
    await prisma.$disconnect();
    console.log('Test database disconnected');
});

export { prisma };
