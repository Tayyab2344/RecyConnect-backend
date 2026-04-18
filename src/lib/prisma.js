import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import { logger } from '../utils/logger.js';

dotenv.config({ quiet: true });

// Use a global variable to avoid creating multiple Prisma clients in serverless environments
const globalForPrisma = globalThis;

let prismaInstance;

if (!globalForPrisma.prisma) {
  if (!process.env.DATABASE_URL && process.env.NODE_ENV !== 'test') {
    throw new Error('DATABASE_URL is required before Prisma can connect');
  }

  prismaInstance = new PrismaClient({
    log: process.env.NODE_ENV === 'development'
      ? [
          { emit: 'event', level: 'query' },
          { emit: 'stdout', level: 'error' },
          { emit: 'stdout', level: 'warn' },
        ]
      : ['error', 'warn'],
  });
} else {
  prismaInstance = globalForPrisma.prisma;
}

const prisma = prismaInstance;

// Slow query logging in development
if (process.env.NODE_ENV === 'development') {
  prisma.$on('query', (e) => {
    if (e.duration > 500) {
      logger.warn(`⚠️ Slow query (${e.duration}ms): ${e.query.substring(0, 200)}`);
      
      // Provide EXPLAIN ANALYZE command for developers
      if (e.query.trim().toUpperCase().startsWith('SELECT')) {
        logger.info(`👉 To diagnose, run: EXPLAIN ANALYZE ${e.query}`);
        if (e.params && e.params !== '[]') {
          logger.info(`👉 With params: ${e.params}`);
        }
      }
    }
  });
}

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
