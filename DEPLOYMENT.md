# RecyConnect Deployment Guide

This guide details how to deploy the RecyConnect backend to Render.com with a Neon PostgreSQL database.

## Prerequisites

- [x] Node.js 18+
- [x] Neon account (Database URL ready)
- [x] Render account (Connected to GitHub)
- [x] Cloudinary credentials
- [x] Service Email (Gmail/SMTP) credentials

## 1. Database Setup (Neon)

You have successfully provisioned a Neon database. The connection string format is:
`postgresql://<user>:<password>@<host>/<dbname>?sslmode=require`

**Action**: Keep this string safe. You will add it to Render's environment variables as `DATABASE_URL`.

## 2. Render Deployment

### Step 2.1: Create New Web Service
1. Log in to [Render Dashboard](https://dashboard.render.com).
2. Click **New +** -> **Web Service**.
3. Connect the `RecyConnect-backend` repository.

### Step 2.2: Configure Service
- **Name**: `recyconnect-backend`
- **Region**: Choose one close to your database (e.g., US East)
- **Branch**: `main` (or your working branch)
- **Root Directory**: `.` (leave empty)
- **Runtime**: `Node`
- **Build Command**: `npm install && npm run build` (This runs `prisma generate`)
- **Start Command**: `npm start`
- **Plan**: Free (or Starter for production performance)

### Step 2.3: Environment Variables
Scroll down to "Environment Variables" and add these **Key-Value** pairs:

| Key | Value | Description |
|-----|-------|-------------|
| `NODE_ENV` | `production` | Optimizes Express for production |
| `DATABASE_URL` | `postgresql://...` | Your full Neon connection string |
| `JWT_ACCESS_SECRET` | `...` | Strong random string for access tokens |
| `JWT_REFRESH_SECRET` | `...` | Strong random string for refresh tokens |
| `CLOUDINARY_CLOUD_NAME` | `...` | From Cloudinary Dashboard |
| `CLOUDINARY_API_KEY` | `...` | From Cloudinary Dashboard |
| `CLOUDINARY_API_SECRET` | `...` | From Cloudinary Dashboard |
| `SMTP_HOST` | `smtp.gmail.com` | Email service host |
| `SMTP_PORT` | `587` | Email service port |
| `SMTP_USER` | `...` | Your email address |
| `SMTP_PASS` | `...` | App-specific password (NOT login password) |
| `EMAIL_FROM` | `RecyConnect <...>` | Sender name configuration |
| `ADMIN_EMAIL` | `...` | For initial seeding/admin tasks |
| `ADMIN_PASSWORD` | `...` | For initial seeding/admin tasks |

> **Note**: `PORT` is automatically set by Render (usually 10000). You do not need to set it manually.

## 3. Post-Deployment Verification

Once deployed, Render will build and start your service.

1. **Check Logs**: Ensure "Server running on port..." appears.
2. **Health Check**: Open `https://<your-app-name>.onrender.com/health`. Expect `{"ok":true}`.
3. **Swagger Docs**: Open `https://<your-app-name>.onrender.com/api-docs` to view API implementation.

## 4. Frontend Integration

After successful backend deployment:

1. Copy your Render Backend URL (e.g., `https://recyconnect-backend.onrender.com`).
2. Update your Flutter `api_constants.dart` or `.env`:

```dart
// lib/core/constants/api_constants.dart
static const String baseUrl = "https://recyconnect-backend.onrender.com/api";
```

3. **Rebuild the App**: 
   - `flutter clean`
   - `flutter build apk --release`

## Troubleshooting

- **Database Connection Error**: Double-check `DATABASE_URL`. Ensure `?sslmode=require` is at the end.
- **Build Failed**: Check logs. Did `npm install` fail? Are all dependencies in `package.json`?
- **Images Not Uploading**: Verify `CLOUDINARY_*` credentials.
