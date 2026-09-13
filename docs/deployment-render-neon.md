# Render + Neon deployment guide

This guide deploys Goraku Base as a no-budget public beta using one Render Hobby Web Service and one Neon Free PostgreSQL project. The deployment keeps the React client and Express API on the same origin, so browser requests continue to use relative `/api` routes and authenticated Session cookies do not need cross-origin configuration.

## Current rollout status

- Repository preparation is complete in commit `721239c`.
- The approved `master` branch has been pushed to `https://github.com/Kipler0150/goraku_base.git`.
- Neon production project creation and migration are pending.
- Render Web Service creation and the live smoke test are pending.

## Free-tier boundary

This setup is intentionally limited to free plans. Render Free Web Services can sleep after inactivity, restart, and lose local filesystem changes. Render's free service also shares monthly runtime and bandwidth limits. Neon is the persistent production data store; do not use Render Free Postgres because that plan expires after 30 days. Brevo uses its HTTPS API, not SMTP, because Render Free blocks outbound SMTP ports.

The deployment is suitable for a hobby project or public beta. It does not promise continuous uptime, production-grade backups, or unlimited provider traffic.

## Required accounts and credentials

Create or verify these accounts before configuring Render:

| Variable | Source | Required | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | Neon | Yes | Fresh production PostgreSQL connection string; never reuse the local database. |
| `APP_ORIGIN` | Render | Yes | The exact HTTPS origin, such as `https://goraku-base.onrender.com`, with no trailing slash. |
| `EMAIL_DELIVERY_MODE` | Application | Yes | Set to `brevo`. |
| `BREVO_API_KEY` | Brevo | Yes | Server-only API key. |
| `BREVO_SENDER_EMAIL` | Brevo | Yes | A verified Brevo sender address. |
| `BREVO_SENDER_NAME` | Application | Yes | `Goraku Base`. |
| `MAL_CLIENT_ID` | MyAnimeList | Recommended | Enables MyAnimeList as the primary Anime Provider. AniList fallback needs no credential. |
| `TMDB_ACCESS_TOKEN` | TMDB | Recommended | Enables movie and TV operations. |
| `THEGAMESDB_API_KEY` | TheGamesDB | Recommended | Enables the primary game Provider. |
| `RAWG_API_KEY` | RAWG | Recommended | Enables the game fallback Provider. |

Set these non-secret deployment values in Render:

```text
NODE_ENV=production
TRUST_PROXY=true
EMAIL_DELIVERY_MODE=brevo
BREVO_SENDER_NAME=Goraku Base
```

`PORT` is supplied by Render. `VITE_API_PROXY_TARGET` is for local Vite development only and must not be added to the Render service. Never commit `.env.local`, API keys, database URLs, or Brevo credentials.

## 1. Create the fresh Neon database

1. Create a new Neon project named something like `goraku-base-production`.
2. Choose Singapore when it is available for the project and the Render service; otherwise choose the nearest shared region.
3. Copy the PostgreSQL connection string from Neon. Keep it private.
4. Apply the repository migrations once against this empty database:

   ```powershell
   $env:DATABASE_URL = '<paste-the-Neon-connection-string-in-this-terminal-only>'
   npm run db:migrate
   Remove-Item Env:DATABASE_URL
   ```

   The command should report the numbered migrations that were applied. It should not import local Users, Library Items, Tags, Collections, Sessions, or profile pictures.

5. Store the same Neon connection string in Render's `DATABASE_URL` secret after the Render service exists.

## 2. Push the deployable branch

The deployable commit is on the repository's `master` branch. Confirm that `.env.local` is ignored and that no tracked file contains a real secret before pushing:

```powershell
git status --short --branch
git diff --check
npm run check
git push origin master
```

The initial deployment commit has already been pushed. Render should deploy from `master` and automatically redeploy after future pushes.

## 3. Create the Render Web Service

Create a new **Web Service** from the GitHub repository with these settings:

| Setting | Value |
| --- | --- |
| Root Directory | repository root |
| Runtime | Node |
| Plan | Free |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |

The production server binds to Render's `PORT` on `0.0.0.0`, serves `client/dist`, and keeps `/api` routes ahead of the SPA fallback. The service receives an `onrender.com` URL after the first successful deploy.

After Render provides the URL, set `APP_ORIGIN` to that exact HTTPS origin and redeploy. Then add the remaining server-only variables from the credentials table. Do not add provider keys as `VITE_*` variables; Vite variables are client-visible.

## 4. Launch smoke test

Run these checks against the Render URL in this order:

1. Open the site and confirm the React shell loads.
2. Open `/api/health` and confirm the JSON health response.
3. Register a test User with a real, non-disposable email address.
4. Confirm Brevo delivers the verification message and follow the link.
5. Log in and confirm the Session survives a page refresh.
6. Create a Library Item, update its status, rating, Note, Tags, Collections, and Progress.
7. Upload and remove a profile picture; confirm the logo returns after removal.
8. Test Anime, movie, TV, and game Search, blank filtered Search, episodes, Discovery, and Recommendations.
9. Temporarily test a missing or invalid Provider credential and confirm the UI shows a safe Provider failure rather than exposing upstream details.
10. Confirm direct navigation to client routes such as `/library`, `/search`, and `/account` returns the React application.

## Manual backup before future changes

Neon Free is not a production backup plan. Before future schema or deployment changes, export the production database from a trusted local terminal:

```powershell
$env:DATABASE_URL = '<Neon-connection-string-in-this-terminal-only>'
pg_dump --dbname="$env:DATABASE_URL" --format=custom --file=goraku-production-$(Get-Date -Format yyyyMMdd-HHmmss).dump
Remove-Item Env:DATABASE_URL
```

Keep the dump outside the repository and protect it like the database itself. Do not upload it to GitHub.

## Troubleshooting

- **Database connection fails:** verify `DATABASE_URL`, Neon project status, and that the connection string includes SSL requirements.
- **Login or verification redirects fail:** verify `APP_ORIGIN` exactly matches the Render origin, including `https://` and excluding a trailing slash.
- **Brevo fails:** verify the API key, verified sender address, and `EMAIL_DELIVERY_MODE=brevo`; do not configure SMTP ports.
- **A Provider is unavailable:** check its server-only credential and use the app's safe Provider error state. AniList does not need a key.
- **The first request is slow:** the free Render service may be waking from idle; retry after the service starts.
- **Uploaded files disappear:** only Render-local files are ephemeral. Goraku Base profile pictures belong in Neon; do not add filesystem storage for User-owned data.

## Rollback boundary

Render can redeploy a previous application build. Database migrations are forward-only and must be backed up before future changes. A rollback of application code does not automatically roll back a Neon schema, so schema compatibility must be checked before reverting a deploy.
