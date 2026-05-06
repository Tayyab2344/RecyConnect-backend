import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import admin from "firebase-admin";
import { logger } from "../utils/logger.js";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultServiceAccountPath = path.resolve(
  __dirname,
  "../../recyconnect-4ec01-firebase-adminsdk-fbsvc-8ea0ba1b14.json",
);

function initializeFirebaseAdmin() {
  if (admin.apps.length) {
    return admin;
  }

  const serviceAccountPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH || defaultServiceAccountPath;

  try {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    logger.info("[FIREBASE] Admin SDK initialized");
  } catch (err) {
    logger.warn(`[FIREBASE] Admin SDK not initialized: ${err.message}`);
  }

  return admin;
}

export async function sendPushNotification({ token, title, body, data = {} }) {
  if (!token) {
    return { success: false, reason: "missing-token" };
  }

  const firebaseAdmin = initializeFirebaseAdmin();
  if (!firebaseAdmin.apps.length) {
    return { success: false, reason: "firebase-not-initialized" };
  }

  try {
    const messageId = await firebaseAdmin.messaging().send({
      token,
      notification: { title, body },
      data,
      android: {
        priority: "high",
        notification: {
          channelId: "orders",
          sound: "default",
        },
      },
    });

    return { success: true, messageId };
  } catch (err) {
    logger.warn(`[FIREBASE] Push notification failed: ${err.message}`);
    return { success: false, reason: err.message };
  }
}
