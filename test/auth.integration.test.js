import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { closeDatabasePool, createDatabasePool } from '../server/db/client.js';
import { runMigrations } from '../server/db/migrate.js';
import {
  AuthConflictError,
  createAuthService,
  hashSessionToken
} from '../server/auth.js';

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

function createSchemaPool(pool, schema) {
  const quotedSchema = quoteSchemaIdentifier(schema);

  return {
    async connect() {
      const client = await pool.connect();
      await client.query(`SET search_path TO ${quotedSchema}, public`);
      return client;
    },
    async query(text, values) {
      const client = await pool.connect();
      try {
        await client.query(`SET search_path TO ${quotedSchema}, public`);
        return await client.query(text, values);
      } finally {
        client.release();
      }
    }
  };
}

describe('PostgreSQL authentication model', () => {
  let pool;
  let schemaPool;
  let schemaName;
  let auth;

  before(async () => {
    assertDedicatedTestDatabase(testDatabaseUrl);
    pool = createDatabasePool({ databaseUrl: testDatabaseUrl });
    schemaName = `auth_test_${process.pid}_${Date.now()}`;
    await pool.query(`CREATE SCHEMA ${quoteSchemaIdentifier(schemaName)}`);
    await runMigrations({ pool, schema: schemaName });
    schemaPool = createSchemaPool(pool, schemaName);
    auth = createAuthService({ pool: schemaPool });
  });

  after(async () => {
    if (pool) {
      await pool.query(`DROP SCHEMA ${quoteSchemaIdentifier(schemaName)} CASCADE`);
      await closeDatabasePool(pool);
    }
  });

  it('registers a normalized User with a derived credential and hashed Session', async () => {
    const sessionResult = await auth.register({
      email: '  User@Example.COM ',
      password: 'correct horse battery staple!'
    });

    assert.deepEqual(Object.keys(sessionResult.user).sort(), ['email', 'id']);
    assert.equal(sessionResult.user.email, 'user@example.com');
    assert.match(sessionResult.session.token, /^[A-Za-z0-9_-]{43}$/);
    assert.doesNotMatch(JSON.stringify(sessionResult.user), /password|session|token/i);
    assert.equal(JSON.stringify(sessionResult).includes(sessionResult.session.token), false);

    const stored = await schemaPool.query(`
      SELECT u.email, c.password_hash, s.token_hash, s.expires_at, s.created_at
      FROM users AS u
      INNER JOIN local_credentials AS c ON c.user_id = u.id
      INNER JOIN sessions AS s ON s.user_id = u.id
      WHERE u.id = $1
    `, [sessionResult.user.id]);
    assert.equal(stored.rowCount, 1);
    assert.equal(stored.rows[0].email, 'user@example.com');
    assert.match(stored.rows[0].password_hash, /^scrypt\$v1\$/);
    assert.notEqual(stored.rows[0].password_hash, 'correct horse battery staple!');
    assert.notEqual(stored.rows[0].token_hash, sessionResult.session.token);
    assert.equal(stored.rows[0].expires_at.getTime() - stored.rows[0].created_at.getTime() >= 7 * 24 * 60 * 60 * 1000 - 1000, true);
  });

  it('rejects duplicate normalized email registration without creating another User', async () => {
    await assert.rejects(
      () => auth.register({ email: 'USER@example.com', password: 'another valid password!' }),
      (error) => error instanceof AuthConflictError && error.code === 'CONFLICT'
    );

    const users = await schemaPool.query('SELECT id FROM users WHERE email = $1', ['user@example.com']);
    assert.equal(users.rowCount, 1);
  });

  it('creates concurrent Sessions, authenticates them, and revokes only the selected Session', async () => {
    const first = await auth.login({ email: 'user@example.com', password: 'correct horse battery staple!' });
    const second = await auth.login({ email: 'USER@EXAMPLE.COM', password: 'correct horse battery staple!' });

    assert.ok(first);
    assert.ok(second);
    assert.notEqual(first.session.token, second.session.token);
    assert.deepEqual((await auth.getSession(first.session.token)).user, first.user);
    assert.deepEqual((await auth.getSession(second.session.token)).user, second.user);
    assert.equal(await auth.login({ email: 'user@example.com', password: 'wrong password!' }), null);

    assert.equal(await auth.revokeSession(first.session.token), true);
    assert.equal(await auth.getSession(first.session.token), null);
    assert.deepEqual((await auth.getSession(second.session.token)).user, second.user);
  });

  it('rejects and lazily removes an expired Session', async () => {
    const session = await auth.createSession((await auth.login({
      email: 'user@example.com',
      password: 'correct horse battery staple!'
    })).user.id);
    await schemaPool.query(
      'UPDATE sessions SET created_at = $1, expires_at = $2 WHERE token_hash = $3',
      [new Date(Date.now() - 2000), new Date(Date.now() - 1000), hashSessionToken(session.token)]
    );

    assert.equal(await auth.getSession(session.token), null);
    const removed = await schemaPool.query('SELECT id FROM sessions WHERE token_hash = $1', [hashSessionToken(session.token)]);
    assert.equal(removed.rowCount, 0);
  });
});
