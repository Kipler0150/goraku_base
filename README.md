# Goraku Base

An entertainment bookmarking and tracking application for anime, movies, television, and video games. Phase 1 is now a runnable React + Express foundation.

## Project status

Phase 1: complete runnable foundation. Phase 2: complete anime search through Express with unofficial AniList integration and an optional unofficial MyAnimeList availability fallback, plus normalized MediaCards, pagination, loading/error states, and a temporary local adult-content filter. Phase 3: complete movie and TV title search through the server-side TMDB adapter with the same generic search surface, server-only configuration, attribution, and credential-free repository verification. Manga, RAWG, authentication, persistence, personal ratings, and library features remain planned.

## Portfolio focus

Goraku Base will expose an Express REST API consumed by a React frontend. The backend will aggregate and normalize AniList, TMDB, and RAWG metadata while PostgreSQL stores user-owned library information. The API will demonstrate HTTP semantics, validation, consistent errors, pagination, authentication, ownership authorization, caching, and rate-limit handling.

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

The AniList search path needs no credential. To enable the optional MyAnimeList fallback, add the server-only `MAL_CLIENT_ID` to the root `.env.local` file (copy `.env.example` as a starting point) or set it in the shell before starting the server. Movie and TV search likewise accepts the optional server-only `TMDB_ACCESS_TOKEN`; `TMDB_IMAGE_BASE_URL` can override the approved image host and defaults to `https://image.tmdb.org/t/p`. The server loads `.env.local` at startup, and shell values take precedence. No MyAnimeList OAuth account, client secret, or user library access is required for this read-only search slice. The browser never receives any provider credential or image configuration value.

Normal startup and the test suite are credential-free: without `TMDB_ACCESS_TOKEN`, movie and TV searches return a safe unavailable-provider response, while mocked tests never call TMDB. Copy the placeholder values from `.env.example` or `server/.env.example`; never commit a populated environment file.

Useful commands:

```bash
npm test          # HTTP, Media contract, and targeted client behavior
npm run build     # production client build in client/dist
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

Future deployment documentation remains intentionally separate and is not claimed as verified in Phase 1.
