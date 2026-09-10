import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { closeDatabasePool, createDatabasePool } from '../server/db/client.js';
import { runMigrations } from '../server/db/migrate.js';
import {
  assertDedicatedTestDatabase,
  quoteSchemaIdentifier,
  testDatabaseUrl
} from './support/postgres-integration.js';

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

      const columns = await pool.query(`
        SELECT table_name, column_name, is_nullable, data_type
        FROM information_schema.columns
        WHERE table_schema = $1
        ORDER BY table_name, ordinal_position
      `, [schemaName]);
      const columnsByTable = new Map();
      for (const row of columns.rows) {
        if (!columnsByTable.has(row.table_name)) columnsByTable.set(row.table_name, []);
        columnsByTable.get(row.table_name).push(`${row.column_name}:${row.is_nullable}:${row.data_type}`);
      }
      assert.deepEqual(columnsByTable.get('users'), [
        'id:NO:uuid',
        'email:NO:text',
        'created_at:NO:timestamp with time zone',
        'updated_at:NO:timestamp with time zone'
      ]);
      assert.deepEqual(columnsByTable.get('library_items'), [
        'id:NO:uuid',
        'user_id:NO:uuid',
        'provider:NO:text',
        'type:NO:text',
        'provider_id:NO:text',
        'library_status:NO:text',
        'favorite:NO:boolean',
        'created_at:NO:timestamp with time zone',
        'updated_at:NO:timestamp with time zone'
      ]);

      const constraints = await pool.query(`
        SELECT constraint_name
        FROM information_schema.table_constraints
        WHERE table_schema = $1
          AND table_name = 'library_items'
          AND constraint_name NOT LIKE '%_not_null'
        ORDER BY constraint_name
      `, [schemaName]);
      assert.deepEqual(constraints.rows.map((row) => row.constraint_name), [
        'library_items_pkey',
        'library_items_provider_id_valid',
        'library_items_provider_type_valid',
        'library_items_status_valid',
        'library_items_user_id_fkey',
        'library_items_user_identity_unique'
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
