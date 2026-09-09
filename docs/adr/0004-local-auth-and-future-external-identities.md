# Local authentication with future external identities

Phase 5 uses local email/password authentication with server-managed Sessions while keeping each User’s internal identity independent from the authentication method. A future Google integration will attach an external Authentication Identity explicitly and will never auto-link accounts by matching email addresses; this preserves library ownership while allowing the authentication method to change later.

## Consequences

Phase 5 includes no Google OAuth routes, credentials, callbacks, email verification, password reset, or public deployment hardening. Local credentials use secure password hashing, Sessions are revocable server-side records, and all user-owned data is authorized from the authenticated User rather than a client-supplied user ID.
