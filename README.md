# Goraku Base

An entertainment bookmarking and tracking application for anime, movies, television, and video games. Phase 1 is now a runnable React + Express foundation.

## Project status

Phase 1: complete runnable foundation. Phase 2: complete anime search through Express with unofficial AniList integration and an optional unofficial MyAnimeList availability fallback, plus normalized MediaCards, pagination, loading/error states, and a temporary local adult-content filter. Phase 3: complete movie and TV title search through the server-side TMDB adapter with the same generic search surface, server-only configuration, attribution, and credential-free repository verification. Phase 4: complete TheGamesDB-primary game search with RAWG availability fallback and Combined Search with independent Provider Failures, cursor pagination, server-only configuration, attribution, and deterministic verification. Phase 5: complete local/staging PostgreSQL persistence, local email/password authentication, seven-day server-managed Sessions, secure cookies, mutation Origin validation, authenticated User context, and ownership-scoped Library Item CRUD for Library Status and favorite. Google authentication, account recovery, production rate limiting, and public deployment remain future work.

## Portfolio focus

Goraku Base will expose an Express REST API consumed by a React frontend. The backend will aggregate and normalize AniList, TMDB, TheGamesDB, and RAWG metadata while PostgreSQL stores user-owned library information. The API will demonstrate HTTP semantics, validation, consistent errors, pagination, authentication, ownership authorization, caching, and rate-limit handling.

## Stack

- React, JavaScript, and CSS
- Node.js and Express
- PostgreSQL
- Local development with Docker support

Node.js 20.19+ (or 22+) and npm are required. Docker Desktop is optional for the container path.

## Run locally

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. The client proxies its relative `/api` request to Express on port 3001. Stop both development processes with Ctrl+C.

The AniList search path needs no credential. To enable the optional MyAnimeList fallback, add the server-only `MAL_CLIENT_ID` to the root `.env.local` file (copy `.env.example` as a starting point) or set it in the shell before starting the server. Movie and TV search likewise accepts the optional server-only `TMDB_ACCESS_TOKEN`; `TMDB_IMAGE_BASE_URL` can override the approved image host and defaults to `https://image.tmdb.org/t/p`. Game search and the Games lane in Combined Search use the optional server-only `THEGAMESDB_API_KEY` first, then `RAWG_API_KEY` when TheGamesDB is unavailable. The server loads `.env.local` at startup, and shell values take precedence. No MyAnimeList OAuth account, client secret, or user library access is required for this read-only search slice. The browser never receives any provider credential or image configuration value.

Normal startup and the test suite are credential-free: without `TMDB_ACCESS_TOKEN`, movie and TV searches return a safe unavailable-provider response, and without both game keys, game and Combined Search requests return safe game-provider-unavailable results while other successful lanes remain visible. Mocked tests never call external providers. Copy the placeholder values from `.env.example` or `server/.env.example`; never commit a populated environment file or put a provider key in `client/.env*`.

Useful commands:

```bash
npm test          # HTTP, Media contract, and targeted client behavior
npm run build     # production client build in client/dist
npm run check     # credential-free tests, build, and client secret boundary
npm run db:migrate  # apply pending PostgreSQL migrations to DATABASE_URL
npm run test:integration  # PostgreSQL tests; requires TEST_DATABASE_URL=/goraku_test
npm run examples:inspect  # print synthetic Media examples as JSON
npm start         # Express only, useful for direct API checks
curl http://localhost:3001/api/health
```

Docker runs the same two local development processes:

```bash
docker compose config -q
docker compose up --build
docker compose down
```

Open <http://localhost:5173>; the container client still calls `/api/health` relatively and Vite proxies inside the Compose network.

Compose also starts a persistent PostgreSQL 16 service as `postgres`. Its default local connection is available to the server as `DATABASE_URL`; run `docker compose exec server npm run db:migrate` after the database reports healthy. Native migration runs use the server-only `DATABASE_URL` in `.env.local` (the placeholder is documented in `.env.example` and `server/.env.example`).

PostgreSQL integration tests require the separate `goraku_test` database. Create it with `docker compose exec postgres createdb -U goraku goraku_test`, set `TEST_DATABASE_URL` to its URL, and run `npm run test:integration`. Each suite migrates a unique temporary schema inside that database and drops the schema during teardown; the test refuses other database names and never touches the normal `goraku` database. See the [Phase 5 walkthrough](docs/phase-5-walkthrough.md) for native, Docker, PowerShell, and troubleshooting commands.

Local authentication and the first library slice are available when the server has a migrated `DATABASE_URL`. Use `POST /api/auth/register` or `POST /api/auth/login` with `{ "email": "...", "password": "..." }`; the server sets an HTTP-only `goraku_session` cookie. `GET /api/auth/me` reads the current User from that Session, and `POST /api/auth/logout` revokes only the current Session. Authenticated clients can use `GET|POST /api/library`, `PATCH /api/library/:id`, and `DELETE /api/library/:id` for reference-only Library Items with Library Status and favorite. Mutation requests must send the exact configured `APP_ORIGIN` (default `http://localhost:5173`).

For a background verification run, use `docker compose up --build -d`, confirm both services with `docker compose ps`, check `curl.exe http://localhost:3001/api/health` and `curl.exe http://localhost:5173/api/health`, then stop everything with `docker compose down`. Compose is a local development path, not a production deployment recipe.

## Shared Media contract

`shared/media.js` defines the provider-owned Media shape used by future adapters: provider, string provider ID, media type, normalized titles and metadata, partial release dates, source provider ratings plus their 0–10 display equivalent, release status, and normalized creators. Release status is one of `ANNOUNCED`, `ONGOING`, `RELEASED`, `CANCELLED`, or `UNKNOWN`, and is separate from a user's Library Status.

Creator entries use `{ name, role }`; provider adapters are responsible for mapping provider-specific credits to concise, provider-independent role labels without copying raw credit payloads. Type-specific metadata is deliberately small: anime uses episode count and episode duration, movies use runtime, TV uses season and episode counts, and games use platforms, developers, and publishers. Unknown scalar values are `null`; empty lists mean no entries were supplied by the provider and do not prove an exhaustive result. MANGA and COMIC remain reserved Media types, not active integrations.

The contract deliberately excludes user-owned Library Item fields such as personal rating, favorite, notes, progress, and library status. The four initial integration examples are synthetic and can be inspected with `npm run examples:inspect`.

## Planned features

Media details, a personal library, favorites, ratings, notes, tags, collections, and progress appropriate to each media type. Additional media types and providers can be added later.

## Documentation

- [Architecture, REST contract, and phased plan](docs/architecture.md)
- [Domain glossary](CONTEXT.md)
- [Phase 1 learning walkthrough](docs/phase-1-walkthrough.md)
- [Phase 2 AniList search specification](.scratch/phase-2-anilist-search/spec.md)
- [Phase 2 anime search walkthrough](docs/phase-2-walkthrough.md)
- [Phase 3 TMDB movie and TV search specification](.scratch/phase-3-tmdb-search/spec.md)
- [Phase 3 TMDB search walkthrough](docs/phase-3-walkthrough.md)
- [Phase 4 TheGamesDB, RAWG fallback, and Combined Search specification](.scratch/phase-4-rawg-combined-search/spec.md)
- [Phase 4 game providers and Combined Search walkthrough](docs/phase-4-walkthrough.md)
- [Phase 5 PostgreSQL, authentication, and library walkthrough](docs/phase-5-walkthrough.md)
- [ADR 0004: local authentication and future external identities](docs/adr/0004-local-auth-and-future-external-identities.md)

Future deployment documentation remains intentionally separate and is not claimed as verified by Phase 5. The implemented authentication and library slice is suitable for local development and controlled staging only.
