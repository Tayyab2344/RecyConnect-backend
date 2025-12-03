import swaggerJsdoc from "swagger-jsdoc";

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "RecyConnect API",
      version: "1.0.0",
      description: `
# RecyConnect Backend API

A comprehensive waste management and recycling platform API with automatic OCR-based KYC verification.

## Features
- **Multi-role Authentication**: Support for individuals, warehouses, companies, collectors, and admins
- **Automatic KYC Verification**: OCR-based document verification with instant approval/rejection
- **Document Management**: Upload and OCR processing for verification documents
- **Collector Management**: Warehouses can create and manage collector IDs
- **Activity Logging**: Comprehensive audit trail for all system actions
- **Secure Authentication**: JWT-based authentication with refresh tokens

## User Roles
- **Individual**: Regular users who can register and manage their profile (no KYC required)
- **Warehouse**: Businesses that manage waste collection and can create collector IDs (KYC required)
- **Company**: Corporate entities with additional NTN verification requirements (KYC required)
- **Collector**: Waste collectors registered by warehouses (KYC required)
- **Admin**: System administrators with access to logs, monitoring, and manual KYC override

## KYC Verification System
The system uses **automatic OCR-based verification** for business users:

### Auto-Approval Criteria
- ✅ CNIC successfully extracted from uploaded images (13 digits)
- ✅ CNIC format is valid and unique (no duplicates)
- ✅ For companies: NTN successfully extracted and valid (8 digits)

### Auto-Rejection Reasons
- ❌ OCR extraction failed (blurry/unclear images)
- ❌ Invalid CNIC/NTN format
- ❌ Duplicate CNIC (already registered)
- ❌ Missing required documents

### Manual Override
Admins can manually approve or reject KYC if needed using the admin endpoints.

## Authentication
Most endpoints require authentication using a Bearer token in the Authorization header:
\`\`\`
Authorization: Bearer <your_access_token>
\`\`\`

Use the \`/api/auth/login\` endpoint to obtain access and refresh tokens.
      `,
      contact: {
        name: "RecyConnect Support",
        email: "support@recyconnect.com",
      },
      license: {
        name: "MIT",
        url: "https://opensource.org/licenses/MIT",
      },
    },
    servers: [
      {
        url: "http://localhost:5000",
        description: "Development server",
      },
      {
        url: "https://api.recyconnect.com",
        description: "Production server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Enter your JWT token in the format: Bearer <token>",
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ["./src/routes/*.js", "./src/controllers/*.js"],
});
