# RecyConnect Backend

A Node.js backend API for the RecyConnect waste management and recycling platform.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v18 or higher)
- **npm** (v9 or higher)
- **PostgreSQL** (v14 or higher)
- **Git**

## Quick Start

### 1. Clone the Repository

```bash
git clone <repository-url>
cd RecyConnect-backend
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Configuration

Create a `.env` file in the root directory with the following variables:

```env
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/recyconnect?schema=public"

# JWT Secrets
JWT_ACCESS_SECRET=your_access_secret_key_here
JWT_REFRESH_SECRET=your_refresh_secret_key_here

# Server
PORT=5000
NODE_ENV=development

# Cloudinary (Image Upload)
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Email (Nodemailer)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your_email@gmail.com
EMAIL_PASSWORD=your_app_password

# Frontend URL (CORS)
FRONTEND_URL=http://localhost:3000
```

### 4. Database Setup

```bash
# Generate Prisma Client
npx prisma generate

# Run database migrations
npx prisma db push

# (Optional) Seed the database
npm run prisma db seed
```

### 5. Run the Application

**Development Mode:**
```bash
npm run dev
```

**Production Mode:**
```bash
npm start
```

The server will start on `http://localhost:5000` (or your specified PORT).

## Project Structure

```
RecyConnect-backend/
├── prisma/
│   ├── schema.prisma          # Database schema
│   └── seed.js                # Database seeding script
├── src/
│   ├── config/                # Configuration files
│   ├── constants/             # Enums and constants
│   ├── controllers/           # Request handlers
│   ├── middlewares/           # Auth, error, and validation middleware
│   ├── routes/                # API routes
│   ├── services/              # Business logic
│   ├── utils/                 # Helper functions
│   └── index.js               # Application entry point
├── .env                       # Environment variables
├── package.json
└── README.md
```

## API Documentation

Once the server is running, access the Swagger API documentation at:

```
http://localhost:5000/api-docs
```

### Key Endpoints

#### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/verify-otp` - Email verification
- `POST /api/auth/refresh-token` - Refresh access token
- `POST /api/auth/logout` - User logout

#### User Management
- `GET /api/user/profile` - Get user profile
- `PUT /api/user/profile` - Update user profile
- `PUT /api/user/change-password` - Change password

#### Listings
- `GET /api/listings` - Get all listings (with filters)
- `POST /api/listings` - Create new listing
- `GET /api/listings/:id` - Get listing details
- `PUT /api/listings/:id` - Update listing
- `DELETE /api/listings/:id` - Delete listing

#### Orders
- `GET /api/orders` - Get user orders
- `POST /api/orders` - Create new order
- `PUT /api/orders/:id/status` - Update order status

#### Admin
- `GET /api/admin/users` - Get all users
- `PUT /api/admin/users/:id/suspend` - Suspend/activate user
- `GET /api/admin/dashboard` - Dashboard statistics
- `GET /api/admin/logs` - System activity logs

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Run the server in production mode |
| `npm run dev` | Run the server in development mode with nodemon |
| `npm test` | Run test suite |
| `npm run prisma` | Access Prisma CLI |

## Technology Stack

- **Framework:** Express.js
- **Database:** PostgreSQL with Prisma ORM
- **Authentication:** JWT (JSON Web Tokens)
- **File Upload:** Cloudinary
- **Email:** Nodemailer
- **Validation:** Express Validator
- **Documentation:** Swagger
- **Security:** Helmet, CORS, Rate Limiting
- **Logging:** Winston & Morgan

## Security Features

- JWT-based authentication with 45-day token expiration
- Password hashing with bcrypt
- Rate limiting to prevent abuse
- Helmet for HTTP header security
- CORS configuration
- Input validation and sanitization

## Deployment

### Environment Variables for Production

Ensure all environment variables are properly set in your production environment, especially:
- `NODE_ENV=production`
- `DATABASE_URL` (production database)
- Strong `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`
- Valid Cloudinary credentials

### Running on Production

```bash
# Install dependencies
npm install --production

# Run database migrations
npx prisma db push

# Start the server
npm start
```

### Deployment
For detailed instructions on deploying to **Render** with **Neon PostgreSQL**, please refer to [DEPLOYMENT.md](./DEPLOYMENT.md).

## Mobile App Connection

To allow the mobile app (APK) to connect to the backend running on your local machine:

1. Find your local IP address:
   - Windows: `ipconfig` → Look for IPv4 Address
   - Mac/Linux: `ifconfig` → Look for inet address

2. The server is configured to listen on `0.0.0.0`, allowing external connections.

3. Update the frontend API base URL to: `http://YOUR_LOCAL_IP:5000/api`

## Troubleshooting

### Database Connection Issues
```bash
# Verify database is running
# Check DATABASE_URL in .env
# Run: npx prisma db push
```

### Port Already in Use
```bash
# Change PORT in .env file
# Or kill the process using the port
```

### Prisma Client Not Found
```bash
npx prisma generate
```

## Support

For issues, questions, or contributions, please contact the development team.

## License

This project is licensed under the ISC License.
