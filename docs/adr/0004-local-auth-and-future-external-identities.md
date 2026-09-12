# Local authentication with future external identities

Status: accepted and implemented for Phase 5 local/staging use; email verification extended in ADR 0005

Phase 5 uses local password authentication with server-managed Sessions and a unique User-chosen username, while keeping each User’s internal identity independent from the authentication method. Registration collects username, email, and password; login accepts one Login Identifier and resolves either the normalized email address or username. Future external providers can attach an Authentication Identity explicitly and will never auto-link accounts by matching email addresses; this preserves library ownership while allowing the authentication method to change later.

## Consequences

Phase 5 originally included no Google OAuth routes, credentials, callbacks, email verification, password reset, or public deployment hardening. Local credentials use secure password hashing, Sessions are revocable server-side records, and all user-owned data is authorized from the authenticated User rather than a client-supplied user ID.

The verified boundary is the local PostgreSQL-backed implementation: the server manages seven-day Sessions in HTTP-only cookies, validates browser Origins on mutations, and exposes ownership-scoped Library Item CRUD. The credential-free `npm run check` boundary is separate from `npm run test:integration`, which requires the dedicated `goraku_test` database. Neither command claims production authentication hardening or public deployment readiness.
