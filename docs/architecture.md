# Goraku Base architecture and phased plan

Status: Phases 1-8 are complete for their documented local/staging boundaries, and the initial no-budget Render + Neon deployment boundary is documented in [the deployment guide](deployment-render-neon.md). The executable scope, acceptance criteria, and learning records are in the [Phase 1 specification](../.scratch/phase-1-foundation/spec.md), [Phase 2 anime search specification](../.scratch/phase-2-anilist-search/spec.md), [Phase 2 anime search walkthrough](phase-2-walkthrough.md), [Phase 3 TMDB search specification](../.scratch/phase-3-tmdb-search/spec.md), [Phase 4 specification](../.scratch/phase-4-rawg-combined-search/spec.md), [Phase 5 walkthrough](phase-5-walkthrough.md), [Phase 6 personal tracking walkthrough](phase-6-walkthrough.md), the [Phase 7 specification](../.scratch/phase-7-discovery-runtime/spec.md), and the [Phase 7 walkthrough](phase-7-walkthrough.md).

## Purpose and scope

Goraku Base is a personal entertainment bookmarking and tracking application, and a portfolio project demonstrating REST API development. Start with anime through MyAnimeList with AniList as an availability fallback, movies and TV through TMDB, and games through TheGamesDB with RAWG fallback. Manga, manhwa, comics, and additional providers are future extensions.

Keep React, JavaScript, CSS, Node.js with Express, and PostgreSQL. Develop locally first, with Docker support. Keep deployment instructions separate from the learning walkthrough. The initial public deployment uses one free Render Web Service and a separate free Neon PostgreSQL project; it is a hobby/public-beta boundary, not a production-grade uptime or backup commitment. Phase 5 uses local email/password authentication with server-managed Sessions; a future external provider must attach explicitly to the stable internal User identity.

## Deployment boundary

The initial live deployment keeps the React client and Express API on one same-origin Render Web Service. The service runs `npm ci && npm run build` during deployment, serves the resulting `client/dist` files, and starts with `npm start`; the existing relative `/api` client contract therefore remains unchanged. Neon owns the fresh production PostgreSQL database, including User-owned Library Items and private profile pictures. Brevo is called through its HTTPS API for verified-email and password-recovery messages.

The free boundary intentionally accepts Render cold starts, shared monthly runtime limits, and ephemeral service files. No User-owned data or uploaded profile picture may depend on the Render filesystem. The complete setup, secrets, migration, smoke-test, and manual backup procedure is in [the Render + Neon deployment guide](deployment-render-neon.md).

## Request flow

React -> Express REST API -> media aggregator -> provider adapters -> external APIs.

React sends all media data requests to Express, including requests to providers that do not require secrets. Provider adapters hide external REST or GraphQL protocols and return normalized Media objects. Cover images may be loaded from provider-approved image URLs; these are image assets, not direct metadata API calls.

Express owns validation, HTTP responses, pagination contracts, authentication and authorization for user resources, cache behavior, and request rate limits. The aggregator coordinates providers and partial failures. Adapters own external requests and normalization. Keep these responsibilities in straightforward modules rather than a generic plugin framework.

External providers own media metadata. PostgreSQL owns user library data and private profile pictures. Cache only metadata that is useful for retrieval and display, subject to provider requirements; do not mirror catalogs. Profile pictures are authenticated, validated image resources rather than public URLs. Keep credentials in server environment variables and exclude .env files from Git while providing placeholder-only .env.example files.

Phase 7 implements a capability-driven public Media boundary. Details, Discovery, and Provider-owned Recommendations remain Provider-owned and use the normalized Media contract. A bounded process-local Media Metadata Cache reduces repeated public retrieval, but it never contains User-owned Library data, Sessions, or tracking state. Anime Discovery maps MyAnimeList's airing ranking to Currently airing and its current-season endpoint to Seasonal releases; AniList is the availability fallback for server-selected Anime search and Discovery requests.

## Proposed REST contract

| Method and route | Purpose |
| --- | --- |
| GET /api/media/search?q=naruto&type=anime&page=1 | Search selected providers |
| GET /api/media/trending?type=anime&page=1 | Request supported trending discovery |
| GET /api/media/popular?type=game&page=1 | Request supported popular discovery |
| GET /api/media/:provider/:type/:id | Fetch a specific external media entry |
| GET /api/media/:provider/:type/:id/recommendations | Fetch Provider-owned Recommendations |
| GET /api/library?page=1 | List the authenticated user's library |
| POST /api/library | Add a media reference to that user's library |
| PATCH /api/library/:id | Update allowed user-owned fields |
| DELETE /api/library/:id | Remove that user's library item |
| GET /api/auth/avatar | Serve the authenticated User's private profile picture |
| PUT /api/auth/avatar | Replace the authenticated User's profile picture |
| DELETE /api/auth/avatar | Restore the Goraku logo as the User's profile picture |
| GET /api/tags | List that user's Tags |
| POST /api/tags | Create a Tag |
| PATCH /api/tags/:id | Rename a Tag |
| DELETE /api/tags/:id | Delete a Tag and its memberships |
| GET /api/collections | List that user's Collections |
| POST /api/collections | Create a Collection |
| PATCH /api/collections/:id | Rename a Collection |
| DELETE /api/collections/:id | Delete a Collection and its memberships |
| PUT /api/library/:id/tags/:tagId | Attach a Tag to a Library Item |
| DELETE /api/library/:id/tags/:tagId | Detach a Tag from a Library Item |
| PUT /api/library/:id/collections/:collectionId | Attach a Collection to a Library Item |
| DELETE /api/library/:id/collections/:collectionId | Detach a Collection from a Library Item |

The detail route adds type to the original example to distinguish movie and TV identifiers within TMDB. A library route ID identifies the local library record, not the provider media ID. Public query and route values use lowercase; normalized Media.type and JSON enum values such as Library Status use uppercase. The `libraryStatus` Library filter follows the lowercase public-query rule (for example, `in_progress`); the server also accepts the uppercase enum form for compatibility and normalizes it before querying. Reserve future types in the model, but enable search filters only when a provider supports them.

Use 200 for successful reads and updates, 201 plus a Location header for creation, and 204 with no body for deletion. Use 400 for invalid requests, 401 for absent or invalid authentication, 404 for absent resources (including another user's library records), 409 for duplicate entries, 429 for application rate limits, and 501 when a known Provider Capability is unsupported. Use 403 where an authenticated caller lacks permission and resource existence is not private. Return 503 when a Provider is unavailable or all requested providers are unavailable. Do not invent results to hide failures.

Use one error shape: { "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [] } }. Return safe messages without credentials, upstream payload dumps, or stack traces. Validate query lengths, allowed providers/types, IDs, pagination limits, and mutation fields. Resolve ownership from the authenticated identity, never from a client-supplied userId. Scope every library query and mutation to that identity.

For search, return results, pagination, and providerErrors. On partial provider failure, return 200 with successful results and explicit provider errors; distinguish this from an empty successful search. Typed requests remain provider-owned. Combined Search requests the current page from each active lane with a bounded per-provider size, reports per-provider hasMore information and an aggregate hasMore, and uses an opaque continuation cursor to preserve lane state and fallback selection. Do not claim a unified total or global relevance ranking. This simple pagination contract can evolve later if usage requires it.

Provider capabilities are explicit: support search, details, popular, trending, and Provider-owned Recommendations only where implemented and normalized. Do not silently relabel popular results as trending, return empty results for unsupported capabilities, or switch Providers for new operations. Timeouts and bounded retries belong in provider request handling; Provider rate limits and the application's client request limits are separate concerns. Phase 7 uses a bounded policy-aware process-local cache with operation-specific TTLs and in-flight request sharing. Cache keys include Provider, type, operation, query or ID, pagination, adult-content preference, and all other request-affecting options. Shared metadata caches must not contain private Library data.

## Media and library model

Media describes external metadata; Library Item describes a user's tracking state. Separate releaseStatus from libraryStatus, and providerRating from userRating. A Media identity includes provider, type, and providerId; keep providerId as a string. Prevent duplicates per user using that same reference. Cross-provider matching is future work.

Phase 6 extends each Library Item with User-owned Personal Rating, Note, and typed Progress values, plus reusable private Tag and Collection memberships. These values remain independent from Provider-owned Media Metadata; Library reads do not hydrate titles, images, ratings, or progress limits from external Providers. The implementation and verification are complete for local development and controlled staging; production authentication hardening and provider hydration remain outside this initial deployment boundary. The free deployment is documented as a public-beta setup with explicit operational limitations.

Phase 7 extends public Discovery with capability-driven Media details, supported trending and popular lists, and Provider-owned Recommendations. It adds bounded public metadata caching, in-flight request sharing, per-IP Application Rate Limits, and lightweight sensitive-data-safe runtime signals. Phase 8 completes the client presentation refinement, including catalog buttons, automatic rail pagination, compact authentication actions, and icon-only theme control.

The shared Media contract defines the normalized model in JavaScript with JSDoc: identity, type, titles, description, image, bannerImage, releaseDate, genres, providerRating, releaseStatus, creators, adult-content classification, and typed-by-media metadata. Missing data remains unknown rather than fabricated; preserve date precision and rating scale. Provider ratings have a common 0-10 display score while retaining their original value and scale; absent scores display as Unrated. Media-specific metadata must be normalized rather than an unstructured copy of external JSON.

Library progress varies by type: episode counts for Anime, season/episode position for TV, hours for games, and watched state for movies. Personal tracking includes Library Status, favorite, Personal Rating, Note, Tags, Collections, and typed Progress. MANGA and COMIC remain reserved types without Phase 6 Progress rules.

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
2. Anime search through Express, normalization, and MediaCards. MyAnimeList is the configured primary and AniList is the availability fallback. The scoped contract, provider error behavior, debounce/cancellation, loading/empty states, pagination, and mocked adapter verification are defined in the [Phase 2 specification](../.scratch/phase-2-anilist-search/spec.md). Manga remains a future type that can be added through a later capability slice without changing the core Media identity.
3. TMDB movies and TV through the same REST interface and card component, with strict type/provider routing and a generic client search seam. The scope and settled decisions are recorded in the [Phase 3 specification](../.scratch/phase-3-tmdb-search/spec.md).
4. RAWG game search and Combined Search with independent Provider Failures. The scope and settled decisions are recorded in the [Phase 4 specification](../.scratch/phase-4-rawg-combined-search/spec.md).
5. PostgreSQL and library create/read/update/delete, status, and favorite. Implement and test authentication and ownership authorization before presenting the library as supporting multiple users. Choose the local authentication experience before this phase.
6. Personal tracking enrichment: Collections, Personal Ratings, Notes, Tags, and media-specific Progress. The implementation, verification, and operational boundary are recorded in the [Phase 6 personal tracking walkthrough](phase-6-walkthrough.md), with scope and settled decisions in the [Phase 6 specification](../.scratch/phase-6-tracking-enrichment/spec.md).
7. Discovery enrichment and runtime reliability, complete for local development and controlled staging: capability-driven Media details, supported trending and popular Discovery, Provider-owned Recommendations, bounded public metadata caching, in-flight request sharing, per-IP Application Rate Limits, lightweight runtime signals, and functional client states. The scope and operational boundary are recorded in the [Phase 7 specification](../.scratch/phase-7-discovery-runtime/spec.md) and [Phase 7 walkthrough](phase-7-walkthrough.md). UI refinement is explicitly deferred to Phase 8.
8. UI refinement: visual hierarchy, layout, typography, component composition, interaction flow, responsive presentation, and motion for the verified Phase 6 and Phase 7 surfaces. The follow-up also adds the User username field through a forward-only migration and updates registration; it does not reopen Library ownership or Provider contracts. The Phase 8 boundary is recorded in the [Phase 8 specification](../.scratch/phase-8-ui-refinement/spec.md).

For every phase, explain the outcome, architecture, relevant folders, code, verification steps, and expected results in a separate learning document. Add request/response examples and meaningful HTTP-level tests as endpoints arrive. Keep the README honest about implemented versus planned features, and maintain the separate [hosting guide](deployment-render-neon.md) as the deployment boundary evolves.
