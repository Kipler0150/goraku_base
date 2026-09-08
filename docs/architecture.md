# Goraku Base architecture and phased plan

Status: Phase 1 foundation and Phase 2 anime search complete; later phases remain planned. The executable scope and acceptance criteria are recorded in the [Phase 1 specification](../.scratch/phase-1-foundation/spec.md), [Phase 2 anime search specification](../.scratch/phase-2-anilist-search/spec.md), and [Phase 2 anime search walkthrough](phase-2-walkthrough.md).

## Purpose and scope

Goraku Base is a personal entertainment bookmarking and tracking application, and a portfolio project demonstrating REST API development. Start with anime through AniList, movies and TV through TMDB, and games through RAWG. Manga, manhwa, comics, and additional providers are future extensions.

Keep React, JavaScript, CSS, Node.js with Express, and PostgreSQL. Develop locally first, with Docker support. Keep deployment instructions separate from the learning walkthrough. Authentication must permit a later integration such as Supabase Auth; no authentication vendor is selected yet.

## Request flow

React -> Express REST API -> media aggregator -> provider adapters -> external APIs.

React sends all media data requests to Express, including requests to providers that do not require secrets. Provider adapters hide external REST or GraphQL protocols and return normalized Media objects. Cover images may be loaded from provider-approved image URLs; these are image assets, not direct metadata API calls.

Express owns validation, HTTP responses, pagination contracts, authentication and authorization for user resources, cache behavior, and request rate limits. The aggregator coordinates providers and partial failures. Adapters own external requests and normalization. Keep these responsibilities in straightforward modules rather than a generic plugin framework.

External providers own media metadata. PostgreSQL owns user library data. Cache only metadata that is useful for retrieval and display, subject to provider requirements; do not mirror catalogs. Keep credentials in server environment variables and exclude .env files from Git while providing placeholder-only .env.example files.

## Proposed REST contract

| Method and route | Purpose |
| --- | --- |
| GET /api/media/search?q=naruto&type=anime&page=1 | Search selected providers |
| GET /api/media/trending?type=anime&page=1 | Request supported trending discovery |
| GET /api/media/popular?type=game&page=1 | Request supported popular discovery |
| GET /api/media/:provider/:type/:id | Fetch a specific external media entry |
| GET /api/library?page=1 | List the authenticated user's library |
| POST /api/library | Add a media reference to that user's library |
| PATCH /api/library/:id | Update allowed user-owned fields |
| DELETE /api/library/:id | Remove that user's library item |

The detail route adds type to the original example to distinguish movie and TV identifiers within TMDB. A library route ID identifies the local library record, not the provider media ID. Public query and route values use lowercase; normalized Media.type uses ANIME, MANGA, MOVIE, TV, GAME, or COMIC. Reserve future types in the model, but enable search filters only when a provider supports them.

Use 200 for successful reads and updates, 201 plus a Location header for creation, and 204 with no body for deletion. Use 400 for invalid requests, 401 for absent or invalid authentication, 404 for absent resources (including another user's library records), 409 for duplicate entries, and 429 for application rate limits. Use 403 where an authenticated caller lacks permission and resource existence is not private. Return 503 when all requested providers are unavailable. Do not invent results to hide failures.

Use one error shape: { "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [] } }. Return safe messages without credentials, upstream payload dumps, or stack traces. Validate query lengths, allowed providers/types, IDs, pagination limits, and mutation fields. Resolve ownership from the authenticated identity, never from a client-supplied userId. Scope every library query and mutation to that identity.

For search, return results, pagination, and providerErrors. On partial provider failure, return 200 with successful results and explicit provider errors; distinguish this from an empty successful search. Initially, a page requests that page from each selected provider with a bounded per-provider size. Report per-provider hasMore information and an aggregate hasMore; do not claim a unified total or global relevance ranking. This simple pagination contract can evolve later if usage requires it.

Provider capabilities are explicit: support search and details where implemented, and popular/trending only when available. Do not silently relabel popular results as trending. Timeouts and bounded retries belong in provider request handling; provider rate limits and the application's client request limits are separate concerns. Cache keys include provider, type, query, and pagination. Shared metadata caches must not contain private library data.

## Media and library model

Media describes external metadata; Library Item describes a user's tracking state. Separate releaseStatus from libraryStatus, and providerRating from userRating. A Media identity includes provider, type, and providerId; keep providerId as a string. Prevent duplicates per user using that same reference. Cross-provider matching is future work.

Phase 1 will define the normalized model in JavaScript with JSDoc: identity, type, titles, description, image, bannerImage, releaseDate, genres, providerRating, releaseStatus, creators, and typed-by-media metadata. Missing data remains unknown rather than fabricated; preserve date precision and rating scale. Provider ratings have a common 0-10 display score while retaining their original value and scale; absent scores display as Unrated. Media-specific metadata must be normalized rather than an unstructured copy of external JSON.

Library progress varies by type: episode counts for anime, season/episode position for TV, hours for games, watched state for movies, and chapter counts for future reading media. Personal data includes status, favorite, rating, notes, tags, collections, and tracking dates. Implement these in their original phases.

## Planned structure

```text
client/src/
  components/
  pages/
  services/api.js
server/
  routes/
  controllers/
  middleware/
  providers/anilist.js
  providers/tmdb.js
  providers/rawg.js
  services/mediaAggregator.js
  db/
  utils/
shared/
docs/
```

Create implementation files when their phase needs them. Use Impeccable for UI design, with consistent media cards across providers, responsive layouts, accessible controls, and loading, empty, and error states.

## Phases and learning deliverables

1. Architecture, project scaffold, normalized Media model, REST contract, README, and a separate learning walkthrough. Deliver a minimal React welcome page calling Express GET /api/health, with loading, success, and failure feedback. Provide native npm startup and Docker Compose for React and Express. Include model examples and tests; MediaCards and live search begin in Phase 2. PostgreSQL begins in Phase 5. Document how to run and verify the foundation.
2. AniList anime search through Express, normalization, and MediaCards. The scoped contract, provider error behavior, debounce/cancellation, loading/empty states, pagination, and mocked adapter verification are defined in the [Phase 2 specification](../.scratch/phase-2-anilist-search/spec.md). Manga remains a future type that can be added through a later capability slice without changing the core Media identity.
3. TMDB movies and TV through the same REST interface and card component.
4. RAWG and combined search with independent provider failures.
5. PostgreSQL and library create/read/update/delete, status, and favorite. Implement and test authentication and ownership authorization before presenting the library as supporting multiple users. Choose the local authentication experience before this phase.
6. Collections, ratings, notes, tags, and media-specific progress.
7. Discovery, recommendations, caching improvements, performance, and UI refinement. Introduce necessary timeouts, cache bounds, and rate-limit handling during integrations rather than postponing correctness to this phase.

For every phase, explain the outcome, architecture, relevant folders, code, verification steps, and expected results in a separate learning document. Add request/response examples and meaningful HTTP-level tests as endpoints arrive. Keep the README honest about implemented versus planned features, and maintain a separate future-hosting guide when deployment is addressed.
