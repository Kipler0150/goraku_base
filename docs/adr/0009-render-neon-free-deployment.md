# Free Render Web Service with Neon production data

Status: accepted

For the first public deployment, Goraku Base uses one free Render Hobby Web Service to serve the built React client and Express API, with a fresh Neon Free PostgreSQL project as the persistent production data store. We chose this same-origin shape because the client already uses relative `/api` routes and server-managed Session cookies; keeping the two surfaces together avoids a new API-base and CORS boundary. Neon is separate from Render because Render's free Postgres expires after 30 days, while Render's free filesystem cannot safely hold User-owned data. The trade-off is accepted for a no-budget public beta: cold starts, limited runtime, no production-grade backups, and no uptime guarantee remain explicit constraints.
