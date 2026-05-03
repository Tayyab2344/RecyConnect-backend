<div align="center">
  <h1>⚙️ RecyConnect Backend API</h1>
  <p><strong>The robust, scalable, and secure engine powering the RecyConnect sustainable marketplace.</strong></p>

  [![Node.js Version](https://img.shields.io/badge/Node.js-18+-339933?logo=nodedotjs)](https://nodejs.org/)
  [![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma)](https://www.prisma.io/)
  [![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL-336791?logo=postgresql)](https://www.postgresql.org/)
  [![Express.js](https://img.shields.io/badge/Framework-Express-000000?logo=express)](https://expressjs.com/)
  [![License](https://img.shields.io/badge/License-ISC-green.svg)](#)
</div>

---

## 📖 Overview

The **RecyConnect Backend** is a complete, production-ready RESTful API designed to manage the complexities of a multi-tier recycling marketplace. It seamlessly orchestrates user roles, material listings, inventory reservations, state-machine-driven order fulfillment, and multi-provider payment processing (Stripe & Cash on Delivery).

---

## ✨ Core Features & Scope

| Feature | Description |
|---------|-------------|
| 🔐 **Authentication** | Secure JWT-based auth, password hashing (bcrypt), and email OTP verification. |
| 👥 **Role-Based Access** | Granular permissions for Individuals, Warehouses, Companies, and Admins. |
| 📦 **Listing Management** | CRUD operations with lifecycle states (Draft, Published, Paused). |
| ⏱️ **Inventory Reservation** | Time-limited holds (TTL) preventing double-selling, with auto-release mechanisms. |
| 🛒 **Order State Machine** | Strict state transitions (Created → Confirmed → Completed/Cancelled) ensuring data integrity. |
| 💳 **Stripe Payments** | Integrated `PaymentIntent` flows with manual capture, supporting large B2B transactions. |
| 💵 **COD Payments** | Cash on Delivery support strictly enforced for individual micro-sellers. |
| 🔄 **Auto Refunds** | Idempotent automatic refunds triggered upon order cancellation. |
| 📊 **Activity Logging** | Comprehensive audit trails for system transparency and admin reporting. |

---

## 🏛 Architecture & Entity Relationships

The database is built on **PostgreSQL** using the **Prisma ORM**, ensuring type safety and relational integrity.

```mermaid
erDiagram
    USER ||--o{ LISTING : "creates"
    USER ||--o{ ORDER : "buys/sells"
    LISTING ||--o{ RESERVATION : "has"
    RESERVATION ||--|| ORDER : "converts to"
    ORDER ||--o{ ORDER_ITEM : "contains"
    ORDER ||--|| PAYMENT : "processed via"
```

### Key Relationships
- **User → Listings**: One-to-Many (A seller manages multiple listings).
- **Listing → Reservations**: One-to-Many (Multiple buyers can hold temporary reservations).
- **Reservation → Order**: One-to-One (A finalized reservation converts into an active order).
- **Order → Payment**: One-to-One (Each order has a single, tracked payment ledger).

---

## 🛤 Order & Payment Lifecycle

The system utilizes a strict state machine to prevent race conditions and ensure transactional safety.

### 1. Purchasing Flow
1. **Listing Published:** Seller makes inventory available.
2. **Reservation Active:** Buyer reserves quantity (locks inventory).
3. **Order Created:** Reservation converts to an order.
4. **Order Confirmed:** Seller accepts the order.

### 2. Payment Flow Matrix

| Seller Role | Buyer Role | Available Methods | Rationale |
|-------------|------------|-------------------|-----------|
| **Individual** | Any | ✅ COD, ✅ Stripe | Individuals often prefer cash for micro-transactions. |
| **Warehouse** | Any | ❌ COD, ✅ Stripe | B2B requires traceable digital payments. |
| **Company** | Any | ❌ COD, ✅ Stripe | Corporate compliance mandates digital ledgers. |

### 3. State Transitions

* **Order States:** `CREATED` ➔ `CONFIRMED` ➔ `COMPLETED` (or `CANCELLED`).
* **Payment States:** `INITIATED` ➔ `AUTHORIZED` ➔ `CAPTURED` ➔ `RELEASED` (or `REFUNDED`).

---

## 🛠 Technology Stack

| Layer | Technology |
|-------|------------|
| **Runtime** | Node.js (v18+) |
| **Framework** | Express.js |
| **Database** | PostgreSQL (Neon Serverless) |
| **ORM** | Prisma |
| **Authentication**| JSON Web Tokens (JWT) + bcrypt |
| **Payments** | Stripe API |
| **Storage** | Cloudinary (Images/Media) |
| **Email Services**| Nodemailer |
| **Security** | Helmet, CORS, Express Rate Limit |
| **Testing** | Jest, Supertest |
| **Documentation** | Swagger / OpenAPI |

---

## 🚀 Getting Started

### Prerequisites
- **Node.js** (v18 or higher)
- **PostgreSQL** (v14 or higher)
- **Stripe Account** (for test keys)
- **Cloudinary Account** (for image uploads)

### 1. Clone & Install
```bash
git clone <repository-url>
cd RecyConnect-backend
npm install
```

### 2. Environment Configuration
Create a `.env` file in the root directory:

```env
# Database
DATABASE_URL="postgresql://user:pass@localhost:5432/recyconnect"

# JWT Secrets (Use strong random strings)
JWT_ACCESS_SECRET="your_access_secret_here"
JWT_REFRESH_SECRET="your_refresh_secret_here"

# Document Encryption (32 random bytes, base64 encoded)
DOCUMENT_ENCRYPTION_KEY="generate_with_openssl_rand_base64_32"
DOCUMENT_ENCRYPTION_KEY_VERSION="v1"

# Server
PORT=5000
NODE_ENV="development"
FRONTEND_URL="http://localhost:3000"

# External APIs
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_CURRENCY="pkr"
CLOUDINARY_CLOUD_NAME="..."
CLOUDINARY_API_KEY="..."
CLOUDINARY_API_SECRET="..."

# SMTP Email
EMAIL_HOST="smtp.gmail.com"
EMAIL_PORT=587
EMAIL_USER="your_email@gmail.com"
EMAIL_PASSWORD="your_app_password"
```

### 3. Database Initialization
```bash
npx prisma generate
npx prisma db push
npx prisma db seed   # Optional: Seed with mock data
```

### 4. Run the Server
```bash
npm run dev     # Starts Nodemon for local development
npm start       # Starts standard Node process for production
```
The server will run at `http://localhost:5000`. <br>
Interactive API documentation is available at `http://localhost:5000/api-docs`.

---

## 🌐 API Quick Reference

### Authentication
* `POST /api/auth/register` - Create a new user account
* `POST /api/auth/login` - Authenticate and receive JWT
* `POST /api/auth/verify-otp` - Verify email address

### Marketplace
* `GET /api/listings` - Fetch listings (with robust filtering)
* `POST /api/listings` - Create a new listing
* `POST /api/reservations` - Reserve quantity from a listing

### Orders & Payments
* `POST /api/orders` - Convert a reservation into an order
* `POST /api/payments/create-intent` - Initialize Stripe PaymentIntent
* `POST /api/payments/:id/capture` - Capture authorized funds

---

## 🧪 Testing

We employ `Jest` and `Supertest` to ensure endpoints and logic flows are rock-solid.

```bash
# Run the entire test suite
npm test

# Run a specific test file
npm test -- tests/payment.test.js

# Generate a detailed coverage report
npm run test:coverage
```

---

## 📦 Deployment (Vercel)

This backend is optimized for serverless deployment on **Vercel**.

1. Connect your GitHub repository to Vercel.
2. Set the Root Directory to `RecyConnect-backend`.
3. Add all variables from your `.env` to the Vercel Environment Variables settings.
4. (Note: Background cron jobs for expired reservations should be handled via Vercel Cron or an external scheduler like Upstash).

---

<div align="center">
  <p>Engineered with precision for a greener future. 🌱</p>
</div>
