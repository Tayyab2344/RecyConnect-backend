# RecyConnect API - Quick Reference Guide

## Base URL
```
Development: http://localhost:5000
Production: https://api.recyconnect.com
```

## Authentication
Most endpoints require a Bearer token:
```
Authorization: Bearer <your_access_token>
```

---



### Register User
```http
POST /api/auth/register
Content-Type: multipart/form-data

Required fields (role-dependent):
- role: individual | warehouse | company
- email: string
- password: string (min 6 chars)
- name: string (for individual)
- businessName: string (for warehouse)
- companyName: string (for company)
- cnic: file (for warehouse/company)
- utility: file (for company)
- ntn: file (for company)
```

### Verify Email
```http
POST /api/auth/verify-otp
Content-Type: application/json

{
  "email": "user@example.com",
  "otp": "123456"
}
```

### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "identifier": "user@example.com or COL-1234",
  "password": "password123"
}

Response:
{
  "success": true,
  "data": {
    "accessToken": "jwt_token",
    "refreshToken": "refresh_token",
    "role": "individual",
    "name": "John Doe"
  }
}
```

### Forgot Password
```http
POST /api/auth/forgot-password
Content-Type: application/json

{
  "email": "user@example.com"
}
```

### Reset Password
```http
POST /api/auth/reset-password
Content-Type: application/json

{
  "email": "user@example.com",
  "otp": "123456",
  "newPassword": "newpassword123"
}
```

### Change Password (Authenticated)
```http
POST /api/auth/change-password
Authorization: Bearer <token>
Content-Type: application/json

{
  "currentPassword": "oldpassword",
  "newPassword": "newpassword123"
}
```

### Register Collector
```http
POST /api/auth/register-collector
Content-Type: application/json

{
  "collectorId": "COL-1234",
  "password": "password123",
  "name": "John Doe"
}
```

### Get Profile
```http
GET /api/auth/me
Authorization: Bearer <token>
```

### Update Profile
```http
PUT /api/auth/me
Authorization: Bearer <token>
Content-Type: multipart/form-data

Fields:
- name: string
- businessName: string
- companyName: string
- profileImage: file
```

### Logout
```http
POST /api/auth/logout
Authorization: Bearer <token>
```

### Refresh Token
```http
POST /api/auth/refresh
Content-Type: application/json

{
  "refreshToken": "your_refresh_token"
}
```

---

## 🏭 Warehouse Endpoints

### Create Collector ID
```http
POST /api/warehouse/add-collector
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Collector Name" (optional)
}

Response:
{
  "success": true,
  "message": "Collector ID created",
  "collectorId": "COL-1234"
}
```

---

## 👷 Collector Endpoints

### Get Collector Profile
```http
GET /api/collector/me
Authorization: Bearer <token>
```

---

## 👨‍💼 Admin Endpoints

### Get Activity Logs
```http
GET /api/admin/logs?page=1&limit=20&action=LOGIN_SUCCESS&role=individual
Authorization: Bearer <token>

Query Parameters:
- q: search query
- action: filter by action type
- role: filter by user role
- userId: filter by user ID
- resourceType: filter by resource type
- from: start date (ISO 8601)
- to: end date (ISO 8601)
- page: page number (default: 1)
- limit: items per page (default: 20, max: 100)
```

### Get Specific Log
```http
GET /api/admin/logs/:id
Authorization: Bearer <token>
```

---

## 📊 Response Format

### Success Response
```json
{
  "success": true,
  "data": { ... },
  "message": "Optional message"
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "message": "Error description"
  }
}
```

---

## 🎭 User Roles
- **individual** - Regular users
- **warehouse** - Waste collection businesses
- **company** - Corporate entities
- **collector** - Waste collectors
- **admin** - System administrators

