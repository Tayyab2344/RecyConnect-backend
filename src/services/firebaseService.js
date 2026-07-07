import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import admin from "firebase-admin";
import jwt from "jsonwebtoken";
import { logger } from "../utils/logger.js";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultServiceAccountPath = path.resolve(
  __dirname,
  "../../recyconnect-4ec01-firebase-adminsdk-fbsvc-8ea0ba1b14.json",
);

class CustomCredential {
  constructor(serviceAccount) {
    this.serviceAccount = serviceAccount;
    this.cachedToken = null;
    this.expiresAt = 0;
  }

  async getAccessToken() {
    if (this.cachedToken && this.expiresAt > Date.now() + 60000) {
      return this.cachedToken;
    }

    try {
      const iat = Math.floor(Date.now() / 1000);
      const exp = iat + 3600;
      const payload = {
        iss: this.serviceAccount.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: this.serviceAccount.token_uri,
        exp: exp,
        iat: iat,
      };

      const assertionToken = jwt.sign(payload, this.serviceAccount.private_key, {
        algorithm: "RS256",
      });

      const res = await fetch(this.serviceAccount.token_uri, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: assertionToken,
        }),
      });

      if (!res.ok) {
        throw new Error(`Google OAuth returned ${res.status}: ${await res.text()}`);
      }

      const data = await res.json();
      this.cachedToken = {
        access_token: data.access_token,
        expires_in: data.expires_in,
      };
      this.expiresAt = Date.now() + data.expires_in * 1000;
      return this.cachedToken;
    } catch (e) {
      logger.error(`[FIREBASE] CustomCredential token fetch error: ${e.message}`);
      throw e;
    }
  }
}

function initializeFirebaseAdmin() {
  if (admin.apps.length) {
    return admin;
  }

  try {
    let serviceAccount;
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } else {
      const serviceAccountPath =
        process.env.FIREBASE_SERVICE_ACCOUNT_PATH || defaultServiceAccountPath;
      serviceAccount = require(serviceAccountPath);
    }

    admin.initializeApp({
      credential: new CustomCredential(serviceAccount),
      projectId: serviceAccount.project_id,
    });
    logger.info("[FIREBASE] Admin SDK initialized with CustomCredential");
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
      data: {
        ...data,
        title: title || '',
        message: body || '',
      },
      android: {
        priority: "high",
        notification: {
          channelId: "orders",
          sound: "default",
          priority: "high",
        },
      },
      apns: {
        headers: {
          "apns-priority": "10",
        },
        payload: {
          aps: {
            sound: "default",
            badge: 1,
            "content-available": 1,
          },
        },
      },
    });

    return { success: true, messageId };
  } catch (err) {
    logger.warn(`[FIREBASE] Push notification failed: ${err.message}`);
    return { success: false, reason: err.message };
  }
}
