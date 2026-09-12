# Phase 7.6: Tests, walkthrough, and project boundary

Status: ready-for-agent
Completion: complete

Blocked by: 01, 02, 03, 04, 05

## Goal

Verify the complete Phase 7 Discovery and runtime-reliability slice and document its implementation path, operational boundary, and explicit separation from Phase 8 UI refinement.

## Acceptance Criteria

- [x] Add complete adapter, domain/service, HTTP, browser, cache, rate-limit, observability, and integration coverage from the Phase 7 specification.
- [x] Run npm run check without Provider credentials or live Provider calls.
- [x] Run npm run test:integration against the dedicated goraku_test database.
- [x] Add docs/phase-7-walkthrough.md with setup, routes, capability behavior, cache/rate-limit flows, client behavior, verification, and troubleshooting.
- [x] Add the Phase 7 ADR and update README, architecture, PRODUCT.md, DESIGN.md, and relevant glossary references.
- [x] Confirm no Provider credentials, upstream diagnostics, query contents, Sessions, Library Items, or tracking data reach caches, logs, client bundles, or public errors.
- [x] Confirm the Phase 8 presentation refinement is documented and implemented within its boundary.
- [x] Record final verification and check every Phase 7 acceptance item before marking Completion complete.

## Verification

- `npm run check` passed on 2026-09-10 with 169 server tests, 70 client tests, a production client build, and the client-secret scan, without Provider credentials or live Provider calls.
- `TEST_DATABASE_URL=postgresql://goraku:goraku_dev@localhost:5432/goraku_test npm run test:integration` passed on 2026-09-10 with all 14 dedicated PostgreSQL integration tests passing.
- Existing Phase 7 adapter, service, HTTP, cache, rate-limit, observability, browser, and boundary tests cover the accepted seams. The cache, runtime-signal, safe-error, private-route, and client-build checks exclude credentials, upstream diagnostics, query contents, Sessions, Library Items, and tracking fields from the relevant public surfaces.
- `docs/phase-7-walkthrough.md` and ADR 0006 are complete; README, architecture, PRODUCT.md, DESIGN.md, and CONTEXT.md record Phase 7 as implemented for local development and controlled staging. Phase 8 presentation refinements are complete in their own scoped follow-up.

## Comments

- 2026-09-10 - Verification complete: `npm run check` passed with 169 server tests, 70 client tests, production build, and client-secret scan. The dedicated `goraku_test` integration run passed all 14 PostgreSQL tests. Phase 8 presentation refinement was subsequently completed in its scoped follow-up.
- 2026-09-10 — Planned final boundary ticket. Phase 7 remains local development and controlled staging; production hardening and deployment require a later phase.
