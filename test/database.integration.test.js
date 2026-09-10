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
      assert.deepEqual(firstRun.applied, ['001_initial_schema', '002_tracking_schema']);

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
        'collections',
        'library_item_collections',
        'library_item_tags',
        'library_items',
        'local_credentials',
        'schema_migrations',
        'sessions',
        'tags',
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
        'updated_at:NO:timestamp with time zone',
        'personal_rating:YES:numeric',
        'note:YES:text',
        'progress:YES:jsonb'
      ]);
      assert.deepEqual(columnsByTable.get('tags'), [
        'id:NO:uuid',
        'user_id:NO:uuid',
        'name:NO:text',
        'normalized_name:YES:text',
        'created_at:NO:timestamp with time zone',
        'updated_at:NO:timestamp with time zone'
      ]);
      assert.deepEqual(columnsByTable.get('collections'), [
        'id:NO:uuid',
        'user_id:NO:uuid',
        'name:NO:text',
        'normalized_name:YES:text',
        'created_at:NO:timestamp with time zone',
        'updated_at:NO:timestamp with time zone'
      ]);
      assert.deepEqual(columnsByTable.get('library_item_tags'), [
        'user_id:NO:uuid',
        'library_item_id:NO:uuid',
        'tag_id:NO:uuid'
      ]);
      assert.deepEqual(columnsByTable.get('library_item_collections'), [
        'user_id:NO:uuid',
        'library_item_id:NO:uuid',
        'collection_id:NO:uuid'
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
        'library_items_note_valid',
        'library_items_personal_rating_valid',
        'library_items_pkey',
        'library_items_progress_object_valid',
        'library_items_provider_id_valid',
        'library_items_provider_type_valid',
        'library_items_status_valid',
        'library_items_user_id_fkey',
        'library_items_user_id_id_unique',
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

  it('upgrades existing Phase 5 Library Items with empty tracking state', async () => {
    assertDedicatedTestDatabase(testDatabaseUrl);
    const pool = createDatabasePool({ databaseUrl: testDatabaseUrl });
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'goraku-upgrade-'));
    const schemaName = `upgrade_test_${process.pid}_${Date.now()}`;
    let schemaCreated = false;

    try {
      await pool.query(`CREATE SCHEMA ${quoteSchemaIdentifier(schemaName)}`);
      schemaCreated = true;
      await writeFile(
        join(temporaryDirectory, '001_initial_schema.sql'),
        await readFile(join('server', 'db', 'migrations', '001_initial_schema.sql'))
      );
      assert.deepEqual((await runMigrations({ pool, migrationsDirectory: temporaryDirectory, schema: schemaName })).applied, [
        '001_initial_schema'
      ]);

      const upgradedPool = await pool.connect();
      try {
        await upgradedPool.query(`SET search_path TO ${quoteSchemaIdentifier(schemaName)}, public`);
        const user = await upgradedPool.query("INSERT INTO users (email) VALUES ('phase5-row@example.com') RETURNING id");
        await upgradedPool.query(`
          INSERT INTO library_items (user_id, provider, type, provider_id)
          VALUES ($1, 'tmdb', 'MOVIE', 'phase5-row')
        `, [user.rows[0].id]);
      } finally {
        upgradedPool.release();
      }

      assert.deepEqual((await runMigrations({ pool, schema: schemaName })).applied, ['002_tracking_schema']);
      const existing = await pool.query(`
        SELECT personal_rating, note, progress
        FROM ${quoteSchemaIdentifier(schemaName)}.library_items
        WHERE provider_id = 'phase5-row'
      `);
      assert.equal(existing.rowCount, 1);
      assert.deepEqual(existing.rows[0], { personal_rating: null, note: null, progress: null });

      const memberships = await pool.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = $1
          AND table_name IN ('library_item_tags', 'library_item_collections')
      `, [schemaName]);
      assert.equal(memberships.rowCount, 2);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
      if (schemaCreated) await pool.query(`DROP SCHEMA ${quoteSchemaIdentifier(schemaName)} CASCADE`);
      await closeDatabasePool(pool);
    }
  });

  it('enforces tracking constraints, ownership-safe memberships, and cascading cleanup', async () => {
    assertDedicatedTestDatabase(testDatabaseUrl);
    const pool = createDatabasePool({ databaseUrl: testDatabaseUrl });
    const schemaName = `tracking_test_${process.pid}_${Date.now()}`;
    let schemaCreated = false;

    try {
      await pool.query(`CREATE SCHEMA ${quoteSchemaIdentifier(schemaName)}`);
      schemaCreated = true;
      await runMigrations({ pool, schema: schemaName });

      const client = await pool.connect();
      try {
        await client.query(`SET search_path TO ${quoteSchemaIdentifier(schemaName)}, public`);
        const users = await client.query(`
          INSERT INTO users (email)
          VALUES ('tracking-owner@example.com'), ('tracking-other@example.com')
          RETURNING id, email
        `);
        const ownerId = users.rows.find((row) => row.email === 'tracking-owner@example.com').id;
        const otherId = users.rows.find((row) => row.email === 'tracking-other@example.com').id;
        const item = await client.query(`
          INSERT INTO library_items (user_id, provider, type, provider_id)
          VALUES ($1, 'tmdb', 'MOVIE', 'tracking-movie')
          RETURNING id
        `, [ownerId]);
        const otherItem = await client.query(`
          INSERT INTO library_items (user_id, provider, type, provider_id)
          VALUES ($1, 'tmdb', 'MOVIE', 'tracking-other-movie')
          RETURNING id
        `, [otherId]);
        const tag = await client.query(`
          INSERT INTO tags (user_id, name)
          VALUES ($1, 'Favorites')
          RETURNING id, name, normalized_name
        `, [ownerId]);
        const otherTag = await client.query(`
          INSERT INTO tags (user_id, name)
          VALUES ($1, 'Other User Tag')
          RETURNING id
        `, [otherId]);
        const collection = await client.query(`
          INSERT INTO collections (user_id, name)
          VALUES ($1, 'Weekend Queue')
          RETURNING id
        `, [ownerId]);

        assert.deepEqual(tag.rows[0], {
          id: tag.rows[0].id,
          name: 'Favorites',
          normalized_name: 'favorites'
        });
        await client.query(`
          UPDATE library_items
          SET personal_rating = 9.5, note = $2, progress = '{"watched": false}'::jsonb
          WHERE user_id = $1 AND id = $3
        `, [ownerId, 'A valid note', item.rows[0].id]);
        await assert.rejects(
          () => client.query('UPDATE library_items SET personal_rating = 9.1 WHERE id = $1', [item.rows[0].id]),
          { code: '23514' }
        );
        await assert.rejects(
          () => client.query('UPDATE library_items SET note = $2 WHERE id = $1', [item.rows[0].id, 'x'.repeat(5_001)]),
          { code: '23514' }
        );
        await assert.rejects(
          () => client.query("UPDATE library_items SET progress = '[]'::jsonb WHERE id = $1", [item.rows[0].id]),
          { code: '23514' }
        );

        await client.query(`
          INSERT INTO library_item_tags (user_id, library_item_id, tag_id)
          VALUES ($1, $2, $3)
        `, [ownerId, item.rows[0].id, tag.rows[0].id]);
        await assert.rejects(
          () => client.query(`
            INSERT INTO library_item_tags (user_id, library_item_id, tag_id)
            VALUES ($1, $2, $3)
          `, [ownerId, item.rows[0].id, tag.rows[0].id]),
          { code: '23505' }
        );
        await assert.rejects(
          () => client.query(`
            INSERT INTO library_item_tags (user_id, library_item_id, tag_id)
            VALUES ($1, $2, $3)
          `, [ownerId, item.rows[0].id, otherTag.rows[0].id]),
          { code: '23503' }
        );
        await client.query(`
          INSERT INTO library_item_collections (user_id, library_item_id, collection_id)
          VALUES ($1, $2, $3)
        `, [ownerId, item.rows[0].id, collection.rows[0].id]);
        await assert.rejects(
          () => client.query('INSERT INTO tags (user_id, name) VALUES ($1, $2)', [ownerId, 'favorites']),
          { code: '23505' }
        );
        await assert.rejects(
          () => client.query('INSERT INTO tags (user_id, name) VALUES ($1, $2)', [ownerId, '  Not Trimmed  ']),
          { code: '23514' }
        );

        await client.query('DELETE FROM tags WHERE user_id = $1 AND id = $2', [ownerId, tag.rows[0].id]);
        const afterTagDelete = await client.query('SELECT COUNT(*)::integer AS count FROM library_item_tags WHERE library_item_id = $1', [item.rows[0].id]);
        assert.equal(afterTagDelete.rows[0].count, 0);
        await client.query('DELETE FROM library_items WHERE user_id = $1 AND id = $2', [ownerId, item.rows[0].id]);
        const afterItemDelete = await client.query('SELECT COUNT(*)::integer AS count FROM library_item_collections WHERE library_item_id = $1', [item.rows[0].id]);
        assert.equal(afterItemDelete.rows[0].count, 0);
        const otherItemStillExists = await client.query('SELECT id FROM library_items WHERE user_id = $1 AND id = $2', [otherId, otherItem.rows[0].id]);
        assert.equal(otherItemStillExists.rowCount, 1);
      } finally {
        client.release();
      }
    } finally {
      if (schemaCreated) await pool.query(`DROP SCHEMA ${quoteSchemaIdentifier(schemaName)} CASCADE`);
      await closeDatabasePool(pool);
    }
  });
});
