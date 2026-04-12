# API Endpoints

Current HTTP methods used in this backend: `GET`, `POST`.
There are currently no `PUT`, `PATCH`, or `DELETE` endpoints registered in the server routes.

## Health

- `GET /health` - Returns a simple status response to confirm that the backend is running.

## Authentication Proxy

- `GET /api/auth/*` - Proxies authentication-related read requests to the auth provider.
- `POST /api/auth/*` - Proxies authentication-related write requests to the auth provider.

## Users

- `GET /api/users/providers` - Returns the authentication providers that are currently configured for sign-in.
- `POST /api/users/register` - Creates a new user account with email and password.
- `POST /api/users/password/forgot` - Starts the password reset flow by sending a reset email.
- `POST /api/users/password/reset` - Completes the password reset using a reset token and a new password.
- `POST /api/users/password/set` - Lets an authenticated user set a password if the account does not have one yet.
- `GET /api/users/me` - Returns the current authenticated user together with auth and commerce state.

## Store

- `GET /api/store/offers` - Returns the list of active store offers available to the client.

## Purchases

- `POST /api/purchases/checkout` - Creates a development checkout flow for a selected offer.

## TURN

- `GET /api/turn/credentials` - Returns TURN and STUN credentials for real-time communication setup.
