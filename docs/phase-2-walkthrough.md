# Phase 2 learning walkthrough

This guide explains the completed anime search slice as it exists in the repository. It is intentionally a learning slice, not a production media platform: anime search is implemented, while manga, other media providers, accounts, persistence, and library features remain future work.

## What was built

- An accessible React search surface with debounce, cancellation, loading, empty, success, error, retry, and pagination states.
- An Express boundary at `GET /api/media/search` with strict validation and safe error envelopes.
- A server-side AniList adapter that normalizes anime results into the shared `Media` contract.
- An optional server-side MyAnimeList adapter used only when AniList is classified as unavailable.
- Deterministic adapter, HTTP, and client tests that use fixtures instead of live provider calls.

The browser never calls AniList or MyAnimeList directly. It sends relative `/api` requests to Express, and the server owns provider credentials, request timeouts, normalization, fallback policy, and safe errors.

## Run the slice

From the repository root:

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. The combined development command starts Express on port 3001 and Vite on port 5173. Vite proxies the browser's relative `/api` requests to Express.

The normal test suite needs no provider credential and makes no live provider request. The optional fallback can be enabled for a local manual run by adding the server-only variable to the root `.env.local` file or setting it before starting Express:

```text
MAL_CLIENT_ID=your-myanimelist-client-id
```

The server loads `.env.local` at startup when it exists; shell values take precedence. Restart `npm run dev` after changing the file.

AniList requires no credential for this read-only slice. MyAnimeList requires only `MAL_CLIENT_ID`; user OAuth, a client secret, redirect URLs, and user library access are out of scope. Never expose the value to the client.

## Request flow

```text
React search form
  -> client/src/api/animeSearch.js
  -> GET /api/media/search
  -> server/app.js validates the request
  -> server/media-search.js selects one provider page
  -> server/providers/anilist.js (primary)
       or server/providers/myanimelist.js (availability fallback)
  -> shared/media.js creates normalized Media values
  -> JSON response with source, pagination, and providerErrors
  -> React hook updates the visible search state
```

AniList is attempted first when no `provider` hint is present. MyAnimeList is attempted only when AniList returns `PROVIDER_UNAVAILABLE` and `MAL_CLIENT_ID` is configured. A timeout, rate limit, malformed response, generic provider error, or valid empty AniList result does not activate fallback.

The API never merges results from the two providers. A successful fallback response identifies its owner with `source: "myanimelist"` and records the safe AniList failure in `providerErrors`. Later pages send `provider=myanimelist`, so a single query cannot silently switch providers. If both attempted providers fail, the API returns `503 PROVIDERS_UNAVAILABLE` without upstream diagnostics.

## Search contract

```http
GET /api/media/search?type=anime&q=fullmetal&page=1&perPage=12&includeAdult=true
```

Important request fields:

- `type=anime` is required; manga and other types are rejected in this phase.
- `q` is trimmed and must contain 1-100 characters.
- Terms shorter than three characters return a normal empty page without a provider call, so the UI shows `No results for "..."` rather than a provider error.
- `page` defaults to 1 and is bounded from 1 through 100.
- `perPage` defaults to 12 and is bounded from 1 through 24.
- `includeAdult` accepts `true` or `false` and defaults to `true`.
- `provider` is optional and accepts `anilist` or `myanimelist` to pin later pages.

A successful response has this shape:

```json
{
  "results": [],
  "source": "anilist",
  "pagination": { "page": 1, "perPage": 12, "hasMore": false },
  "providerErrors": []
}
```

Each result is a normalized `Media` value. Provider-specific fields such as AniList's GraphQL structure or MyAnimeList's response envelope do not cross the adapter boundary. Unknown values remain `null` or empty lists; they are not fabricated.

Provider and internal failures use safe messages and an empty `details` array. The public provider codes are `PROVIDER_TIMEOUT`, `PROVIDER_RATE_LIMITED`, `PROVIDER_INVALID_RESPONSE`, `PROVIDER_UNAVAILABLE`, and `PROVIDER_ERROR`. Invalid requests use `400 VALIDATION_ERROR` with `{ field, message }` details.

## Adult-content behavior

`includeAdult=true` is the default for this temporary phase. The native checkbox is local-only: changing it resets pagination and reruns the current query. AniList receives the preference at its provider boundary; MyAnimeList filters explicit entries after normalization when it is serving the fallback page.

The normalized `Media` value preserves `isAdult` as `true`, `false`, or `null`. This is not a user preference and is not persisted. A future account-backed Content Visibility Preference can replace this temporary control without putting account state into the provider adapter.

## Client behavior to observe

1. Before a query, the page shows an instructional state and makes no search request.
2. Typing waits 300ms before searching. Changing the query cancels or ignores the previous request and clears stale results.
3. Enter and the Search button submit immediately.
4. Empty results, provider errors, and successful cards have distinct states and announcements.
5. `Load more` appends the next page. If that page fails, earlier cards remain visible and the failed page has its own retry action.
6. Cards show explicit placeholders for missing title, cover, date, rating, episode count, and duration.
7. The attribution identifies the provider source returned for the current search.

## Relevant folders

```text
client/src/App.jsx                    search page, MediaCard, visible states
client/src/hooks/useAnimeSearch.js    debounce, cancellation, pagination, retries
client/src/api/animeSearch.js         client request and response validation
server/app.js                         Express routes, query validation, HTTP envelopes
server/media-search.js                provider selection and availability fallback
server/providers/anilist.js            AniList request and Media normalization
server/providers/myanimelist.js       optional MyAnimeList request and normalization
shared/media.js                       provider-neutral Media contract
test/anilist.test.js                  AniList adapter fixtures
test/myanimelist.test.js              MyAnimeList adapter fixtures
test/media-search.test.js             HTTP contract and fallback fixtures
client/src/anime-search.test.jsx      browser search behavior fixtures
```

## Accessibility and responsive verification

The implemented surface targets WCAG 2.2 Level AA. The automated client tests verify accessible names for the search controls, `aria-busy`, polite live status messages, keyboard-reachable controls, focus order, and recovery actions. The relevant checks are `exposes labelled status and keyboard-reachable search controls` in `client/src/anime-search.test.jsx` and `allows a keyboard user to retry after the backend recovers` in `client/src/App.test.jsx`.

The recorded manual verification used Chromium 152 at 1440px and 390px viewport widths. The steps and results were:

1. Run `npm run dev`, open <http://localhost:5173>, and confirm the health status reaches `Backend connected`.
2. Use only Tab, Enter, and the keyboard to move from the search input to Search, the adult-content checkbox, pagination, and retry controls. The visible focus outline remained present and the order matched the visual order.
3. Search at both viewport widths. The 390px layout had no horizontal overflow; cards, form controls, loading states, and retry controls remained usable.
4. Use the browser's reduced-motion emulation. Smooth scrolling was disabled and the skeleton pulse animation was removed by the `prefers-reduced-motion: reduce` CSS path.
5. Inspect the labelled search region and live status announcements. The search input, results region, `aria-busy`, and polite status text exposed the expected names and state changes.
6. Check the visible focus treatment, control sizing, and color tokens. The recorded minimum checked contrast ratio was 7.16:1, with target sizing and focus visibility retained at both widths.

These are focused accessibility checks for the implemented surface, not a full automated WCAG scanner or a claim that the future application has been audited or certified as a whole.

## Repository verification

Run the complete deterministic check from the repository root:

```bash
npm test
npm run build
```

Or run both commands through the project check script:

```bash
npm run check
```

The expected verification is 32 passing server tests, 15 passing client tests, and a successful Vite production build. The tests use mocked adapters and do not require a database, provider credential, live provider call, or unsupported media type.

## What is deliberately next

This phase does not add manga search, TMDB, RAWG, details routes, trending or popular routes, authentication, PostgreSQL, user libraries, caching, retries, production rate limiting, recommendations, or deployment. The provider adapters normalize metadata only; they do not own accounts or user tracking state.

The next feature should be planned as a separate capability slice with its own provider contract and verification boundary rather than turning this anime search route into a generic integration framework.

## Troubleshooting

- If the page cannot connect, check that Express is running on port 3001. With `npm run dev`, both processes share one terminal.
- If port 3001 or 5173 is occupied, stop the other process or adjust `PORT` and `VITE_API_PROXY_TARGET`.
- If `MAL_CLIENT_ID` is absent, AniList search still works and the optional fallback is disabled.
- If the normal tests attempt a live provider request, the test boundary has been bypassed; restore the mocked adapter/request fixture instead.
