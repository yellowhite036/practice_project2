# practice_project2 Backend

Node.js / Express API for the WMS + MES prototype.

## Environment

The PostgreSQL pool reads connection settings from environment variables:

```text
DATABASE_HOST
DATABASE_PORT
DATABASE_NAME
DATABASE_USER
DATABASE_PASSWORD
```

This issue intentionally does not add `.env` handling.

## Commands

```bash
npm install
npm test
npm start
```

## Health Check

```text
GET /api/health
```

The health check runs `SELECT 1` against PostgreSQL and returns a JSON response.
