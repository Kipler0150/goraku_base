# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: React, JavaScript, CSS, Node.js, and Express, with npm for reproducible local setup and Docker Compose as a second local startup path.

## Users

Inferred from the Phase 1 brief: learners and portfolio reviewers who need to start the project locally and understand whether the browser can reach its backend.

## Product Purpose

Goraku Base is an entertainment discovery and personal tracking application in progress. Phase 1 succeeds when a developer can run the React client and Express API, see a minimal welcome page, and verify the request path through an explicit health check.

## Positioning

The project is a learning-oriented REST portfolio foundation: its first visible feature makes the boundary between a browser client and backend observable before provider integrations, authentication, or persistence exist.

## Operating Context

Local development uses native npm commands or Docker Compose. The health endpoint must work without a database, provider account, or external credentials. The welcome page is evaluated in a browser at a narrow and wide viewport, including keyboard interaction and recovery after the backend is stopped and restarted.

## Capabilities and Constraints

- Phase 1 exposes `GET /api/health` and a React welcome page with loading, connected, unavailable, and retry states.
- The browser uses a relative API URL; Express owns the API boundary and safe error envelopes.
- Media metadata, provider adapters, authentication, database storage, and library routes remain planned work.
- The shared Media contract is a separate Phase 1 foundation and must not be confused with personal library data.

## Brand Commitments

- Preserve the Goraku Base name.
- Use plain, honest language that distinguishes the runnable foundation from planned features.

## Evidence on Hand

- `CONTEXT.md`, `docs/architecture.md`, and `.scratch/phase-1-foundation/spec.md` provide the approved terminology and scope.
- No production visual assets, customer evidence, or established visual system exist yet.

## Product Principles

- Make the request path observable.
- Keep missing information unknown rather than fabricating success.
- Prefer small, understandable seams that can grow into later provider and library features.
- Keep setup reproducible and honest about what is implemented.

## Accessibility & Inclusion

The Phase 1 brief requires semantic HTML, keyboard access, visible focus, responsive behavior, and accessible status announcements for connectivity feedback.
