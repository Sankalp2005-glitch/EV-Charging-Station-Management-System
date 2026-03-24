# Deployment

This project is set up for:

- Railway: MySQL
- Render: Flask backend
- Vercel: static frontend

## Backend

The backend reads configuration from environment variables.

Required:

- `APP_ENV=production`
- `SECRET_KEY`
- `MYSQL_URL` or `DATABASE_URL` from Railway
- `FRONTEND_ORIGIN` or `CORS_ALLOWED_ORIGINS`

In production the backend now fails fast if any of the values above are missing,
instead of falling back to local-development defaults.

Render start command:

```bash
gunicorn --pythonpath backend --worker-class eventlet -w 1 backend.app:app
```

Health check path:

```text
/healthz
```

## Frontend

The frontend uses `frontend/js/runtime-config.js` for the backend URL.

For Vercel deployments, the build step generates that file from:

- `EVGO_API_BASE`
- `EVGO_SOCKET_BASE`

Vercel project settings should use:

- Root Directory: repository root (`.`)
- Build Command: `npm run build:frontend`
- Output Directory: `frontend`

If you are not using Vercel, you can copy `frontend/js/runtime-config.example.js`
over `frontend/js/runtime-config.js` and replace the placeholder Render URL.

## Database

Import the schema from:

```text
database/ev_project_setup.sql
```
