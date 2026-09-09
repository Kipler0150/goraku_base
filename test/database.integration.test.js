import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { closeDatabasePool, createDatabasePool } from '../server/db/client.js';
import { runMigrations } from '../server/db/migrate.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

function assertDedicatedTestDatabase(databaseUrl) {
  if (!databaseUrl) {
    throw new Error('TEST_DATABASE_URL is required to run PostgreSQL integration tests.');
  }

  let databaseName;
  try {
    databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL for a dedicated test database.');
  }
  if (databaseName !== 'goraku_test') {
    throw new Error('TEST_DATABASE_URL must point to the dedicated goraku_test database.');
  }
}

function quoteSchemaIdentifier(schema) {
  return `"${schema}"`;
}

describe('PostgreSQL migrations', () => {
  it('applies each migration once and rolls back a failed migration', async () => {
    assertDedicatedTestDatabase(testDatabaseUrl);
    const pool = createDatabasePool({ databaseUrl: testDatabaseUrl });
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'goraku-migrations-'));
    const schemaName = `migration_test_${process.pid}_${Date.now()}`;
    let schemaCreated = false;

    try {
      await pool.query(`CREATE SCHEMA ${quoteSchemaIdentifier(schemaName)}`);
      schemaCreated = true;

      const firstRun = await runMigrations({ pool, schema: schemaName });
      assert.deepEqual(firstRun.applied, ['001_initial_schema']);

      const secondRun = await runMigrations({ pool, schema: schemaName });
      assert.deepEqual(secondRun.applied, []);

      const tables = await pool.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = $1
        ORDER BY table_name
      `, [schemaName]);
      assert.deepEqual(tables.rows.map((row) => row.table_name), [
        'auth_identities',
        'library_items',
        'local_credentials',
        'schema_migrations',
        'sessions',
        'users'
      ]);

      await writeFile(join(temporaryDirectory, '001_initial_schema.sql'), await readFile(join('server', 'db', 'migrations', '001_initial_schema.sql')));
      await writeFile(join(temporaryDirectory, '002_transaction_probe.sql'), 'CREATE TABLE transaction_probe (id INTEGER);\nTHIS SQL IS INVALID;');

      await assert.rejects(() => runMigrations({ pool, migrationsDirectory: temporaryDirectory, schema: schemaName }), /Migration 002_transaction_probe\.sql failed\./);

      const failedMigration = await pool.query(`SELECT 1 FROM ${quoteSchemaIdentifier(schemaName)}.schema_migrations WHERE version = $1`, ['002_transaction_probe']);
      assert.equal(failedMigration.rowCount, 0);
      const partialTable = await pool.query("SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'transaction_probe'", [schemaName]);
      assert.equal(partialTable.rowCount, 0);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
      if (schemaCreated) await pool.query(`DROP SCHEMA ${quoteSchemaIdentifier(schemaName)} CASCADE`);
      await closeDatabasePool(pool);
    }
  });
});
