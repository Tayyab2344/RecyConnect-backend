import nodemailer from 'nodemailer'
import dotenv from 'dotenv'
import { queueOfflineRequest, registerQueueHandler } from '../lib/queueManager.js'
import { logger } from '../utils/logger.js'
dotenv.config()

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
})

export async function sendEmail({ to, subject, text, html }) {
  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      text,
      html
    });
    return info;
  } catch (error) {
    logger.warn(`[EMAIL] Failed to send email to ${to}: ${error.message}. Queueing for later.`);
    
    // Add to offline queue directly
    await queueOfflineRequest('SEND_EMAIL', { to, subject, text, html });
    return null;
  }
}

// Register the handler for the background processor
registerQueueHandler('SEND_EMAIL', async (payload) => {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: payload.to,
    subject: payload.subject,
    text: payload.text,
    html: payload.html
  });
});
