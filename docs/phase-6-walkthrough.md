# Phase 6 walkthrough: personal tracking enrichment

Status: complete
Completion: complete

This walkthrough covers the completed Phase 6 local-development and controlled-staging slice. Phase 5 supplies the authenticated User, server-managed Session, and ownership-scoped Library Item foundation. Phase 6 adds the User-owned tracking state that makes those references useful without copying Provider metadata into PostgreSQL.

## Outcome

Phase 6 adds:

- Migration `002_tracking_schema.sql` for nullable scalar tracking fields, private Tags and Collections, and ownership-safe memberships.
- Domain validation for Personal Rating, Note, Tag and Collection names, and Media-type-specific Progress.
- Enriched Library Item reads and atomic scalar PATCH updates.
- Private Tag and Collection CRUD plus idempotent attach/detach membership routes.
- Library filters for Library Status, favorite, Tag, and Collection.
- An authenticated React Library editor with accessible, server-confirmed controls.
- Migration, domain, HTTP, browser, PostgreSQL integration, and client-boundary verification.

The boundary is deliberately reference-only: Library operations never call AniList, MyAnimeList, TMDB, TheGamesDB, or RAWG and never hydrate titles, images, Provider Ratings, or other Media Metadata.

## Relationship to Phase 5

Phase 5 remains the prerequisite foundation:

```text
User -> Session cookie -> ownership-scoped Library Item
                                      |
                                      +-> Personal Rating, Note, Progress
                                      +-> private Tag memberships
                                      +-> private Collection memberships
```

`POST /api/library` keeps its Phase 5 identity-only request body and creates `PLANNING` / `false` defaults with null scalar tracking and empty relationships. Phase 6 changes only the user-owned state on the local Library Item; provider identity remains immutable.

## Prerequisites

- Node.js 20.19 or newer and npm.
- Docker Desktop with Compose, or a native PostgreSQL 16-compatible server.
- The repository installed with `npm install`.

Provider credentials are optional. The credential-free test and build commands do not make live Provider calls.

## Architecture and relevant files

```text
React Library -> Express Session and Origin boundary -> PostgreSQL
React Search  -> Express media boundary -> Provider adapters
```

| Concern | Files |
| --- | --- |
| Migration and connection | `server/db/migrations/002_tracking_schema.sql`, `server/db/migrate.js`, `server/db/client.js` |
| Tracking validation and Library repository | `server/library.js` |
| Library routes | `server/library-http.js` |
| Tag, Collection, and membership repository/routes | `server/tags-collections.js`, `server/tags-collections-http.js` |
| Application wiring | `server/app.js`, `server/auth-http.js` |
| Browser API and state | `client/src/api/library.js`, `client/src/api/tagsCollections.js`, `client/src/hooks/useLibrary.js`, `client/src/hooks/useTaxonomy.js` |
| Browser surface | `client/src/App.jsx`, `client/src/styles.css` |
| Verification | `test/library-tracking.test.js`, `test/library-http.test.js`, `test/tags-collections-http.test.js`, `client/src/library-tracking-ui.test.jsx`, `test/*integration.test.js`, `scripts/verify-client-secrets.js` |

## Database setup

### 1. Configure the local server

Create or update the root `.env.local` file. Keep database URLs and Provider credentials server-only:

```text
DATABASE_URL=postgresql://goraku:goraku_dev@localhost:5432/goraku
APP_ORIGIN=http://localhost:5173
```

The server loads `.env.local`; shell variables take precedence. Never put `DATABASE_URL`, PostgreSQL credentials, or Provider keys in `client/.env*`.

### 2. Start PostgreSQL

The Compose path is:

```bash
docker compose up -d postgres
docker compose ps
```

Wait for the `postgres` service to report `healthy`.

### 3. Apply migrations

Run:

```bash
npm run db:migrate
```

Migration `001_initial_schema.sql` creates the Phase 5 User, Session, and Library Item foundation. Migration `002_tracking_schema.sql` then adds `personal_rating`, `note`, and `progress`, private `tags` and `collections`, and duplicate-safe ownership-scoped membership tables. Each migration is committed independently and rerunning the command is safe:

```text
Applied migrations: 001_initial_schema, 002_tracking_schema
```

or:

```text
Database schema is already up to date.
```

Existing Phase 5 Library Items remain valid with `null` Personal Rating, Note, and Progress values and no memberships.

### 4. Create the dedicated integration database

Integration tests must never use the normal `goraku` database:

```bash
docker compose exec postgres createdb -U goraku goraku_test
TEST_DATABASE_URL=postgresql://goraku:goraku_dev@localhost:5432/goraku_test npm run test:integration
```

PowerShell:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://goraku:goraku_dev@localhost:5432/goraku_test'
npm run test:integration
```

Every integration suite creates a unique temporary schema inside `goraku_test`, applies all migrations there, and drops that schema during teardown. The test helper rejects any database whose final name is not exactly `goraku_test`.

## API walkthrough

The examples use `curl.exe` syntax for PowerShell. First register a User and save the session cookie:

```powershell
curl.exe -i -c cookies.txt `
  -H "Origin: http://localhost:5173" `
  -H "Content-Type: application/json" `
  -d "{\"email\":\"reader@example.com\",\"password\":\"correct horse battery staple!\"}" `
  http://localhost:3001/api/auth/register
```

Create a reference-only Library Item, then read it. The response contains tracking state but no Provider title or image:

```powershell
curl.exe -i -b cookies.txt `
  -H "Origin: http://localhost:5173" `
  -H "Content-Type: application/json" `
  -d "{\"provider\":\"tmdb\",\"type\":\"movie\",\"providerId\":\"550\"}" `
  http://localhost:3001/api/library

curl.exe -i -b cookies.txt "http://localhost:3001/api/library?page=1&perPage=20"
```

Use the local Library Item UUID returned by the create response for scalar tracking:

```powershell
curl.exe -i -b cookies.txt `
  -H "Origin: http://localhost:5173" `
  -H "Content-Type: application/json" `
  -X PATCH `
  -d "{\"personalRating\":8.5,\"note\":\"Rewatch with the original commentary.\",\"progress\":{\"watched\":true},\"libraryStatus\":\"COMPLETED\",\"favorite\":true}" `
  http://localhost:3001/api/library/<library-item-uuid>
```

`PATCH` is partial but atomic: if one field is invalid, none of the fields are changed. Send `null` for a nullable field to clear it; an empty Note string also clears the Note. `0` Personal Rating, `false` movie progress, and zero episode/hour values remain valid.

Create private relationships and attach them to the Library Item:

```powershell
curl.exe -i -b cookies.txt -H "Origin: http://localhost:5173" -H "Content-Type: application/json" `
  -d "{\"name\":\"Weekend queue\"}" http://localhost:3001/api/collections

curl.exe -i -b cookies.txt -H "Origin: http://localhost:5173" -H "Content-Type: application/json" `
  -d "{\"name\":\"Favorites\"}" http://localhost:3001/api/tags

curl.exe -i -b cookies.txt -H "Origin: http://localhost:5173" -X PUT `
  http://localhost:3001/api/library/<library-item-uuid>/collections/<collection-uuid>

curl.exe -i -b cookies.txt -H "Origin: http://localhost:5173" -X PUT `
  http://localhost:3001/api/library/<library-item-uuid>/tags/<tag-uuid>
```

Repeated membership attachment and removal is safe. Deleting a Tag or Collection removes only its memberships; it never deletes the Library Item.

Filter Library reads with lowercase public query values:

```text
GET /api/library?page=1&perPage=20&libraryStatus=in_progress&favorite=true&tagId=<tag-uuid>&collectionId=<collection-uuid>
```

Library Item lists use `perPage=20` by default and allow at most 50. Results are ordered by `createdAt DESC, id DESC`; Tag and Collection lists are ordered by normalized name and then ID.

## Tracking rules

| Field | Accepted value |
| --- | --- |
| Personal Rating | `null` or a finite number from 0 to 10 in 0.5 increments |
| Note | Plain text, line breaks allowed, at most 5,000 Unicode characters; `null` or `""` clears it |
| ANIME Progress | `{ "episodesWatched": number }`, a non-negative integer |
| TV Progress | `{ "season": number, "episode": number }`, season >= 0 and episode >= 1, both integers |
| MOVIE Progress | `{ "watched": boolean }` |
| GAME Progress | `{ "hoursPlayed": number }`, non-negative with at most two decimal places |
| Tag / Collection name | Trimmed Unicode text from 1 to 50 characters, case-insensitively unique per User |

MANGA and COMIC remain reserved Media types without Phase 6 Progress rules. Progress is not capped against Provider Metadata, and unknown keys or wrong Media-type shapes are rejected.

## Browser behavior

1. Search remains public and its cards expose only the Save to library action and detected saved state.
2. A valid local Session unlocks the Library view and private Tag/Collection panel.
3. The Library editor presents Personal Rating as five keyboard-operable stars with half-star values, an explicit unrated action, a plain-text Note editor, and only the Progress control matching each Library Item type.
4. Library Status, favorite, Tag, and Collection filters are preserved while loading another page.
5. Each affected control is disabled only for its own request. Values change after the server confirms the response; rejected mutations leave the prior value visible and announce an actionable error.
6. Loading, empty, unavailable, duplicate, unauthorized, and server-rejected states use visible and accessible feedback. The existing teletext visual language, visible focus, responsive layout, and reduced-motion behavior remain in place.

## Verification

Run the credential-free check:

```bash
npm run check
```

Expected result on the verified Phase 6 slice:

- 114 server tests pass, including migration/domain/HTTP and unauthenticated-boundary coverage.
- 51 browser tests pass.
- The production Vite build succeeds.
- The client secret scan finds no server-only configuration identifiers or configured values in the generated client files.

Run the dedicated PostgreSQL suite separately:

```bash
TEST_DATABASE_URL=postgresql://goraku:goraku_dev@localhost:5432/goraku_test npm run test:integration
```

Expected result: 14 integration tests pass across migration repeatability and rollback, Phase 5 upgrade behavior, constraints, authentication, enriched Library reads and writes, ownership, pagination, duplicate-safe relationships, concurrent duplicate creation, and cascading cleanup. These tests use PostgreSQL but never call a live Provider.

The public test seams are:

- `test/database.integration.test.js`: fresh/repeat migration, rollback, upgrade, constraints, and relationship ownership.
- `test/library-tracking.test.js`: scalar and typed Progress domain values.
- `test/library-http.test.js` and `test/tags-collections-http.test.js`: safe HTTP contracts, validation, ownership, filters, pagination, and idempotence.
- `client/src/library-tracking-ui.test.jsx`: tracking controls, filters, pagination, errors, server confirmation, and unauthenticated behavior.
- `test/phase-6-boundary.test.js`, `test/auth-http.integration.test.js`, and `scripts/verify-client-secrets.js`: private-response, diagnostic, Session, and client-bundle boundaries.

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| `ECONNREFUSED` on port 5432 | Run `docker compose up -d postgres` and wait for `docker compose ps` to show `healthy`. |
| `database "goraku_test" does not exist` | Run `docker compose exec postgres createdb -U goraku goraku_test`. |
| Integration tests reject the URL | Set `TEST_DATABASE_URL` and ensure its final database name is exactly `goraku_test`; do not use the normal `goraku` URL. |
| `relation ... does not exist` from the running server | Run `npm run db:migrate` against the normal application `DATABASE_URL`; startup does not migrate automatically. |
| Browser mutation returns `ORIGIN_FORBIDDEN` | Set `APP_ORIGIN` to the exact browser origin, including scheme and port, then restart the server. |
| Search is unavailable | This is expected without optional Provider credentials and does not affect the credential-free check or local Library tracking. |
| A Note or Progress update is rejected | Check the field's Media-specific shape and limits above. The server rejects the full patch atomically. |
| Tests leave a schema after interruption | Remove only the uniquely named test schema inside `goraku_test` after confirming its test prefix. Never clean up the normal `goraku` database. |

## Operational boundary

Phase 6 is suitable for local development and controlled staging. It does not claim production deployment or production authentication hardening. Google OAuth/OIDC, account recovery, email verification, production rate limiting, abuse monitoring, roles/admin authorization, public Profiles, shared Collections, provider hydration, Media Metadata snapshots, progress history/analytics, and MANGA/COMIC Progress remain out of scope.

The separation between Provider-owned Media and User-owned tracking is recorded in [ADR 0005](adr/0005-user-owned-tracking-enrichment.md). Authentication remains attached to the stable internal User identity as recorded in [ADR 0004](adr/0004-local-auth-and-future-external-identities.md).

## Completion record

Verified on 2026-09-10:

- `npm run check` — passed: 114 server tests, 51 browser tests, production build, and client secret scan.
- `TEST_DATABASE_URL=.../goraku_test npm run test:integration` — passed: 14 dedicated PostgreSQL integration tests.
- Private route coverage confirmed that unauthenticated callers receive safe `401` responses before repository access.
- Client bundle verification confirmed that server-only configuration, persistence diagnostics, and credential/hash patterns are absent.

The Phase 6 personal tracking slice is complete for the documented local/staging boundary. Production deployment and hardening require a separate phase and separate verification.
