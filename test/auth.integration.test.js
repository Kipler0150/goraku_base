import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { closeDatabasePool, createDatabasePool } from '../server/db/client.js';
import {
  AuthConflictError,
  createAuthService,
  hashSessionToken
} from '../server/auth.js';
import {
  assertDedicatedTestDatabase,
  createMigratedSchema,
  createTestEmailDelivery,
  dropTestSchema,
  testDatabaseUrl
} from './support/postgres-integration.js';

describe('PostgreSQL authentication model', () => {
  let pool;
  let schemaPool;
  let schemaName;
  let auth;
  let emailDelivery;

  before(async () => {
    assertDedicatedTestDatabase(testDatabaseUrl);
    pool = createDatabasePool({ databaseUrl: testDatabaseUrl });
    ({ schemaName, schemaPool } = await createMigratedSchema(pool, 'auth_test'));
    emailDelivery = createTestEmailDelivery();
    auth = createAuthService({ pool: schemaPool, emailDelivery });
  });

  after(async () => {
    if (pool) {
      await dropTestSchema(pool, schemaName);
      await closeDatabasePool(pool);
    }
  });

  it('registers a normalized pending User with a derived credential and hashed verification token', async () => {
    const pending = await auth.register({
      username: 'Reader_Name',
      email: '  User@Example.COM ',
      password: 'correct horse battery staple!'
    });

    assert.deepEqual(Object.keys(pending.user).sort(), ['avatarUpdatedAt', 'email', 'id', 'username']);
    assert.equal(pending.user.username, 'reader_name');
    assert.equal(pending.user.email, 'user@example.com');
    assert.equal(pending.verificationRequired, true);
    assert.doesNotMatch(JSON.stringify(pending), /password|session|token/i);

    const stored = await schemaPool.query(`
      SELECT u.email, u.email_verified_at, c.password_hash, t.token_hash, t.expires_at
      FROM users AS u
      INNER JOIN local_credentials AS c ON c.user_id = u.id
      INNER JOIN auth_tokens AS t ON t.user_id = u.id
      WHERE u.id = $1
    `, [pending.user.id]);
    assert.equal(stored.rowCount, 1);
    assert.equal(stored.rows[0].email, 'user@example.com');
    assert.equal(stored.rows[0].email_verified_at, null);
    assert.match(stored.rows[0].password_hash, /^scrypt\$v1\$/);
    assert.notEqual(stored.rows[0].password_hash, 'correct horse battery staple!');
    assert.match(stored.rows[0].token_hash, /^sha256\$[a-f0-9]{64}$/);
    assert.equal(stored.rows[0].expires_at.getTime() > Date.now(), true);

    const verified = await auth.verifyEmail(emailDelivery.verificationTokens.get('user@example.com'));
    assert.match(verified.session.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal((await auth.getSession(verified.session.token)).user.id, pending.user.id);
  });

  it('rejects duplicate normalized email registration without creating another User', async () => {
    await assert.rejects(
      () => auth.register({ username: 'another_reader', email: 'USER@example.com', password: 'another valid password!' }),
      (error) => error instanceof AuthConflictError && error.code === 'CONFLICT'
    );

    const users = await schemaPool.query('SELECT id FROM users WHERE email = $1', ['user@example.com']);
    assert.equal(users.rowCount, 1);
  });

  it('creates concurrent Sessions, authenticates them, and revokes only the selected Session', async () => {
    const first = await auth.login({ email: 'user@example.com', password: 'correct horse battery staple!' });
    const second = await auth.login({ identifier: ' READER_NAME ', password: 'correct horse battery staple!' });

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
