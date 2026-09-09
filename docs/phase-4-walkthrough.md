# Phase 4 walkthrough: RAWG game search and Combined Search

Phase 4 extends the provider-neutral media search surface with game discovery through RAWG and a truthful Combined Search across Anime, movies, TV, and games. The browser still sends one relative request to Express. The server owns provider selection, credentials, normalization, pagination, fallback policy, and safe failure responses.

## What was built

- A server-side RAWG adapter for typed game search.
- Strict `game` and `all` request validation on the existing `GET /api/media/search` route.
- Independent Combined Search lanes for Anime, movies, TV, and games.
- An opaque continuation cursor that preserves each lane's page and Anime fallback provider.
- Safe partial Provider Failures with lane-specific retry behavior.
- Games and All choices in the accessible search form, grouped Combined Search sections, game metadata placeholders, and provider attribution links.
- Deterministic adapter, HTTP, coordinator, browser, configuration, and production-build verification without provider credentials or live calls.

## Run the slice

From the repository root:

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. Express listens on port 3001 and Vite proxies the browser's relative `/api` requests to it.

RAWG game search uses the optional server-only `RAWG_API_KEY`. Put a real value only in the root `.env.local` file or the server process environment; `.env.example` and `server/.env.example` contain blank placeholders. The browser never receives the key, and `client/.env*` must not contain provider credentials. Without the key, typed game search returns a safe RAWG unavailable response and Combined Search can still show successful lanes.

The normal test suite is credential-free. It injects mocked HTTP request functions into provider adapters and mocked adapters into the Express boundary, so it does not call RAWG, TMDB, AniList, or MyAnimeList.

## Request flow

```text
React search form
  -> client/src/api/mediaSearch.js
  -> GET /api/media/search
  -> server/app.js validates type, query, pagination, and provider options
  -> server/media-search.js selects a typed provider or runs Combined lanes
  -> server/providers/rawg.js (game lane)
       or anilist.js / myanimelist.js / tmdb.js
  -> shared/media.js creates normalized Media values
  -> JSON response with source, pagination, and providerErrors
  -> React hook updates typed or grouped result state
```

Typed requests remain provider-owned:

```http
GET /api/media/search?type=game&q=zelda&page=1&perPage=12&includeAdult=false&provider=rawg
```

`type=game` selects RAWG strictly. The public `provider` value is optional, but if supplied it must be `rawg`; incompatible providers are rejected before an adapter is called. Short queries return a normal empty page without contacting a provider.

## RAWG request and normalization

The adapter calls `https://api.rawg.io/api/games` with the server-side `key`, trimmed `search`, `page`, and `page_size` query parameters. RAWG owns its provider page size, which is reported in the normalized pagination value. Requests have a bounded timeout, and HTTP, malformed-payload, timeout, and transport failures become stable provider errors.

RAWG payloads stop at the adapter boundary. The client receives the shared `Media` shape:

| Shared Media field | RAWG game search mapping |
| --- | --- |
| `provider` | `rawg` |
| `providerId` | Stringified numeric RAWG `id` |
| `type` | `GAME` |
| `title` | `name` |
| `originalTitle` | `null` |
| `description` | Sanitized `description_raw` or `description`, otherwise `null` |
| `image` | `background_image` |
| `bannerImage` | `null` |
| `releaseDate` | `released`, preserving year/month/day precision |
| `providerRating` | `rating` with source maximum `5`, normalized for the shared 0–10 display |
| `releaseStatus` | `ANNOUNCED` only when `tba` is explicitly `true`; otherwise `UNKNOWN` |
| `isAdult` | `true` only for an explicit Adults Only ESRB classification; unknown remains `null` |
| `genres` | Supplied genre names |
| `metadata` | Known platform, developer, and publisher names |
| `creators` | Empty list; search results do not fabricate credits |

Missing values remain unknown or empty according to the shared contract. The search adapter does not add RAWG details-only fields such as stores, screenshots, playtime, or recommendations.

The typed response keeps the existing provider-owned shape:

```json
{
  "results": [],
  "source": "rawg",
  "pagination": { "page": 1, "perPage": 20, "hasMore": false },
  "providerErrors": []
}
```

## Combined Search

`type=all` runs four independent lanes concurrently:

| Lane | Provider | Per-page size | Fallback |
| --- | --- | ---: | --- |
| Anime | AniList | 12 | MyAnimeList only for AniList unavailability |
| Movies | TMDB | 20 | None |
| TV | TMDB | 20 | None |
| Games | RAWG | 20 | None |

```http
GET /api/media/search?type=all&q=zelda&page=1&perPage=12&includeAdult=false
```

The response is a flat list ordered by Anime, Movies, TV, and Games. Each lane keeps its Provider ordering. Results are not globally ranked, cross-Provider deduplicated, or assigned a shared relevance score.

```json
{
  "results": [],
  "source": "combined",
  "pagination": {
    "page": 1,
    "hasMore": true,
    "providers": {
      "anilist": { "page": 1, "perPage": 12, "hasMore": true },
      "tmdb": { "page": 1, "perPage": 20, "hasMore": false },
      "rawg": { "page": 1, "perPage": 20, "hasMore": true }
    },
    "continuation": "opaque-server-value"
  },
  "providerErrors": []
}
```

The `providers` map reports the latest page state by Provider. TMDB's movie and TV lanes may therefore share one provider entry. The continuation value is an opaque server value; clients pass it back without decoding or constructing it.

On a later page, only lanes with more results are requested. The cursor preserves the next page for every lane, the selected Anime provider, adult-content preference, query, and aggregate page. A failed independent lane remains retryable without refetching successful lanes:

```http
GET /api/media/search?type=all&q=zelda&page=2&cursor=<opaque>&retryProvider=rawg&includeAdult=false
```

`retryProvider` is accepted only with a valid cursor and only identifies a failed lane. A successful retry clears that Provider Failure and contributes its results to the next page. The client filters repeated Media identities when appending results.

## Failure semantics

A valid empty lane is a success, not a Provider Failure. If one or more lanes succeed, the API returns `200` with successful results and safe `{ provider, code, message }` entries for failed lanes. If every lane fails, it returns `503 PROVIDERS_UNAVAILABLE`. Upstream payloads, diagnostics, credentials, and stack traces do not cross the API boundary.

Anime remains one logical lane. AniList is attempted first; MyAnimeList is attempted only for an AniList unavailable error when the fallback is configured. If MyAnimeList covers the lane, the AniList failure is informational and the cursor pins MyAnimeList for later pages. Other AniList failures and valid empty pages do not trigger fallback.

The client keeps successful grouped sections visible after a partial failure and shows a safe notice naming the affected Provider. Typed failures retain the existing Provider-specific `PROVIDER_*` envelope and retry state.

## Attribution

The search attribution area derives its links from the Providers on the current normalized Media results, with stable Provider ordering. A Combined Search result containing AniList, TMDB, and RAWG Media therefore displays active links to all three Providers. A typed RAWG result displays an active RAWG link even when the page is empty because the response source identifies RAWG. The Credits area links to AniList, MyAnimeList, TMDB, and RAWG, and retains the required TMDB notice:

> This product uses the TMDB API but is not endorsed or certified by TMDB.

These links are attribution, not endorsement claims. RAWG credentials remain server-only and do not appear in client source, API responses, logs, fixtures, or the production bundle.

## Verification

The explicit server test command in `package.json` includes the RAWG adapter, HTTP/coordinator, and environment tests. The client command runs the complete Vitest browser boundary.

```bash
npm run check
```

The verified result is:

- 61 server tests passed.
- 29 client tests passed.
- The Vite production build completed successfully.
- The environment test confirmed blank `RAWG_API_KEY` placeholders in the root and server examples and no RAWG key identifier in client configuration/source.
- A post-build scan found no `RAWG_API_KEY` identifier in `client/dist`.
- Adapter and HTTP fixtures confirmed missing credentials, provider failures, and upstream diagnostics are handled safely without live Provider calls.

Relevant verification files include:

```text
test/rawg.test.js                    RAWG request, normalization, and failure boundary
test/media-search.test.js            typed game and Combined Search HTTP/coordinator contract
test/environment.test.js             server-only configuration inspection
client/src/api/mediaSearch.test.js   client response and cursor validation
client/src/combined-search.test.jsx  browser Games, grouping, attribution, cursor, retry, and deduplication
client/src/anime-search.test.jsx     shared search states, accessibility, stale responses, and pagination
```

The verification is deterministic and credential-free; it is not a claim that the future details, accounts, library, or deployment surfaces have been audited.

## What is deliberately next

Phase 4 does not add details routes, RAWG stores or screenshots, recommendations, trending or popular discovery, cross-Provider identity matching, global ranking, authentication, PostgreSQL, library items, caching, production rate limiting, locale or region controls, or deployment.
