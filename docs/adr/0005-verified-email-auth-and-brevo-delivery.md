# Verified email for local authentication

Status: accepted and implemented for the fresh local/staging start

Goraku Base keeps universal local email-and-password authentication, but a User cannot create a Session or access Library data until the User verifies control of the normalized email address through a one-time link. Verification and password-reset tokens are high-entropy opaque values stored only as SHA-256 hashes, expire, and are consumed atomically. Password reset revokes every existing Session for the User.

The application rejects a built-in baseline of common disposable email domains and accepts additional comma-separated domains through `DISPOSABLE_EMAIL_DOMAINS`. This is a policy filter, not proof of identity: the verification email remains the authoritative control check. Auth mutations have a separate process-local rate limit, and forgot-password responses remain generic to avoid account enumeration.

Transactional email uses a server-side delivery seam. Local development defaults to a console transport so the app remains testable without an active provider. Production uses Brevo through its HTTPS API, with the sender identity and API key supplied only through server environment variables. Goraku Base does not import a Brevo profile image or any other provider profile data.

## Consequences

Registration returns `202 EMAIL_VERIFICATION_REQUIRED` and does not set a Session cookie. A successful verification link creates the normal seven-day HTTP-only Session and redirects back to the app. Login for an unverified User returns a dedicated safe error, with a resend route. Password recovery has generic request semantics and a one-time reset route.

The initial disposable-domain list is intentionally bounded and can become stale. It is therefore configurable and should be refreshed as an operational task before public launch. Brevo credentials must be regenerated if Brevo returns unauthorized; local console delivery is not a production email transport.
