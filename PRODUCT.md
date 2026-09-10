# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: React, JavaScript, CSS, Node.js, and Express, with npm for reproducible local setup and Docker Compose as a second local startup path.

## Users

Learners and portfolio reviewers who need a reproducible REST application, plus individuals who want to discover entertainment and maintain a private personal library.

## Product Purpose

Goraku Base is an entertainment discovery and personal tracking application. Its current local/staging surface lets a User search supported media, authenticate locally, own reference-only Library Items, and edit Personal Ratings, Notes, Tags, Collections, and media-specific Progress in the authenticated Library.

## Positioning

The project is a learning-oriented REST portfolio application: its observable browser-to-backend request path now supports provider-backed discovery and a private local/staging Library with an explicit, verifiable tracking surface.

## Operating Context

Local development uses native npm commands or Docker Compose. The health endpoint must work without a database, provider account, or external credentials. The welcome page is evaluated in a browser at a narrow and wide viewport, including keyboard interaction and recovery after the backend is stopped and restarted.

## Capabilities and Constraints

- The React client exposes the health proof, public media search, local authentication, and an ownership-scoped reference Library.
- The browser uses a relative API URL; Express owns the API boundary and safe error envelopes.
- Provider-owned Media, User-owned Library Items, and User-owned tracking data remain separate concepts.
- Phase 6 tracking slices are implemented for local/staging use; the walkthrough, boundary verification, provider hydration, production hardening, and public deployment remain outside the verified surface.

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
