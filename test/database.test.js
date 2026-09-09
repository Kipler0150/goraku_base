import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createDatabasePool } from '../server/db/client.js';
import { getMigrationFiles } from '../server/db/migrate.js';

describe('database boundary', () => {
  it('requires an explicit server-side DATABASE_URL', () => {
    assert.throws(() => createDatabasePool({ databaseUrl: '' }), {
      message: 'DATABASE_URL is required to connect to PostgreSQL.'
    });
  });

  it('discovers migrations in version order', async () => {
    const migrations = await getMigrationFiles();

    assert.deepEqual(migrations.map(({ version }) => version), ['001_initial_schema']);
    assert.match(migrations[0].sql, /CREATE TABLE users/i);
    assert.match(migrations[0].sql, /CREATE TABLE library_items/i);
  });

  it('sorts numeric versions correctly when filenames are not zero-padded', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'goraku-migration-order-'));
    try {
      await writeFile(join(directory, '10_later.sql'), '');
      await writeFile(join(directory, '2_earlier.sql'), '');

      const migrations = await getMigrationFiles(directory);

      assert.deepEqual(migrations.map(({ version }) => version), ['2_earlier', '10_later']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('defines the ownership and media identity invariants in SQL', async () => {
    const migrations = await getMigrationFiles();
    const sql = migrations[0].sql;

    assert.match(sql, /REFERENCES users\(id\) ON DELETE CASCADE/i);
    assert.match(sql, /UNIQUE\s*\(user_id, provider, type, provider_id\)/i);
    assert.match(sql, /library_status[^;]*PLANNING/i);
    assert.match(sql, /CHECK[^;]*ANIME[^;]*MOVIE[^;]*TV[^;]*GAME/is);
    assert.match(sql, /timestamptz/i);
  });
});
