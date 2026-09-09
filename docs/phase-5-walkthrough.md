# Phase 5 walkthrough: PostgreSQL, local authentication, and libraries

Status: planned

This walkthrough will explain the completed Phase 5 slice after implementation. It will remain honest about the local/staging boundary: search is public, local account Sessions protect Library Items, and Google authentication, account recovery, production rate limiting, and public deployment are future work.

## Outcome

Phase 5 will add PostgreSQL persistence, local email/password authentication, secure server-managed Sessions, ownership authorization, and Library Item CRUD for status and favorite.

## Prerequisites

- Node.js 20.19 or newer.
- Docker with Compose.
- A clean local PostgreSQL test database separate from any personal database.

## Architecture

```text
React -> Express auth/session middleware -> PostgreSQL
React -> Express library API -> ownership-scoped repository -> PostgreSQL
React -> Express media search -> provider adapters -> external APIs
```

Provider-owned Media and user-owned Library Items remain separate. Library CRUD does not call external providers or store metadata snapshots.

## Database setup

Implementation notes to complete:

1. Copy the placeholder environment file and set `DATABASE_URL` and `APP_ORIGIN`.
2. Start the PostgreSQL Compose service.
3. Run `npm run db:migrate`.
4. Confirm migration versions and health checks.

Document the exact commands and expected output after the implementation issues are complete.

## Authentication flow

Document registration, login, `/api/auth/me`, logout, cookie attributes, seven-day Session expiration, normalized emails, password policy, scrypt storage, and Origin validation. Include safe failure examples without real credentials or Session tokens.

## Library flow

Document saving a supported Media identity, default `PLANNING`/`false` values, listing with deterministic pagination, updating status/favorite, duplicate `409` behavior, deletion, and `404` ownership privacy. Show that no provider metadata hydration occurs in this phase.

## Verification

The final walkthrough will record:

- `npm run db:migrate`
- `npm run test:integration` against the dedicated PostgreSQL test database
- `npm run check` for unit tests, browser tests, production build, and client-secret verification
- Expected test counts and database health results

## Scope boundary

Phase 5 does not implement Google OAuth/OIDC, automatic identity linking, email verification, password reset, account deletion, production authentication rate limiting, abuse monitoring, public deployment, ratings, notes, tags, collections, progress, metadata snapshots, provider hydration, or refresh jobs.

## Completion record

This section will be filled after all Phase 5 issues are implemented and verified.
