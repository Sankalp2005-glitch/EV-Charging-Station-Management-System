# EV Charging System

EV Charging System is a role-based web application for managing EV charging stations, reservations, payments, and QR-based charging verification.

The project is split into:

- A Flask backend with MySQL and Socket.IO
- A static frontend in vanilla HTML, CSS, and JavaScript
- A MySQL schema for users, vehicles, stations, slots, bookings, sessions, and payments

## Roles

The app supports three main roles:

- `customer`: browse stations, create bookings, pay, and show booking QR codes
- `owner`: manage stations and slots, monitor bookings, and verify customer QR values
- `admin`: review stations, monitor system activity, and manage platform-level workflows

## Main Features

- User authentication with JWT-based session refresh
- Customer booking flow with charging estimates
- Station owner management for stations, chargers, and bookings
- Admin approval and oversight views
- QR-based booking confirmation and owner-side verification
- Customer and owner help workflow with ticketed support requests
- Real-time booking updates with Socket.IO
- MySQL-backed persistence for operational data

## Tech Stack

- Backend: Flask, Flask-CORS, Flask-MySQLdb, Flask-SocketIO
- Database: MySQL
- Frontend: HTML, CSS, JavaScript
- Deployment: Render backend, Vercel frontend, Railway MySQL

## Project Structure

```text
ev_charging_system/
|-- backend/                 Flask app, routes, services, auth, realtime
|-- database/                MySQL schema
|-- frontend/                Static pages, CSS, JS, assets
|-- scripts/                 Build helpers
|-- DEPLOYMENT.md            Deployment notes
|-- render.yaml              Render service config
|-- requirements.txt         Python dependencies
`-- vercel.json              Vercel frontend config
```

## Local Setup

### 1. Clone and open the project

```powershell
git clone <your-repo-url>
cd ev_charging_system
```

### 2. Create and activate a virtual environment

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
```

### 3. Install backend dependencies

```powershell
pip install -r requirements.txt
```

### 4. Configure environment variables

Copy `.env.example` to `.env` and fill in your local database values.

Required local values typically include:

- `SECRET_KEY`
- `MYSQL_HOST`
- `MYSQL_PORT`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_DB`

The backend loads `.env` automatically in development.

### 5. Set up the database

Import the schema from [`database/ev_project_setup.sql`](database/ev_project_setup.sql) into your target MySQL database.

That schema creates:

- `Users`
- `Vehicle`
- `ChargingStation`
- `StationApproval`
- `ChargingSlot`
- `Booking`
- `ChargingSession`
- `Payment`

It also inserts a default admin account record.

### 6. Run the backend

```powershell
.venv\Scripts\python.exe backend\app.py
```

The backend runs on `http://127.0.0.1:5000` by default.

### 7. Run the frontend

Serve the `frontend/` directory with any static server. For example:

```powershell
python -m http.server 5500 --directory frontend
```

Then open:

- `http://127.0.0.1:5500/login.html`

The generated frontend runtime config already falls back to `http://127.0.0.1:5000` when opened on localhost.

## Frontend Runtime Config

The frontend reads API settings from `frontend/js/runtime-config.js`.

For local development, it falls back to:

- `API_BASE=http://127.0.0.1:5000`
- `SOCKET_BASE=http://127.0.0.1:5000`

For production builds, `scripts/generate-runtime-config.mjs` uses:

- `EVGO_API_BASE`
- `EVGO_SOCKET_BASE`

Build the frontend config with:

```powershell
npm run build:frontend
```

## Environment Variables

Common backend environment variables:

- `APP_ENV`
- `SECRET_KEY`
- `MYSQL_URL` or `DATABASE_URL`
- `MYSQL_HOST`
- `MYSQL_PORT`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_DB`
- `MYSQL_CONNECT_TIMEOUT`
- `MYSQL_SSL_MODE`
- `FRONTEND_ORIGIN`
- `CORS_ALLOWED_ORIGINS`
- `SUPPORT_ADMIN_EMAIL`
- `SUPPORT_FROM_EMAIL`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USERNAME`
- `SMTP_PASSWORD`
- `SMTP_USE_TLS`
- `SMTP_USE_SSL`
- `SMTP_TIMEOUT`

## Deployment

This repo is set up for:

- Railway: MySQL
- Render: Flask backend
- Vercel: static frontend

Production backend requirements:

- `APP_ENV=production`
- `SECRET_KEY`
- `MYSQL_URL` or `DATABASE_URL`
- `FRONTEND_ORIGIN` or `CORS_ALLOWED_ORIGINS`

Render start command:

```bash
gunicorn --pythonpath backend --worker-class eventlet -w 1 backend.app:app
```

Vercel build command:

```bash
npm run build:frontend
```

See [`DEPLOYMENT.md`](DEPLOYMENT.md) for the existing deployment notes.

## Notes

- Localhost and your deployed site do not share the same database unless you explicitly point both environments to the same MySQL instance.
- QR image rendering depends on the backend having the Python image dependencies installed from `requirements.txt`.
- The frontend is static, so nearly all application logic and persistence flow through the backend API.
