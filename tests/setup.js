import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
import { jest } from '@jest/globals';

// Mock Redis entirely to prevent hanging connections
jest.mock('ioredis', () => {
    return jest.fn().mockImplementation(() => {
        return {
            get: jest.fn().mockResolvedValue(null),
            setex: jest.fn().mockResolvedValue('OK'),
            incr: jest.fn().mockResolvedValue(1),
            expire: jest.fn().mockResolvedValue(1),
            del: jest.fn().mockResolvedValue(1),
            keys: jest.fn().mockResolvedValue([]),
            zadd: jest.fn().mockResolvedValue(1),
            zrevrange: jest.fn().mockResolvedValue([]),
            pipeline: jest.fn().mockReturnValue({
                del: jest.fn().mockReturnThis(),
                zadd: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue([])
            }),
            lpush: jest.fn().mockResolvedValue(1),
            rpop: jest.fn().mockResolvedValue(null),
            llen: jest.fn().mockResolvedValue(0),
            on: jest.fn(),
            quit: jest.fn().mockResolvedValue('OK'),
            disconnect: jest.fn()
        };
    });
});

import prisma from '../src/lib/prisma.js';
import { logger } from '../src/utils/logger.js';

// Suppress Winston DB writing during tests
logger.silent = true;

// Set test-specific environment variables if not already set
if (!process.env.JWT_ACCESS_SECRET) {
    process.env.JWT_ACCESS_SECRET = 'test-secret-key-for-jest-testing';
}

// Global test setup with retry for Neon cold-start resilience
beforeAll(async () => {
    let retries = 3;
    while (retries > 0) {
        try {
            await prisma.$connect();
            console.log('Test database connected');
            return;
        } catch (err) {
            retries--;
            if (retries === 0) throw err;
            console.log(`DB connection failed, retrying in 3s... (${retries} retries left)`);
            await new Promise(r => setTimeout(r, 3000));
        }
    }
});

// Cleanup after each test
afterEach(async () => {
    // Optionally clean things
});

// Disconnect between test suites to prevent connection exhaustion.
// Jest isolates modules per test file, so each suite gets a new PrismaClient instance.
// Without disconnecting, Neon connection pools will quickly reach their max connection limit.
afterAll(async () => {
    await prisma.$disconnect();
});

export { prisma };
