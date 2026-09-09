import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLocalEnvironment } from '../environment.js';
import { closeDatabasePool, createDatabasePool } from './client.js';

const DEFAULT_MIGRATIONS_DIRECTORY = fileURLToPath(new URL('./migrations/', import.meta.url));
const MIGRATION_LOCK_KEY = 0x676f72616b75n;

/**
 * @typedef {{ version: string, name: string, path: string, sql: string }} Migration
 */

/**
 * Read visible SQL migrations in lexical version order.
 *
 * @param {string} [migrationsDirectory]
 * @returns {Promise<Migration[]>}
 */
export async function getMigrationFiles(migrationsDirectory = DEFAULT_MIGRATIONS_DIRECTORY) {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const migrationNames = entries
    .filter((entry) => entry.isFile() && extname(entry.name) === '.sql')
    .map((entry) => entry.name)
    .sort();

  const migrations = await Promise.all(migrationNames.map(async (name) => {
    const version = basename(name, '.sql');
    if (!/^\d+_[a-z0-9_-]+$/.test(version)) {
      throw new Error(`Migration filename must start with a numeric version: ${name}`);
    }

    return {
      version,
      name,
      path: join(migrationsDirectory, name),
      sql: await readFile(join(migrationsDirectory, name), 'utf8')
    };
  }));

  migrations.sort((left, right) => {
    const leftNumber = BigInt(left.version.slice(0, left.version.indexOf('_')));
    const rightNumber = BigInt(right.version.slice(0, right.version.indexOf('_')));
    if (leftNumber < rightNumber) return -1;
    if (leftNumber > rightNumber) return 1;
    return left.version.localeCompare(right.version);
  });

  const versions = new Set();
  for (const migration of migrations) {
    if (versions.has(migration.version)) {
      throw new Error(`Duplicate migration version: ${migration.version}`);
    }
    versions.add(migration.version);
  }

  return migrations;
}

function quoteSchemaIdentifier(schema) {
  if (typeof schema !== 'string' || !/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new Error('Migration schema must be a simple PostgreSQL identifier.');
  }
  return `"${schema}"`;
}

async function ensureMigrationTable(client, schema) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function withTransaction(client, operation) {
  await client.query('BEGIN');
  try {
    const result = await operation();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/**
 * Apply every pending migration. Each migration is committed independently,
 * so a failed migration leaves its schema changes and tracking row rolled
 * back while previously committed migrations remain available.
 *
 * @param {{ pool?: import('pg').Pool, migrationsDirectory?: string, schema?: string }} [options]
 * @returns {Promise<{ applied: string[] }>}
 */
export async function runMigrations({ pool, migrationsDirectory = DEFAULT_MIGRATIONS_DIRECTORY, schema = 'public' } = {}) {
  const migrations = await getMigrationFiles(migrationsDirectory);
  const quotedSchema = quoteSchemaIdentifier(schema);
  const databasePool = pool ?? createDatabasePool();
  const ownsPool = !pool;
  const applied = [];
  let client;
  let lockAcquired = false;

  try {
    client = await databasePool.connect();
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    lockAcquired = true;
    await client.query(`SET search_path TO ${quotedSchema}, public`);
    await withTransaction(client, () => ensureMigrationTable(client, quotedSchema));

    for (const migration of migrations) {
      const result = await client.query(`SELECT 1 FROM ${quotedSchema}.schema_migrations WHERE version = $1`, [migration.version]);
      if (result.rowCount > 0) {
        continue;
      }

      try {
        await withTransaction(client, async () => {
          await client.query(migration.sql);
          await client.query(`INSERT INTO ${quotedSchema}.schema_migrations (version) VALUES ($1)`, [migration.version]);
        });
        applied.push(migration.version);
      } catch (error) {
        throw new Error(`Migration ${migration.name} failed.`, { cause: error });
      }
    }

    return { applied };
  } finally {
    if (client) {
      try {
        if (lockAcquired) await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
      } finally {
        client.release();
      }
    }
    if (ownsPool) await closeDatabasePool(databasePool);
  }
}

export const migrationsDirectory = DEFAULT_MIGRATIONS_DIRECTORY;

async function main() {
  loadLocalEnvironment();
  const result = await runMigrations();
  if (result.applied.length === 0) {
    console.log('Database schema is already up to date.');
    return;
  }
  console.log(`Applied migrations: ${result.applied.join(', ')}`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && currentFile === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
