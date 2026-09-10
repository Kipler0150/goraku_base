# Phase 5 walkthrough: PostgreSQL, local authentication, and libraries

Status: complete
Completion: complete

This walkthrough covers the implemented Phase 5 local/staging slice. Search remains public. Local email/password Sessions protect a user-owned library. Google authentication, account recovery, production rate limiting, and public deployment are deliberately future work.

## Outcome

Phase 5 adds:

- PostgreSQL persistence through `pg` and explicit forward-only SQL migrations.
- Local email/password registration and login.
- Seven-day, server-managed Sessions in an HTTP-only cookie.
- Exact browser Origin validation for API mutations.
- Ownership-scoped Library Item CRUD for Library Status and favorite.
- A minimal React authentication and library surface while search stays public.

Provider-owned Media and user-owned Library Items are separate. A Library Item stores only `provider`, `type`, `providerId`, `libraryStatus`, `favorite`, and timestamps; CRUD never calls a provider or hydrates metadata.

## Prerequisites

- Node.js 20.19 or newer and npm.
- Docker Desktop with Compose.
- The repository installed with `npm install`.

The native server needs a local PostgreSQL connection only for migrations and authenticated persistence. Provider credentials are optional and are not needed for the test suite.

## Architecture and relevant files

```text
React -> Express auth/session middleware -> PostgreSQL
React -> Express library API -> ownership-scoped repository -> PostgreSQL
React -> Express media search -> provider adapters -> external APIs
```

| Concern | Files |
| --- | --- |
| Connection and migrations | `server/db/client.js`, `server/db/migrate.js`, `server/db/migrations/001_initial_schema.sql` |
| Passwords and Sessions | `server/auth.js`, `server/auth-http.js` |
| Library persistence and routes | `server/library.js`, `server/library-http.js` |
| Application wiring | `server/app.js`, `server/index.js` |
| Browser experience | `client/src/hooks/useAuth.js`, `client/src/hooks/useLibrary.js`, `client/src/App.jsx` |
| Verification | `test/*integration.test.js`, `test/auth-http.integration.test.js`, `scripts/verify-client-secrets.js` |

## Database setup

### 1. Configure the local server

Copy the placeholder environment file and uncomment the server connection:

```text
DATABASE_URL=postgresql://goraku:goraku_dev@localhost:5432/goraku
APP_ORIGIN=http://localhost:5173
```

For a native setup, put those values in the root `.env.local`. The server loads that file, while shell variables take precedence. Never put `DATABASE_URL`, a PostgreSQL password, or provider credentials in `client/.env*`.

### 2. Start PostgreSQL

```bash
docker compose up -d postgres
docker compose ps
```

Wait until the `postgres` service reports `healthy`. The Compose service uses PostgreSQL 16 and the named `postgres-data` volume.

### 3. Apply application migrations

```bash
npm run db:migrate
```

The command creates `schema_migrations` and applies each numbered SQL file in a transaction. A successful run prints the applied version, for example:

```text
Applied migrations: 001_initial_schema
```

Running it again prints:

```text
Database schema is already up to date.
```

The application does not migrate automatically at startup.

### 4. Create the dedicated integration database

Integration tests must never use the normal `goraku` database. Create a separate database in the same local PostgreSQL service:

```bash
docker compose exec postgres createdb -U goraku goraku_test
```

If it already exists, the `createdb` command can report that fact; continue with the test command. Use this URL only for integration tests:

```text
postgresql://goraku:goraku_dev@localhost:5432/goraku_test
```

Each integration suite creates a unique temporary schema, runs the migrations in that schema, and drops the schema during teardown. The test command refuses URLs whose database name is not exactly `goraku_test`.

## Authentication flow

The public User is only `{ id, email }`. Registration and login normalize email by trimming and lowercasing it, then return the User while setting an opaque Session token only in the HTTP-only `goraku_session` cookie.

```bash
curl.exe -i -c cookies.txt -H "Origin: http://localhost:5173" -H "Content-Type: application/json" -d "{\"email\":\"reader@example.com\",\"password\":\"correct horse battery staple!\"}" http://localhost:3001/api/auth/register
curl.exe -i -b cookies.txt http://localhost:3001/api/auth/me
curl.exe -i -b cookies.txt -H "Origin: http://localhost:5173" -X POST http://localhost:3001/api/auth/logout
```

The local password policy is 12–128 characters with at least one ASCII non-letter/non-digit special character. Passwords are stored as versioned `crypto.scrypt` values with unique salts. Session rows store only a SHA-256 token hash, expire after seven days, support concurrent logins, and are revoked one at a time by logout. Expired Sessions are removed on the next authenticated request.

Mutation requests require the exact configured `APP_ORIGIN`. A missing or different Origin returns `403 ORIGIN_FORBIDDEN`. Read requests such as `GET /api/auth/me` do not require an Origin.

Safe failure behavior is intentional:

- Invalid credentials always return the same `401 INVALID_CREDENTIALS` envelope.
- Duplicate registration returns `409 CONFLICT` without account details.
- Malformed JSON and unknown fields return the existing `400 VALIDATION_ERROR` envelope.
- Authentication responses contain no password hash, token hash, database URL, stack trace, or Session token in JSON. The opaque Session token is delivered only through the HTTP-only cookie required by the design and is not placed in browser JavaScript.

## Library flow

After authentication, the browser can save a Media reference:

```bash
curl.exe -i -b cookies.txt -H "Origin: http://localhost:5173" -H "Content-Type: application/json" -d "{\"provider\":\"tmdb\",\"type\":\"movie\",\"providerId\":\"550\"}" http://localhost:3001/api/library
curl.exe -i -b cookies.txt "http://localhost:3001/api/library?page=1&perPage=20"
curl.exe -i -b cookies.txt -H "Origin: http://localhost:5173" -H "Content-Type: application/json" -X PATCH -d "{\"libraryStatus\":\"COMPLETED\",\"favorite\":true}" "http://localhost:3001/api/library/<local-item-uuid>"
curl.exe -i -b cookies.txt -H "Origin: http://localhost:5173" -X DELETE "http://localhost:3001/api/library/<local-item-uuid>"
```

Supported identity combinations are AniList/MyAnimeList with `anime`, TMDB with `movie` or `tv`, and TheGamesDB/RAWG with `game`. Inputs use lowercase type values; responses use the normalized uppercase Media type. New items default to `PLANNING` and `false`.

List results are owned by the Session User, ordered by `createdAt DESC, id DESC`, and use `perPage=20` by default with a maximum of 50. The response reports `{ page, perPage, hasMore }`. A duplicate identity returns `409`; an absent or another User’s local ID returns `404`, so ownership cannot be inferred. PATCH can change only `libraryStatus` and `favorite`; provider identity is immutable.

The client’s library view is intentionally reference-only. It displays the stored provider/type/ID and user-owned fields, and does not pretend that a title or image was fetched during a library mutation.

## Verification boundaries

### Credential-free check

```bash
npm run check
```

`npm run check` runs the unit/server tests, browser tests, production client build, and client secret scan. It does not require PostgreSQL, `DATABASE_URL`, `TEST_DATABASE_URL`, or live provider credentials. Provider tests use deterministic fixtures, and missing provider credentials produce safe unavailable responses. Expected final result for this repository is 96 server tests and 39 client tests passing, followed by a successful Vite build and secret scan.

The client scan loads `.env.local` if present and rejects server-only configuration identifiers or configured values in `client/dist`, including database settings, PostgreSQL credentials, TMDB/MAL/TheGamesDB/RAWG settings, and provider keys. It also rejects recognizable password-hash, Session-token, database-URL, and server-diagnostic field/format patterns. It does not treat the expected HTTP-only cookie name as a client credential.

### PostgreSQL integration verification

Set the dedicated URL in the shell, then run:

```bash
TEST_DATABASE_URL=postgresql://goraku:goraku_dev@localhost:5432/goraku_test npm run test:integration
```

PowerShell:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://goraku:goraku_dev@localhost:5432/goraku_test'
npm run test:integration
```

This command runs migration transaction/repeatability tests, PostgreSQL authentication model tests, real HTTP authentication tests, and real HTTP Library CRUD tests. It verifies schema creation, normalized registration, password/session derivation, cookie-backed `/me`, Origin validation, generic failures, concurrent Sessions, logout isolation, lazy expiry, ownership isolation, duplicate handling, defaults, CRUD, and deterministic pagination. It requires only the dedicated database and never calls a media provider.

Expected final result is 9 integration tests passing. A missing URL, an invalid PostgreSQL URL, or a database other than `goraku_test` fails before any test can run.

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| `ECONNREFUSED` on port 5432 | Run `docker compose up -d postgres` and wait for `docker compose ps` to show `healthy`. |
| `database "goraku_test" does not exist` | Run `docker compose exec postgres createdb -U goraku goraku_test`. |
| Integration test refuses the URL | Set `TEST_DATABASE_URL` and ensure its final path is exactly `/goraku_test`; keep the normal app URL on `/goraku`. |
| `relation ... does not exist` from the running server | Run `npm run db:migrate` against the normal application `DATABASE_URL`; migrations are explicit. |
| Browser mutation returns `ORIGIN_FORBIDDEN` | Make `APP_ORIGIN` exactly match the browser origin, including scheme and port, then restart the server. |
| Search is unavailable | This is expected without optional provider credentials; it does not affect the credential-free check or library CRUD. |
| Tests leave a schema behind after an interrupted run | Inspect the dedicated `goraku_test` database only and remove the uniquely named `*_test_<pid>_<timestamp>` schema after confirming it is a test schema. Never run cleanup against the normal `goraku` database. |

## Project boundary

Phase 5 is local-development/staging functionality, not a production deployment claim. It intentionally excludes Google OAuth/OIDC, automatic identity linking, email verification, password reset, account deletion, production authentication rate limiting, abuse monitoring, public deployment hardening, roles/admin authorization, ratings, notes, tags, collections, progress, metadata snapshots, provider hydration, and media refresh jobs. The decision to keep local credentials attached to a stable internal User is recorded in [ADR 0004](adr/0004-local-auth-and-future-external-identities.md).

## Completion record

Verified on 2026-09-10:

- `npm run check` — passed: 96 server tests, 39 client tests, production build, and client secret scan.
- `DATABASE_URL=.../goraku npm run db:migrate` — passed: database schema already up to date.
- `TEST_DATABASE_URL=.../goraku_test npm run test:integration` — passed: 9 integration tests across migrations, model auth, HTTP auth, and HTTP library CRUD.
- `docker compose ps` — PostgreSQL reported `healthy` during integration verification.

The application is complete for the Phase 5 local/staging boundary described above. Future deployment and production hardening require a separate phase and separate verification.
