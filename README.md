# one-on-one-be

## Auth

Backend authentication is handled by Better Auth behind `/api/auth/*` with thin convenience routes under `/api/users/*`.

### Required env

- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `DATABASE_URL`
- `CLIENT_ORIGIN`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`

### Optional social provider env

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `APPLE_CLIENT_ID`
- `APPLE_CLIENT_SECRET`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `FACEBOOK_CLIENT_ID`
- `FACEBOOK_CLIENT_SECRET`

### Main auth endpoints

- `POST /api/users/register`
- `POST /api/users/password/forgot`
- `POST /api/users/password/reset`
- `POST /api/users/password/set`
- `GET /api/users/providers`
- `GET /api/users/me`

### Native Better Auth endpoints used by the backend

- `POST /api/auth/sign-up/email`
- `POST /api/auth/sign-in/email`
- `POST /api/auth/sign-in/social`
- `POST /api/auth/request-password-reset`
- `POST /api/auth/reset-password`
- `GET /api/auth/verify-email`
- `POST /api/auth/link-social`

## Database exports

Run `npm run db:export` to refresh:

- `database/db_schema.sql`
- `database/pg_settings.txt`

The command reads `DATABASE_URL` from `.env` and requires PostgreSQL CLI tools with `pg_dump` and `psql` available on `PATH`.
