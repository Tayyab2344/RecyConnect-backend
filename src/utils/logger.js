import winston from 'winston'
import fs from 'fs'
import path from 'path'

const isProduction = process.env.NODE_ENV === 'production'

// Configure transports based on environment
const transports = []

if (isProduction) {
  // In production (Vercel), only use console logging
  // Vercel captures console output in its log viewer
  transports.push(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    )
  }))
} else {
  // In development, use file logging
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
