# Taxi Management System (Backend)

A simple backend service for managing taxi operations with role-based access for Admins, Managers, and Drivers.

## Tech Stack
- Node.js + Express
- MongoDB with Mongoose
- JWT Authentication
- bcryptjs for password hashing

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Setup
Create a `.env` file:
```env
PORT=8080
MONGO_URI=mongodb://localhost:27017/taxi
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d
```

### 3. Run the Server
```bash
npm run dev
```
Server runs on `http://localhost:8080`

## API Authentication

All endpoints (except login) require a Bearer token in the Authorization header:
```
Authorization: Bearer <your-jwt-token>
```

## Basic API Usage

### 1. Login
```bash
POST /api/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "Admin@12345"
}
```

### 2. Create Client
```bash
POST /api/clients
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "John Doe",
  "phone": "+1234567890"
}
```

### 3. Create Destination
```bash
POST /api/destinations
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Airport",
  "address": "Main Terminal",
  "coordinates": {
    "lat": 31.5204,
    "lng": 74.3587
  }
}
```

### 4. Create Driver
```bash
POST /api/users
Authorization: Bearer <token>
Content-Type: application/json

{
  "username": "driver1",
  "email": "driver1@example.com",
  "password": "Driver@123",
  "fullName": "John Driver",
  "phone": "+1234567890",
  "role": "driver"
}
```

### 5. Assign Ride
```bash
POST /api/rides/assign
Authorization: Bearer <token>
Content-Type: application/json

{
  "clients": ["CLIENT_ID"],
  "from": "FROM_DESTINATION_ID",
  "to": "TO_DESTINATION_ID",
  "scheduledTime": "2025-08-28T10:00:00Z",
  "driver": "DRIVER_ID",
  "fare": {
    "total": 25.00,
    "perPerson": 25.00,
    "gst": 2.50
  },
  "notes": "Pickup instructions"
}
```

## User Roles & Permissions

### Admin/Manager Can:
- Create clients, destinations, users
- Assign rides to drivers
- View all rides
- Reassign rides between drivers

### Driver Can:
- View assigned rides
- Accept/cancel rides
- Mark rides as completed
- View own ride history

## Ride Status Flow
1. **assigned** → Driver receives ride assignment
2. **accepted** → Driver accepts the ride
3. **completed** → Driver completes the ride
4. **cancelled** → Driver or admin cancels the ride

## Driver Status
- **free** → Available for new rides
- **on_ride** → Currently assigned to a ride
- **dropped** → Not available (offline)

## Project Structure
```
backend/
├── src/
│   ├── app.js              # Express app
│   ├── server.js           # Server startup
│   ├── controllers/        # Route handlers
│   ├── routes/             # API routes
│   ├── models/             # Database models
│   ├── middleware/         # Auth & validation
│   └── config/             # Database & env config
├── package.json
└── .env
```

## Key Endpoints

| Method | Endpoint | Description | Access |
|--------|----------|-------------|---------|
| POST | `/api/auth/login` | User login | All |
| GET/POST | `/api/clients` | Manage clients | Admin/Manager |
| GET/POST | `/api/destinations` | Manage destinations | Admin/Manager |
| GET/POST | `/api/users` | Manage users | Admin/Manager |
| POST | `/api/rides/assign` | Assign new ride | Admin/Manager |
| GET | `/api/rides` | List rides | Admin/Manager |
| PUT | `/api/rides/:id/status` | Update ride status | Driver (own rides) |
| POST | `/api/rides/:id/reassign` | Reassign ride | Admin/Manager |

## Troubleshooting

### Common Issues:
1. **MongoDB Connection**: Ensure MongoDB is running and connection string is correct
2. **JWT Errors**: Check if JWT_SECRET is set in .env file
3. **Authorization**: Make sure to include Bearer token in headers
4. **Role Permissions**: Verify user has correct role for the operation

### Default Admin User:
- Username: `admin`
- Password: `Admin@12345`

## Development Notes
- Use `npm run dev` for development with auto-reload
- Check server logs for detailed error messages
- Ensure all required fields are provided in API requests
- IDs must be valid MongoDB ObjectIds
