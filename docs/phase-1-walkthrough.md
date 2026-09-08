# Phase 1 learning walkthrough

This guide explains the runnable foundation in the repository as it exists today. It does not describe provider calls, authentication, databases, or library behavior because those are later phases.

## What was built

- A Vite-powered React client in `client/`.
- An Express API in `server/` with one live route: `GET /api/health`.
- A shared JavaScript Media contract in `shared/media.js`, with synthetic examples in `shared/examples.js`.
- HTTP, model, and targeted client behavior tests in `test/` and `client/src/App.test.jsx`.
- Native npm startup and Docker Compose startup.

## Folders and request flow

```text
client/
  src/App.jsx                 welcome surface and accessible states
  src/hooks/useHealthCheck.js cancellation and retry state
  src/api/request.js          bounded JSON request helper
  src/api/health.js           health payload validation
server/
  app.js                      Express application and error envelope
  index.js                    native server entry point
shared/
  media.js                    public normalized Media contract
  examples.js                 synthetic contract examples
test/
  http.test.js                observable Express responses
  media.test.js               public Media behavior
```

The browser calls `/api/health` through `client/src/api/health.js`. In native development Vite proxies that relative path to `http://localhost:3001`. In Compose it proxies to the `server` service. Express returns JSON, and the React hook accepts the page as connected only when the HTTP response is successful and contains both `status: "ok"` and `service: "goraku-base-api"`.

`requestJson` bounds each request at five seconds. The health hook aborts the previous attempt before retrying and aborts the current attempt when the component unmounts. An HTTP failure, invalid JSON, invalid health payload, network failure, or timeout becomes the unavailable state; none is treated as a successful connection.

## The backend contract

```http
GET /api/health
```

```json
{
  "status": "ok",
  "service": "goraku-base-api"
}
```

Unknown routes use the shared envelope:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "The requested resource was not found.",
    "details": []
  }
}
```

Unexpected server errors return a safe `500` message. Diagnostic details are logged by Express and are not sent to the browser.

## The shared Media contract

`createMedia` requires `provider`, `providerId`, and one of `ANIME`, `MANGA`, `MOVIE`, `TV`, `GAME`, or `COMIC`. Its stable ID encodes each identity segment and joins provider, type, and provider ID with colons, so a delimiter inside an ID cannot create a collision. Dates retain year/month/day precision and reject impossible calendar dates. Ratings keep their source value and maximum while computing a 0–10 normalized value; zero is valid and a missing score is `null`.

Release status is one of `ANNOUNCED`, `ONGOING`, `RELEASED`, `CANCELLED`, or `UNKNOWN`. Creator entries contain a normalized name and provider-independent role; an adapter maps provider credit labels rather than copying a raw provider object. Metadata stays type-specific: anime has episode count and duration, movies have runtime, TV has season and episode counts, and games have platforms, developers, and publishers. Missing counts are `null`, while empty lists mean that the provider supplied no entries, not that it exhaustively reported none. Manga and comic metadata remains reserved for future integrations.

Media has no personal rating, favorite, library status, notes, or progress. Those belong to a future Library Item. The examples are explicitly synthetic and are not provider records.

Inspect the four executable examples with:

```bash
npm run examples:inspect
```

The command prints the complete normalized JSON. Its output includes the preserved source ratings and normalized values, for example:

```json
{
  "anime": { "type": "ANIME", "providerRating": { "value": 87, "max": 100, "normalized": 8.7 } },
  "movie": { "type": "MOVIE", "providerRating": { "value": 4, "max": 5, "normalized": 8 } },
  "tv": { "type": "TV", "metadata": { "seasonCount": null, "episodeCount": null } },
  "game": { "type": "GAME", "metadata": { "platforms": ["PC", "Console"] } }
}
```

The abbreviated example above shows the important fields; the command output also includes the full contract defaults such as `alternativeTitles`, `genres`, `creators`, and unknown scalar values.

## Verify the result

From the repository root:

```bash
npm install
npm test
npm run build
npm run dev
```

Expected browser result: a dark, fixed-width signal page titled “A clear signal from the base.” The connection panel starts at “Checking backend connection,” then shows “Backend connected” when Express is running. Stop Express and use “Retry connection” to see “Backend unavailable”; restart Express and activate the keyboard-focusable retry button to recover.

Direct HTTP checks:

```bash
curl -i http://localhost:3001/api/health
curl -i http://localhost:3001/api/missing
```

The first response is `200` with the health JSON. The second is `404` with `error.code` equal to `NOT_FOUND`.

## Docker path (verified)

Docker Desktop is optional for native development and required only for this Compose path. From the repository root:

```bash
docker compose config -q
docker compose up --build -d
docker compose ps
curl.exe http://localhost:3001/api/health
curl.exe http://localhost:5173/api/health
docker compose down
```

Expected result: the `server` container reports `healthy`, both curl requests return the same `status: "ok"` and `service: "goraku-base-api"` JSON, and the browser at <http://localhost:5173> reports “Backend connected.” The client sends `/api/health` to its own origin; the container-only `http://server:3001` value is used only by Vite’s server-side proxy and is never sent to the browser.

Recorded verification: the native server returned the expected health and 404 responses; the native Vite proxy returned the same health JSON; Docker Compose validated, built, started both services, reported a healthy API container, and returned the same direct and proxied health responses. Chromium 152 loaded the containerized client at 390px, confirmed the browser-visible “Backend connected” state and no horizontal overflow. Chromium also captured the desktop and mobile surfaces, showed the unavailable state after Express stopped, and recovered to connected after Express restarted and retry was activated. The targeted React tests exercise loading, connected, invalid-payload unavailable, failed-HTTP unavailable, keyboard retry, timeout, and cancellation behavior.

## Troubleshooting

- If the page says unavailable, check that the API is running on port 3001. With `npm run dev`, both processes share one terminal; with separate commands, use `npm run dev:server` and `npm run dev:client`.
- If port 3001 or 5173 is occupied, stop the other process or set `PORT` for the server and `VITE_API_PROXY_TARGET` for the client proxy.
- If Compose reports a host port conflict, stop the native dev processes first, run `docker compose down`, and retry. Compose exposes Express on 3001 and Vite on 5173.
- If npm reports a stale install, remove the local `node_modules/` directory and run `npm ci` from the committed lockfile.
- Docker Compose must be run from the repository root. `docker compose down` stops the local containers; it does not remove project files.
- No provider credentials, database, or external account are needed for this phase. Docker Compose is for local development; future production hosting remains a separate roadmap concern.
