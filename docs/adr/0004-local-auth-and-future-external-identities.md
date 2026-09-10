# Local authentication with future external identities

Status: accepted and implemented for Phase 5 local/staging use

Phase 5 uses local email/password authentication with server-managed Sessions while keeping each User’s internal identity independent from the authentication method. A future Google integration will attach an external Authentication Identity explicitly and will never auto-link accounts by matching email addresses; this preserves library ownership while allowing the authentication method to change later.

## Consequences

Phase 5 includes no Google OAuth routes, credentials, callbacks, email verification, password reset, or public deployment hardening. Local credentials use secure password hashing, Sessions are revocable server-side records, and all user-owned data is authorized from the authenticated User rather than a client-supplied user ID.

The verified boundary is the local PostgreSQL-backed implementation: the server manages seven-day Sessions in HTTP-only cookies, validates browser Origins on mutations, and exposes ownership-scoped Library Item CRUD. The credential-free `npm run check` boundary is separate from `npm run test:integration`, which requires the dedicated `goraku_test` database. Neither command claims production authentication hardening or public deployment readiness.
