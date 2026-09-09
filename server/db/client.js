import pg from 'pg';

const { Pool } = pg;

/**
 * Create the server-side PostgreSQL connection pool.
 *
 * The URL is intentionally required here instead of allowing pg to fall back
 * to ambient PG* variables. This keeps database configuration explicit and
 * prevents accidental database connections during provider-only tests.
 *
 * @param {{ databaseUrl?: string }} [options]
 * @returns {import('pg').Pool}
 */
export function createDatabasePool({ databaseUrl = process.env.DATABASE_URL } = {}) {
  if (typeof databaseUrl !== 'string' || databaseUrl.trim().length === 0) {
    throw new Error('DATABASE_URL is required to connect to PostgreSQL.');
  }

  return new Pool({ connectionString: databaseUrl });
}

/**
 * Close a pool and wait for checked-out database resources to be released.
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<void>}
 */
export function closeDatabasePool(pool) {
  return pool.end();
}
