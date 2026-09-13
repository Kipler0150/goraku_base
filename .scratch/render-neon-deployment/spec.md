# Render + Neon free deployment

Status: ready-for-agent
Completion: in-progress

## Scope

Deploy the current Goraku Base React/Vite client and Node/Express API as one same-origin Render Hobby Web Service backed by a fresh Neon Free PostgreSQL project. Keep the existing local database and `.env.local` out of the production data path. Use Brevo's HTTPS API for verified-email and password-recovery messages.

## Settled decisions

- Free plans only; no paid Render compute, database, disk, custom domain, or add-ons.
- One Render Web Service serves `client/dist` and `/api`.
- Render deploys the `master` branch with native Node commands.
- Neon is a new production project, preferably in Singapore, with no local data migration.
- Render's default `onrender.com` URL is the first public origin.
- Profile pictures remain PostgreSQL-backed; Render-local filesystem storage is not used.
- Provider credentials remain server-only and missing Providers produce safe availability states.
- Manual `pg_dump` is documented before future schema changes.

## Acceptance criteria

- [x] Express can serve the built client and preserve JSON responses for `/api` routes.
- [x] Production serving has HTTP-level coverage for the root document, SPA fallback, assets, and API 404 behavior.
- [x] Render build, start, and health-check settings are documented.
- [x] Neon creation, fresh migration, secret handling, smoke tests, backup, and rollback boundaries are documented.
- [ ] A fresh Neon database has all migrations applied.
- [x] The `master` branch is pushed to GitHub without secrets.
- [ ] Render Web Service deploys successfully on the Free plan.
- [ ] `APP_ORIGIN` matches the deployed Render HTTPS origin.
- [ ] Brevo verification and password reset work from the deployed origin.
- [ ] Authentication, User-owned Library Items, episode Progress, Tags, Collections, Notes, Personal Ratings, and profile pictures work against Neon.
- [ ] Search, Discovery, Recommendations, Provider fallback, and safe Provider failures are smoke-tested.

## Verification record

The production-serving seam was verified by the HTTP test suite. Commit `721239c` was pushed to the configured GitHub `master` branch. External Neon, Render, and Brevo checks remain pending until the services are provisioned.

## Comments

- 2026-09-13: User confirmed the complete free-tier deployment plan.
