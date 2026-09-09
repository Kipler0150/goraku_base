import { loadLocalEnvironment } from './environment.js';
import { createApp } from './app.js';
import { createAuthService } from './auth.js';
import { closeDatabasePool, createDatabasePool } from './db/client.js';

loadLocalEnvironment();

const port = Number.parseInt(process.env.PORT ?? '3001', 10);
const databasePool = process.env.DATABASE_URL ? createDatabasePool() : null;
const authService = databasePool ? createAuthService({ pool: databasePool }) : null;
const app = createApp({ authService, databasePool });
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Goraku Base API listening on http://localhost:${port}`);
});

async function shutdown(signal) {
  server.close(async () => {
    if (databasePool) await closeDatabasePool(databasePool);
    console.log(`Goraku Base API stopped after ${signal}.`);
  });
}

process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
