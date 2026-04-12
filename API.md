# Dokumentace HTTP API

Server naslouchá na **`http://localhost:4000`** (viz `src/server.ts`).

## Obecné

- **CORS:** Povolené metody `GET`, `POST`, `PUT`, `DELETE`, `OPTIONS`. Hlavičky: `Content-Type`, `Authorization`, `X-Requested-With`. `credentials: true` (cookies mezi originem a API).
- **JSON:** Endpointy s tělem očekávají `Content-Type: application/json`, pokud není uvedeno jinak.
- **Session:** Better Auth používá **HTTP cookies**. Po přihlášení ukládejte cookies (např. `curl -c cookies.txt` při sign-in a `-b cookies.txt` u chráněných volání).

---

## GET `/health`

Kontrola dostupnosti služby.

| | |
|---|---|
| **Výstup (200)** | `{ "status": "ok" }` |

```bash
curl -sS http://localhost:4000/health
```

---

## GET `/api/users/providers`

Seznam podporovaných sociálních providerů a zda jsou nakonfigurované (env má `CLIENT_ID` i `CLIENT_SECRET`).

| | |
|---|---|
| **Výstup (200)** | `{ "providers": [ { "id": "google" \| "apple" \| "github" \| "facebook", "enabled": boolean } ] }` |

```bash
curl -sS http://localhost:4000/api/users/providers
```

---

## POST `/api/users/register`

Registrace e-mailem a heslem (interně proxy na Better Auth `POST /api/auth/sign-up/email`).

**Tělo (JSON):**

| Pole | Typ | Povinné |
|------|-----|---------|
| `email` | string | ano |
| `password` | string | ano |
| `callbackURL` | string | ne |

| | |
|---|---|
| **Chyba (400)** | `{ "error": "Email and password are required", "code": "INVALID_REGISTER_PAYLOAD" }` |
| **Úspěch** | Odpověď a status z Better Auth (JSON), včetně `Set-Cookie` podle konfigurace. |

```bash
curl -sS -X POST http://localhost:4000/api/users/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@example.com","password":"secretpassword","callbackURL":"https://app.example.com/verify"}'
```

---

## POST `/api/users/password/forgot`

Žádost o reset hesla (proxy na `POST /api/auth/request-password-reset`).

**Tělo (JSON):**

| Pole | Typ | Povinné |
|------|-----|---------|
| `email` | string | ano |
| `redirectTo` | string | ne (kam přesměrovat po kliknutí v e-mailu) |

| | |
|---|---|
| **Chyba (400)** | `{ "error": "Email is required", "code": "INVALID_FORGOT_PASSWORD_PAYLOAD" }` |
| **Úspěch** | Odpověď z Better Auth. |

```bash
curl -sS -X POST http://localhost:4000/api/users/password/forgot \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@example.com","redirectTo":"https://app.example.com/reset"}'
```

---

## POST `/api/users/password/reset`

Dokončení resetu hesla tokenem z e-mailu (proxy na `POST /api/auth/reset-password`).

**Tělo (JSON):**

| Pole | Typ | Povinné |
|------|-----|---------|
| `token` | string | ano |
| `newPassword` | string | ano |

| | |
|---|---|
| **Chyba (400)** | `{ "error": "Token and newPassword are required", "code": "INVALID_RESET_PASSWORD_PAYLOAD" }` |
| **Úspěch** | Odpověď z Better Auth. |

```bash
curl -sS -X POST http://localhost:4000/api/users/password/reset \
  -H 'Content-Type: application/json' \
  -d '{"token":"RESET_TOKEN_FROM_EMAIL","newPassword":"newsecret"}'
```

---

## POST `/api/users/password/set`

Nastavení hesla pro účet, který ještě nemá heslo (např. anonymní účet). Vyžaduje platnou session.

**Hlavičky:** cookie se session (po přihlášení).

**Tělo (JSON):**

| Pole | Typ | Povinné |
|------|-----|---------|
| `newPassword` | string | ano |

| | |
|---|---|
| **Chyba (400)** | `{ "error": "newPassword is required", "code": "INVALID_SET_PASSWORD_PAYLOAD" }` |
| **Chyba (401)** | `{ "error": "Unauthorized access", "code": "UNAUTHORIZED" }` |
| **Chyba (409)** | `{ "error": "Password is already set for this account", "code": "PASSWORD_ALREADY_SET" }` |
| **Úspěch (200)** | Tělo vrácené `auth.api.setPassword` (Better Auth). |

```bash
curl -sS -X POST http://localhost:4000/api/users/password/set \
  -H 'Content-Type: application/json' \
  -b cookies.txt \
  -d '{"newPassword":"mynewpassword"}'
```

---

## GET `/api/users/me`

Profil aktuálně přihlášeného uživatele a stav auth (anonymní účet, heslo, napojené providery).

**Hlavičky:** cookie se session.

| | |
|---|---|
| **Chyba (401)** | `{ "error": "Unauthorized access" }` |
| **Úspěch (200)** | `{ "user": { ... }, "auth": { "isAnonymous": boolean, "hasPassword": boolean, "providers": string[] } }` — `providers` jsou hodnoty `providerId` z tabulky účtů (např. `"credential"`, `"google"`). |

```bash
curl -sS http://localhost:4000/api/users/me -b cookies.txt
```

---

## GET `/api/turn/credentials`

Vrátí zjednodušený výřez ICE serverů pro WebRTC (STUN URL, TURN URL, uživatelské jméno a credential pro TURN). Vyžaduje platnou session. Volá upstream Cloudflare TURN API (`CF_TURN_*` env).

**Hlavičky:** cookie se session.

| | |
|---|---|
| **Chyba (401)** | `{ "error": "Unauthorized", "code": "UNAUTHORIZED" }` |
| **Chyba (500)** | `{ "error": "Missing TURN configuration", "code": "TURN_CONFIG_MISSING" }` |
| **Chyba (502)** | `{ "error": "Unable to fetch TURN credentials", "code": "TURN_FETCH_FAILED" }` |
| **Chyba (504)** | `{ "error": "TURN upstream timeout", "code": "TURN_UPSTREAM_TIMEOUT" }` |
| **Upstream chyba** | Status z upstreamu; tělo obsahuje mimo jiné `code`: `TURN_UPSTREAM_ERROR`, `status`, `upstream`. |
| **Úspěch (200)** | `{ "stun": string[], "turn": string[], "turnUsername": string \| null, "turnCredential": string \| null }` |
| **Ne-JSON odpověď upstreamu** | `{ "data": string }` (textová odpověď) |

Odpověď má hlavičku `Cache-Control: no-store`.

```bash
curl -sS http://localhost:4000/api/turn/credentials -b cookies.txt
```

---

## Better Auth: `GET` a `POST` `/api/auth/*`

Všechny cesty pod `/api/auth/` jdou na interní Better Auth handler (`auth.handler`). Podporované jsou metody **GET** a **POST** (viz `src/server.ts`).

Typické cesty zmiňované v projektu (`README.md`):

| Cesta | Metoda | Poznámka |
|-------|--------|----------|
| `/api/auth/sign-up/email` | POST | Registrace e-mail/heslo (tělo obvykle `email`, `password`, volitelně `name`, …) |
| `/api/auth/sign-in/email` | POST | Přihlášení e-mail/heslo |
| `/api/auth/sign-in/social` | POST | Přihlášení sociálním providerem |
| `/api/auth/request-password-reset` | POST | Reset hesla (duplicitní k `/api/users/password/forgot`) |
| `/api/auth/reset-password` | POST | Dokončení resetu (duplicitní k `/api/users/password/reset`) |
| `/api/auth/verify-email` | GET | Ověření e-mailu (často přes query parametry z odkazu v mailu) |
| `/api/auth/link-social` | POST | Propojení sociálního účtu |

Přesné schéma těla a query parametrů se řiďte [dokumentací Better Auth](https://www.better-auth.com/docs) — repozitář neobsahuje OpenAPI pro všechny podcesty.

**Příklad přihlášení a uložení cookies:**

```bash
curl -sS -X POST http://localhost:4000/api/auth/sign-in/email \
  -H 'Content-Type: application/json' \
  -c cookies.txt \
  -d '{"email":"user@example.com","password":"secretpassword"}'
```

**Chyba handleru (500):**

```json
{ "error": "Internal authentication error", "code": "AUTH_FAILURE" }
```

---

## Socket.IO (realtime, není REST)

Na stejném HTTP serveru běží **Socket.IO**. Klient se připojuje standardním handshake (typicky `GET` s upgrade na WebSocket). Připojení vyžaduje platnou session v cookie (stejně jako HTTP).

Hlavní události (název → směr):

| Událost | Směr | Stručný popis |
|---------|------|----------------|
| `join_lobby` | klient → server | Volitelně `{ page?: number }`; připojí do místnosti lobby a pošle `lobby_update`. |
| `lobby_update` | server → klient | `{ games, total, page }` |
| `request_lobby_page` | klient → server | `{ page: number }` |
| `leave_lobby` | klient → server | Opustí lobby místnost. |
| `create_game` | klient → server | `{ name: string, isPrivate: boolean }` + callback `{ roomId }` nebo emit `game_created`. |
| `join_game` | klient → server | `{ roomId: string }` + callback `{ success, game?, error? }`; emit `player_joined` ostatním v místnosti. |
| `leave_game` | klient → server | `{ roomId: string }` |
| `player_joined` | server → klient | stav hry |
| `player_left` | server → klient | stav hry |
| `game_started` | server → klient | hra |
| `game_closed` | server → klient | hra zrušena |
| `start_game` | klient → server | `{ roomId: string }` + callback `{ success, error? }` |

`roomId` pro herní místnosti má formát `LLDD`, například `MA23` nebo `DE47`.
Používají se pouze písmena `ABCDEFGHJKLMNPQRSTUVWXYZ` a číslice `23456789`, takže jsou vynechané matoucí znaky `I`, `O`, `0`, `1`.

Detailní logika je v `src/lib/socket.ts`.
