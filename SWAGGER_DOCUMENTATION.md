# RecyConnect API - Swagger Documentation

## Overview
Complete Swagger/OpenAPI 3.0 documentation has been added to all API endpoints in the RecyConnect backend.

## Access Swagger UI
Once the server is running, access the interactive API documentation at:
```
http://localhost:5000/api-docs
```

## Documentation Coverage

### 1. Authentication Endpoints (`/api/auth`)
- ✅ **POST /api/auth/register** - Register new users (individual, warehouse, company)
- ✅ **POST /api/auth/verify-otp** - Verify email with OTP
- ✅ **POST /api/auth/login** - Login with email/collectorId and password
- ✅ **POST /api/auth/forgot-password** - Request password reset OTP
- ✅ **POST /api/auth/reset-password** - Reset password with OTP
- ✅ **POST /api/auth/change-password** - Change password (authenticated)
- ✅ **POST /api/auth/register-collector** - Complete collector registration
- ✅ **GET /api/auth/me** - Get current user profile
- ✅ **PUT /api/auth/me** - Update user profile
- ✅ **POST /api/auth/logout** - Logout user
- ✅ **POST /api/auth/refresh** - Refresh access token

### 2. Warehouse Endpoints (`/api/warehouse`)
- ✅ **POST /api/warehouse/add-collector** - Create new collector ID

### 3. Collector Endpoints (`/api/collector`)
- ✅ **GET /api/collector/me** - Get collector profile

### 4. Admin Endpoints (`/api/admin`)
- ✅ **GET /api/admin/logs** - Get activity logs with filtering and pagination
- ✅ **GET /api/admin/logs/:id** - Get specific activity log by ID

## Key Features

### Comprehensive Schema Definitions
- **User Schema**: Complete user object with all role-specific fields
- **ActivityLog Schema**: Detailed activity log structure
- **Error Schema**: Standardized error response format

### Detailed Request/Response Examples
Each endpoint includes:
- Request body schemas with required fields
- Query parameter descriptions
- Response schemas for all status codes
- Example payloads

### Security Documentation
- Bearer token authentication clearly documented
- Role-based access control indicated for protected endpoints
- Security requirements specified per endpoint

### Advanced Features
- **Multipart form data** support for file uploads (documents, images)
- **Pagination** parameters for list endpoints
- **Filtering** options for admin logs
- **Date range** queries for activity logs

## Files Modified

1. **src/routes/authRoute.js** - Added comprehensive docs for all 11 auth endpoints
2. **src/routes/warehouseRoute.js** - Added docs for collector management
3. **src/routes/collectorRoutes.js** - Added docs for collector profile endpoint
4. **src/routes/adminRoute.js** - Added docs for admin logging endpoints
5. **src/utils/swagger.js** - Enhanced with detailed API description, servers, and contact info

## Testing the Documentation

1. Start the server:
   ```bash
   npm start
   ```

2. Open browser and navigate to:
   ```
   http://localhost:5000/api-docs
   ```

3. You can:
   - Browse all endpoints organized by tags (Auth, Warehouse, Collector, Admin)
   - View detailed request/response schemas
   - Try out endpoints directly from the UI
   - Authenticate using the "Authorize" button with your JWT token

## API Tags Organization

- **Auth** - User authentication and profile management (11 endpoints)
- **Warehouse** - Warehouse-specific operations (1 endpoint)
- **Collector** - Collector-specific operations (1 endpoint)
- **Admin** - Admin monitoring and logs (2 endpoints)

## Next Steps

To further enhance the documentation:
1. Add more example responses with actual data
2. Include error code documentation
3. Add rate limiting information
4. Document webhook endpoints (if any)
5. Add API versioning strategy
6. Include authentication flow diagrams

## Notes

- All endpoints follow OpenAPI 3.0 specification
- Documentation is auto-generated from JSDoc comments in route files
- Schemas are reusable across endpoints
- Security schemes are globally defined

