import winston from 'winston'
import fs from 'fs'
import path from 'path'
import Transport from 'winston-transport'
import { getTraceId } from '../middlewares/traceMiddleware.js'

// We require prisma at runtime to avoid circular dependency loops during initialization
const getPrisma = async () => {
  const mod = await import('../lib/prisma.js');
  return mod.default;
};

// Custom Winston Transport to push logs natively to Neon DB
class PrismaTransport extends Transport {
  constructor(opts) {
    super(opts);
  }

  log(info, callback) {
    setImmediate(async () => {
      try {
        const prisma = await getPrisma();
        
        const { level, message, type = 'SYSTEM', ...meta } = info;
        
        // Prevent DB connection logs from looping recursively
        if (message && message.includes('PrismaClient')) return;
        
        // Prevent writing to DB in test runner environments
        if (process.env.NODE_ENV === 'test') return;

        // Inject current execution trace ID into metadata implicitly
        const currentTraceId = getTraceId();
        if (currentTraceId) {
            meta.traceId = currentTraceId;
        }

        await prisma.systemLog.create({
          data: {
            level,
            type: level === 'error' ? 'ERROR' : type,
            message,
            metadata: Object.keys(meta).length ? meta : null
          }
        });
      } catch (err) {
        // Fallback silently if DB logging fails to prevent crashing the app
        console.error('Failed to write log to DB:', err.message);
      }
    });

    if (callback) {
      callback();
    }
  }
}

const isProduction = process.env.NODE_ENV === 'production'
const isVercel = !!process.env.VERCEL

const transports = []

if (isProduction || isVercel) {
  // Vercel has a read-only filesystem — only use console transport
  transports.push(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    )
  }));
} else {
  const logsDir = path.resolve('logs')
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir)

  transports.push(
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/app.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  )
}

// Always attach the Database logger
transports.push(new PrismaTransport({
  level: 'info' // Logs info and above
}));

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports
})

const stream = {
  write: (message) => logger.info(message.trim())
}

export { logger, stream }
