# RecyConnect Backend

A complete backend API for the RecyConnect waste management and recycling marketplace platform. This system enables individuals, warehouses, and companies to buy and sell recyclable materials with integrated Stripe payments and COD support.

---

## Table of Contents

1. [Project Scope](#project-scope)
2. [Entity Relationships](#entity-relationships)
3. [Order & Payment Flow](#order--payment-flow)
4. [Payment Rules (COD vs Stripe)](#payment-rules-cod-vs-stripe)
5. [Prerequisites](#prerequisites)
6. [Quick Start](#quick-start)
7. [API Endpoints](#api-endpoints)
8. [Testing](#testing)
9. [Technology Stack](#technology-stack)

---

## Project Scope

### What's Included ✅

| Feature | Description |
|---------|-------------|
| **User Authentication** | Registration, login, email OTP verification, JWT tokens |
| **Role-Based Access** | Individual, Warehouse, Company, Admin, Collector |
| **Listing Management** | Create, update, delete, publish/pause listings |
| **Inventory Reservation** | Time-limited reservation (20 min TTL) with quantity lock |
| **Order Management** | Create from reservation, confirm, complete, cancel |
| **Stripe Payments** | PaymentIntent flow with manual capture |
| **COD Payments** | Cash on Delivery for individual sellers |
| **Auto Refunds** | Automatic refund on order cancellation |
| **State Machine** | Strict state transitions with validation |
| **Idempotency** | Prevents duplicate payments, reservations |
| **Activity Logging** | All actions are logged for audit |
| **Admin Dashboard** | User management, KYC approval, reports |

---

## Entity Relationships

```
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│     User     │       │   Listing    │       │ Reservation  │
│──────────────│       │──────────────│       │──────────────│
│ id           │◄──────┤ userId       │◄──────┤ listingId    │
│ name         │       │ category     │       │ buyerId      │
│ email        │       │ materialType │       │ quantity     │
│ role         │       │ price        │       │ status       │
│ password     │       │ quantity     │       │ expiresAt    │
│ emailVerified│       │ status       │       │ orderId      │
└──────────────┘       │ images       │       └──────┬───────┘
        │              └──────────────┘              │
        │                                            │
        ▼                                            ▼
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│    Order     │◄──────┤  OrderItem   │       │   Payment    │
│──────────────│       │──────────────│       │──────────────│
│ id           │       │ orderId      │       │ orderId      │
│ buyerId      │       │ listingId    │       │ amount       │
│ sellerId     │       │ quantity     │       │ currency     │
│ totalAmount  │       │ priceAtTime  │       │ provider     │
│ status       │◄──────┼──────────────┘       │ status       │
└──────────────┘       │                      │ paymentIntentId
                       └──────────────────────┤              │
                                              └──────────────┘
```

### Key Relationships

- **User → Listings**: One-to-Many (seller creates listings)
- **User → Orders**: One-to-Many (as buyer or seller)
- **Listing → Reservations**: One-to-Many (multiple buyers can reserve)
- **Reservation → Order**: One-to-One (reservation becomes order)
- **Order → Payment**: One-to-One (one payment per order)
- **Order → OrderItems**: One-to-Many (order can have multiple items)

---

## Order & Payment Flow

### Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           SELLING FLOW                                   │
├─────────────────────────────────────────────────────────────────────────┤
│ Seller: Create Listing → Publish → [Listing PUBLISHED]                  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         RESERVATION FLOW                                 │
├─────────────────────────────────────────────────────────────────────────┤
│ Buyer: Reserve Quantity → [Reservation ACTIVE, Listing qty decreases]   │
│        ↳ If TTL expires: [Reservation EXPIRED, qty restored]            │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           BUYING FLOW                                    │
├─────────────────────────────────────────────────────────────────────────┤
│ Buyer: Create Order → [Order CREATED]                                   │
│ Seller: Confirm Order → [Order CONFIRMED, Reservation locked]           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
┌─────────────────────────────┐   ┌─────────────────────────────────────┐
│     COD PAYMENT FLOW        │   │         STRIPE PAYMENT FLOW          │
│ (Individual sellers only)   │   │    (Warehouse/Company sellers)       │
├─────────────────────────────┤   ├─────────────────────────────────────┤
│ Buyer: Create COD Payment   │   │ Buyer: Create PaymentIntent          │
│ → [Payment INITIATED]       │   │ → [Payment INITIATED]                │
│                             │   │ Buyer: Confirm Card (Stripe.js)      │
│ (Cash exchanged on delivery)│   │ Buyer: Authorize → [AUTHORIZED]      │
│                             │   │ Seller: Capture → [CAPTURED]         │
│ Seller: Confirm COD Receipt │   │                                      │
│ → [Payment CAPTURED]        │   │                                      │
└─────────────────────────────┘   └─────────────────────────────────────┘
                    │                               │
                    └───────────────┬───────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         COMPLETION FLOW                                  │
├─────────────────────────────────────────────────────────────────────────┤
│ Seller: Complete Order → [Order COMPLETED] (requires Payment CAPTURED)  │
│ Seller: Release Payment → [Payment RELEASED] ✓                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### State Transitions

#### Order States

| Current | Allowed Next | Trigger |
|---------|--------------|---------|
| - | CREATED | Buyer creates order |
| CREATED | CONFIRMED | Seller confirms |
| CREATED | CANCELLED | Buyer/Seller cancels |
| CONFIRMED | COMPLETED | Seller completes (payment captured) |
| CONFIRMED | CANCELLED | Buyer/Seller cancels (auto refund) |

#### Payment States

| Current | Allowed Next | Trigger |
|---------|--------------|---------|
| - | INITIATED | PaymentIntent or COD created |
| INITIATED | AUTHORIZED | Stripe card authorized |
| INITIATED | CAPTURED | COD cash received |
| INITIATED | FAILED | Payment declined/cancelled |
| AUTHORIZED | CAPTURED | Seller captures Stripe |
| AUTHORIZED | REFUNDED | Order cancelled |
| CAPTURED | RELEASED | Order completed |
| CAPTURED | REFUNDED | Order cancelled |

---

## Payment Rules (COD vs Stripe)

### Rule Matrix

| Seller Role | Buyer Role | COD | Stripe |
|-------------|------------|-----|--------|
| **Individual** | Any | ✅ | ✅ |
| **Warehouse** | Any | ❌ | ✅ |
| **Company** | Any | ❌ | ✅ |

### Why This Design?

1. **Individuals need cash**: They don't have business bank accounts or payment processing setup
2. **Warehouses/Companies need tracking**: Digital payments provide audit trail
3. **Security**: Large B2B transactions require traceable payments
4. **Simplicity**: No wallet system needed for MVP

### API Endpoint to Check

```http
GET /api/payments/methods/:orderId
```

Returns:
```json
{
  "sellerRole": "individual",
  "methods": [
    { "provider": "STRIPE", "available": true },
    { "provider": "COD", "available": true }
  ]
}
```

---

## Prerequisites

- **Node.js** v18+
- **npm** v9+
- **PostgreSQL** v14+
- **Stripe Account** (for test keys)

---

## Quick Start

### 1. Clone & Install

```bash
git clone <repository-url>
cd RecyConnect-backend
npm install
```

### 2. Environment Configuration

Create `.env` file:

```env
# Database
DATABASE_URL="postgresql://user:pass@localhost:5432/recyconnect"

# JWT (use strong random strings)
JWT_ACCESS_SECRET=your_access_secret_here
JWT_REFRESH_SECRET=your_refresh_secret_here

# Server
PORT=5000
NODE_ENV=development

# Stripe
STRIPE_SECRET_KEY=sk_test_your_stripe_key
STRIPE_CURRENCY=pkr

# Cloudinary
CLOUDINARY_CLOUD_NAME=your_cloud
CLOUDINARY_API_KEY=your_key
CLOUDINARY_API_SECRET=your_secret

# Email
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your_email@gmail.com
EMAIL_PASSWORD=your_app_password

# CORS
FRONTEND_URL=http://localhost:3000
```

### 3. Database Setup

```bash
npx prisma generate
npx prisma db push
npx prisma db seed   # Optional: seed with test data
```

### 4. Run Server

```bash
npm run dev     # Development
npm start       # Production
```

Server runs at `http://localhost:5000`

API docs at `http://localhost:5000/api-docs`

---

## API Endpoints

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register user |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/verify-otp` | Verify email |
| POST | `/api/auth/refresh-token` | Refresh JWT |

### Listings

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/listings` | Get all (with filters) |
| POST | `/api/listings` | Create listing |
| GET | `/api/listings/:id` | Get by ID |
| PUT | `/api/listings/:id` | Update |
| DELETE | `/api/listings/:id` | Delete |
| POST | `/api/listings/:id/publish` | Publish |
| POST | `/api/listings/:id/pause` | Pause |

### Reservations

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/reservations` | Reserve quantity |
| POST | `/api/reservations/:id/release` | Release reservation |
| GET | `/api/reservations/buyer` | Buyer's reservations |

### Orders

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/orders` | Create from reservation |
| POST | `/api/orders/:id/confirm` | Seller confirms |
| POST | `/api/orders/:id/complete` | Complete (after payment) |
| POST | `/api/orders/:id/cancel` | Cancel (auto refund) |
| GET | `/api/orders/buyer` | Buyer's orders |
| GET | `/api/orders/seller` | Seller's orders |

### Payments

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/payments/methods/:orderId` | Get available methods |
| POST | `/api/payments/create-intent` | Create Stripe payment |
| POST | `/api/payments/create-cod` | Create COD payment |
| POST | `/api/payments/:id/authorize` | Authorize Stripe |
| POST | `/api/payments/:id/capture` | Capture Stripe |
| POST | `/api/payments/:id/confirm-cod` | Confirm COD receipt |
| POST | `/api/payments/:id/release` | Release payment |
| POST | `/api/payments/:id/refund` | Refund payment |

---

## Testing

### Run Tests

```bash
npm test                    # All tests
npm test -- tests/payment.test.js   # Specific file
npm run test:coverage       # Coverage report
```

### Postman Testing

Import the Postman collection from `/postman/RecyConnect.postman_collection.json`

Test scenarios:
1. Individual seller + COD ✅
2. Individual seller + Stripe ✅
3. Warehouse seller + Stripe ✅
4. Warehouse seller + COD ❌ (must fail)

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js v18+ |
| Framework | Express.js |
| Database | PostgreSQL + Prisma ORM |
| Auth | JWT with refresh tokens |
| Payments | Stripe API |
| File Upload | Cloudinary |
| Email | Nodemailer |
| Docs | Swagger/OpenAPI |
| Testing | Jest + Supertest |
| Security | Helmet, CORS, Rate Limiting |

---

## License

ISC License

---

## Support

For questions or issues, contact the development team.
