import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { hashSessionToken } from '../server/auth.js';
import { closeDatabasePool, createDatabasePool } from '../server/db/client.js';
import {
  assertSafeResponse,
  assertDedicatedTestDatabase,
  createMigratedSchema,
  createTestEmailDelivery,
  dropTestSchema,
  sessionCookieValue,
  testDatabaseUrl
} from './support/postgres-integration.js';

const APP_ORIGIN = 'http://localhost:5173';
const TEST_PASSWORD = 'correct horse battery staple!';

function cookieToken(cookie) {
  return cookie.slice('goraku_session='.length);
}

function assertPublicUser(response, expectedEmail, expectedUsername) {
  assert.deepEqual(Object.keys(response.body).sort(), ['avatarUpdatedAt', 'email', 'id', 'username']);
  assert.equal(response.body.email, expectedEmail);
  assert.equal(response.body.username, expectedUsername);
}

async function registerVerified(app, emailDelivery, { username, email }) {
  const registration = await request(app)
    .post('/api/auth/register')
    .set('Origin', APP_ORIGIN)
    .send({ username, email, password: TEST_PASSWORD });
  assert.equal(registration.status, 202);
  assertSafeResponse(registration);
  assert.equal(registration.body.code, 'EMAIL_VERIFICATION_REQUIRED');
  const token = emailDelivery.verificationTokens.get(email.trim().toLowerCase());
  assert.ok(token);
  const verification = await request(app).get(`/api/auth/verify-email?token=${encodeURIComponent(token)}`);
  assert.equal(verification.status, 303);
  assertSafeResponse(verification);
  return sessionCookieValue(verification);
}

describe('PostgreSQL authentication HTTP API', () => {
  let pool;
  let schemaPool;
  let schemaName;
  let app;
  let emailDelivery;

  before(async () => {
    assertDedicatedTestDatabase(testDatabaseUrl);
    pool = createDatabasePool({ databaseUrl: testDatabaseUrl });
    ({ schemaName, schemaPool } = await createMigratedSchema(pool, 'auth_http_test'));
    emailDelivery = createTestEmailDelivery();
    app = createApp({ databasePool: schemaPool, appOrigin: APP_ORIGIN, emailDelivery });
  });

  after(async () => {
    if (pool) {
      await dropTestSchema(pool, schemaName);
      await closeDatabasePool(pool);
    }
  });

  it('registers a pending User, verifies its email, and restores it without exposing persistence secrets', async () => {
    const cookie = await registerVerified(app, emailDelivery, { username: 'HttpReader', email: '  Http.User@Example.COM ' });
    assert.match(cookie, /^goraku_session=[A-Za-z0-9_-]{43}$/);

    const currentUser = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookie);
    assert.equal(currentUser.status, 200);
    assertSafeResponse(currentUser);
    assertPublicUser(currentUser, 'http.user@example.com', 'httpreader');
  });

  it('enforces Origin validation and generic credential failures over HTTP', async () => {
    const suffix = `${process.pid}-${Date.now()}`;
    const email = `origin-${suffix}@example.com`;
    const username = `origin_${suffix.replace('-', '_')}`;
    const missingOrigin = await request(app)
      .post('/api/auth/register')
      .send({ username, email, password: TEST_PASSWORD });
    const wrongOrigin = await request(app)
      .post('/api/auth/register')
      .set('Origin', 'https://attacker.example')
      .send({ username, email, password: TEST_PASSWORD });

    assert.equal(missingOrigin.status, 403);
    assert.equal(wrongOrigin.status, 403);
    assertSafeResponse(missingOrigin);
    assertSafeResponse(wrongOrigin);
    assert.deepEqual(missingOrigin.body, {
      error: {
        code: 'ORIGIN_FORBIDDEN',
        message: 'The request Origin is not allowed.',
        details: []
      }
    });

    const registration = await request(app)
      .post('/api/auth/register')
      .set('Origin', APP_ORIGIN)
      .send({ username, email, password: TEST_PASSWORD });
    assert.equal(registration.status, 202);
    assertSafeResponse(registration);

    const duplicate = await request(app)
      .post('/api/auth/register')
      .set('Origin', APP_ORIGIN)
      .send({ username, email: email.toUpperCase(), password: TEST_PASSWORD });
    const invalidLogin = await request(app)
      .post('/api/auth/login')
      .set('Origin', APP_ORIGIN)
      .send({ email, password: 'wrong password!' });

    assert.equal(duplicate.status, 409);
    assertSafeResponse(duplicate);
    assert.deepEqual(duplicate.body, {
      error: {
        code: 'CONFLICT',
        message: 'Registration could not be completed.',
        details: []
      }
    });
    assert.equal(invalidLogin.status, 401);
    assertSafeResponse(invalidLogin);
    assert.deepEqual(invalidLogin.body, {
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'The email, username, or password is invalid.',
        details: []
      }
    });
  });

  it('creates concurrent Sessions, revokes only one, and lazily removes an expired Session', async () => {
    const suffix = `${process.pid}-${Date.now()}`;
    const email = `sessions-${suffix}@example.com`;
    const username = `sessions_${suffix.replace('-', '_')}`;
    const firstCookie = await registerVerified(app, emailDelivery, { username, email });
    const secondLogin = await request(app)
      .post('/api/auth/login')
      .set('Origin', APP_ORIGIN)
      .send({ identifier: username.toUpperCase(), password: TEST_PASSWORD });
    assertSafeResponse(secondLogin);
    const secondCookie = sessionCookieValue(secondLogin);

    assert.notEqual(firstCookie, secondCookie);

    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', firstCookie);
    const revoked = await request(app).get('/api/auth/me').set('Cookie', firstCookie);
    const concurrent = await request(app).get('/api/auth/me').set('Cookie', secondCookie);
    assert.equal(logout.status, 204);
    assert.equal(logout.text, '');
    assertSafeResponse(logout);
    assertSafeResponse(revoked);
    assertSafeResponse(concurrent);
    assert.equal(revoked.status, 401);
    assert.equal(concurrent.status, 200);

    await schemaPool.query(
      'UPDATE sessions SET created_at = $1, expires_at = $2 WHERE token_hash = $3',
      [new Date(Date.now() - 2000), new Date(Date.now() - 1000), hashSessionToken(cookieToken(secondCookie))]
    );

    const expired = await request(app).get('/api/auth/me').set('Cookie', secondCookie);
    assertSafeResponse(expired);
    assert.equal(expired.status, 401);
    const removed = await schemaPool.query('SELECT id FROM sessions WHERE token_hash = $1', [hashSessionToken(cookieToken(secondCookie))]);
    assert.equal(removed.rowCount, 0);
  });
});
