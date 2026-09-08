# Phase 3 walkthrough: TMDB movie and TV search

Phase 3 extends the existing media search boundary to support TMDB movie and TV title search. The browser still makes one relative request to Express, and the server still returns one provider-owned normalized Media page. This phase does not add a second public route or a provider-specific client implementation.

## The request flow

The search surface is a single selector-backed section in `client/src/App.jsx`. Anime is selected initially; Movies and TV change the `type` used by the shared `useMediaSearch` hook.

1. The user enters a title or presses Enter. The hook debounces ordinary typing, while Enter submits immediately. Empty input returns to the instructional state without a request.
2. `client/src/api/mediaSearch.js` builds a relative URL such as:

   ```text
   /api/media/search?type=movie&q=arrival&page=1&perPage=12&includeAdult=true&provider=tmdb
   ```

   The browser sends no TMDB token or image-host configuration.
3. `server/app.js` validates the query. It accepts exactly `anime`, `movie`, or `tv`, rejects repeated or unknown parameters, and enforces provider compatibility before an adapter can be called.
4. `server/media-search.js` selects the provider. Anime keeps its AniList-primary/MyAnimeList availability fallback. Movie and TV requests select TMDB only and never merge or fall back to another provider.
5. `server/providers/tmdb.js` builds the provider request. It chooses `/search/movie` or `/search/tv`, sends the server-only Bearer token, fixes the language to `en-US`, forwards the adult-content preference, and applies a bounded timeout.
6. The adapter converts the provider payload into the shared Media contract. Express returns the normalized page with `source: "tmdb"` and an empty `providerErrors` list.
7. The hook ignores an older response after a newer query or type selection wins. Later pages append to the current results; a failed later page retains earlier results and exposes a page-specific retry action.

## Normalized mappings

TMDB search payloads stop at the adapter boundary. The client does not know whether a field came from `title` or `name`.

| Shared Media field | Movie search result | TV search result |
| --- | --- | --- |
| `provider` | `tmdb` | `tmdb` |
| `providerId` | Stringified TMDB `id` | Stringified TMDB `id` |
| `type` | `MOVIE` | `TV` |
| `title` | `title` | `name` |
| `originalTitle` | `original_title` | `original_name` |
| `description` | `overview` | `overview` |
| `image` | Poster path using `w500` | Poster path using `w500` |
| `bannerImage` | Backdrop path using `w1280` | Backdrop path using `w1280` |
| `releaseDate` | `release_date` | `first_air_date` |
| `providerRating` | `vote_average` on a 0–10 scale | `vote_average` on a 0–10 scale |
| `releaseStatus` | `UNKNOWN` | `UNKNOWN` |
| `isAdult` | `adult` | `adult` |
| `metadata` | `{ runtimeMinutes: null }` | `{ seasonCount: null, episodeCount: null }` |

Dates retain partial precision. Missing image paths become `null`; unknown genre IDs are omitted; search results do not fabricate creators or details-only metadata. A zero rating is preserved as a valid rating.

## Pagination and failures

The public request accepts the shared `perPage` value, but TMDB owns the actual page size. The adapter does not slice a provider response or claim the requested page size. It reports TMDB's fixed page size (`20`) and derives `hasMore` from TMDB's `page` and `total_pages` values.

The client pins later-page requests to the source returned by page one. For movie and TV this is always TMDB. A TMDB failure returns HTTP `503` with a safe `PROVIDER_*` code and no upstream diagnostic. The adapter maps timeouts, rate limits, unauthorized or unavailable responses, malformed payloads, and generic request failures independently. A missing `TMDB_ACCESS_TOKEN` marks the provider disabled and returns `PROVIDER_UNAVAILABLE` without making an HTTP request.

## Configuration and attribution

TMDB configuration is server-only:

- `TMDB_ACCESS_TOKEN` enables movie and TV search.
- `TMDB_IMAGE_BASE_URL` optionally changes the configured image base; the default is `https://image.tmdb.org/t/p`.

Both values are documented as blank or approved placeholders in `.env.example` and `server/.env.example`. They are loaded by the server environment module, never returned by the API, and are not included in the client bundle. Normal startup and tests therefore work without a TMDB credential; a live movie or TV request without one receives a safe unavailable response.

The client identifies the active provider near the results. The Credits area links to TMDB, displays the approved primary-green logo, and includes the required notice:

> This product uses the TMDB API but is not endorsed or certified by TMDB.

The notice is attribution, not an endorsement claim.

## Verification boundary

The server tests use two deterministic seams: a mocked HTTP request function for the TMDB adapter and injected adapters for the Express route. They cover movie and TV success, empty and sparse results, normalization, adult filtering, image paths, provider-owned pagination, credential absence, malformed payloads, timeout, rate limit, unavailable, and generic failures.

The client tests use mocked relative API responses. They cover the accessible type selector, initial Anime state, automatic type-change searches, stale query and stale type responses, movie and TV card placeholders, TMDB attribution, pagination, later-page retry, loading and empty states, and keyboard-reachable controls.

Run the complete credential-free verification from the repository root:

```bash
npm run check
```

That command runs the server and client tests, then creates the production Vite build. The test boundary must remain mocked: no test should require `TMDB_ACCESS_TOKEN` or call the live TMDB service.

## Out of scope

Phase 3 intentionally leaves details routes, trending or popular discovery, combined cross-type search, multi-provider merging, TMDB user sessions, accounts, PostgreSQL, library items, recommendations, caching, production rate limiting, deployment, locale or region controls, and separate Anime, Movies, and TV sections for later work.

The selector-backed surface and provider-neutral hook are the seam for that future work. They keep the current phase small while allowing separate category sections to reuse the same typed request state and MediaCard behavior later.
