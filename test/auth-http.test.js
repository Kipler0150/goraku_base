import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import {
  AuthConflictError,
  AuthValidationError,
  normalizeEmail,
  validatePassword
} from '../server/auth.js';
import { createApp } from '../server/app.js';

const APP_ORIGIN = 'http://localhost:5173';

function createAuthFixture() {
  let nextToken = 0;
  const users = new Map();
  const sessions = new Map();
  let calls = 0;

  function createSession(user) {
    nextToken += 1;
    const token = `session-${nextToken}`;
    const session = {
      id: `session-id-${nextToken}`,
      userId: user.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      token
    };
    sessions.set(token, { user, session, revoked: false });
    return session;
  }

  return {
    service: {
      async register({ email, password }) {
        calls += 1;
        const normalizedEmail = normalizeEmail(email);
        if (!validatePassword(password)) {
          throw new AuthValidationError('Password does not meet the local policy.');
        }
        if (users.has(normalizedEmail)) throw new AuthConflictError('duplicate');
        const user = { id: `user-${users.size + 1}`, email: normalizedEmail };
        users.set(normalizedEmail, user);
        return { user, session: createSession(user) };
      },
      async login({ email, password }) {
        calls += 1;
        let normalizedEmail;
        try {
          normalizedEmail = normalizeEmail(email);
        } catch {
          return null;
        }
        if (password !== 'correct horse battery staple!') return null;
        const user = users.get(normalizedEmail);
        if (!user) return null;
        return { user, session: createSession(user) };
      },
      async getSession(token) {
        const entry = sessions.get(token);
        if (!entry || entry.revoked || entry.session.expiresAt <= new Date()) return null;
        return { user: entry.user, session: entry.session };
      },
      async revokeSession(token) {
        const entry = sessions.get(token);
        if (!entry || entry.revoked) return false;
        entry.revoked = true;
        return true;
      }
    },
    get calls() {
      return calls;
    },
    expire(token) {
      sessions.get(token).session.expiresAt = new Date(Date.now() - 1);
    }
  };
}

function authApp(fixture, options = {}) {
  return createApp({
    authService: fixture.service,
    appOrigin: APP_ORIGIN,
    ...options
  });
}

function cookieValue(response) {
  const [cookie] = response.headers['set-cookie'];
  return cookie.split(';', 1)[0];
}

describe('HTTP authentication routes', () => {
  it('registers a User, creates a Session cookie, and serves the current User', async () => {
    const fixture = createAuthFixture();
    const app = authApp(fixture);

    const registration = await request(app)
      .post('/api/auth/register')
      .set('Origin', APP_ORIGIN)
      .send({ email: 'user@example.com', password: 'correct horse battery staple!' });

    assert.equal(registration.status, 201);
    assert.equal(registration.headers.location, '/api/auth/me');
    assert.deepEqual(registration.body, { id: 'user-1', email: 'user@example.com' });
    assert.match(registration.headers['set-cookie'][0], /^goraku_session=session-1;/);
    assert.match(registration.headers['set-cookie'][0], /Path=\//);
    assert.match(registration.headers['set-cookie'][0], /HttpOnly/);
    assert.match(registration.headers['set-cookie'][0], /SameSite=Lax/);
    assert.doesNotMatch(registration.headers['set-cookie'][0], /Secure/);

    const current = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookieValue(registration));

    assert.equal(current.status, 200);
    assert.deepEqual(current.body, registration.body);
  });

  it('returns a generic invalid-credentials response and a safe duplicate conflict', async () => {
    const fixture = createAuthFixture();
    const app = authApp(fixture);

    await request(app)
      .post('/api/auth/register')
      .set('Origin', APP_ORIGIN)
      .send({ email: 'user@example.com', password: 'correct horse battery staple!' });

    const invalid = await request(app)
      .post('/api/auth/login')
      .set('Origin', APP_ORIGIN)
      .send({ email: 'user@example.com', password: 'wrong password!' });

    assert.equal(invalid.status, 401);
    assert.deepEqual(invalid.body, {
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'The email or password is invalid.',
        details: []
      }
    });
    assert.doesNotMatch(JSON.stringify(invalid.body), /wrong password|session|token/i);

    const duplicate = await request(app)
      .post('/api/auth/register')
      .set('Origin', APP_ORIGIN)
      .send({ email: 'user@example.com', password: 'another valid password!' });

    assert.equal(duplicate.status, 409);
    assert.deepEqual(duplicate.body, {
      error: {
        code: 'CONFLICT',
        message: 'Registration could not be completed.',
        details: []
      }
    });
  });

  it('normalizes registration emails and rejects passwords outside the policy', async () => {
    const fixture = createAuthFixture();
    const app = authApp(fixture);

    const normalized = await request(app)
      .post('/api/auth/register')
      .set('Origin', APP_ORIGIN)
      .send({ email: '  User@EXAMPLE.COM ', password: 'correct horse battery staple!' });
    const invalidPassword = await request(app)
      .post('/api/auth/register')
      .set('Origin', APP_ORIGIN)
      .send({ email: 'short-password@example.com', password: 'short!' });

    assert.equal(normalized.status, 201);
    assert.deepEqual(normalized.body, { id: 'user-1', email: 'user@example.com' });
    assert.equal(invalidPassword.status, 400);
    assert.equal(invalidPassword.body.error.code, 'VALIDATION_ERROR');
  });

  it('rejects malformed auth input and invalid browser Origins before calling the service', async () => {
    const fixture = createAuthFixture();
    const app = authApp(fixture);

    const malformedJson = await request(app)
      .post('/api/auth/register')
      .set('Origin', APP_ORIGIN)
      .set('Content-Type', 'application/json')
      .send('{"email":');

    assert.equal(malformedJson.status, 400);
    assert.equal(malformedJson.body.error.code, 'VALIDATION_ERROR');

    const unknownField = await request(app)
      .post('/api/auth/register')
      .set('Origin', APP_ORIGIN)
      .send({ email: 'user@example.com', password: 'correct horse battery staple!', userId: 'attacker' });

    assert.equal(unknownField.status, 400);
    assert.equal(unknownField.body.error.code, 'VALIDATION_ERROR');

    const missingOrigin = await request(app)
      .post('/api/auth/register')
      .send({ email: 'user@example.com', password: 'correct horse battery staple!' });
    const wrongOrigin = await request(app)
      .post('/api/auth/register')
      .set('Origin', 'https://attacker.example')
      .send({ email: 'user@example.com', password: 'correct horse battery staple!' });

    assert.equal(missingOrigin.status, 403);
    assert.equal(wrongOrigin.status, 403);
    assert.equal(fixture.calls, 0);
  });

  it('expires Sessions, revokes only the selected Session, and clears the cookie on logout', async () => {
    const fixture = createAuthFixture();
    const app = authApp(fixture);

    await request(app)
      .post('/api/auth/register')
      .set('Origin', APP_ORIGIN)
      .send({ email: 'user@example.com', password: 'correct horse battery staple!' });

    const firstLogin = await request(app)
      .post('/api/auth/login')
      .set('Origin', APP_ORIGIN)
      .send({ email: 'user@example.com', password: 'correct horse battery staple!' });
    const secondLogin = await request(app)
      .post('/api/auth/login')
      .set('Origin', APP_ORIGIN)
      .send({ email: 'user@example.com', password: 'correct horse battery staple!' });
    const firstCookie = cookieValue(firstLogin);
    const secondCookie = cookieValue(secondLogin);

    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', firstCookie);

    assert.equal(logout.status, 204);
    assert.equal(logout.text, '');
    assert.match(logout.headers['set-cookie'][0], /^goraku_session=;/);
    assert.match(logout.headers['set-cookie'][0], /Max-Age=0/);

    const revoked = await request(app).get('/api/auth/me').set('Cookie', firstCookie);
    const concurrent = await request(app).get('/api/auth/me').set('Cookie', secondCookie);
    assert.equal(revoked.status, 401);
    assert.equal(concurrent.status, 200);

    fixture.expire(secondCookie.split('=', 2)[1]);
    const expired = await request(app).get('/api/auth/me').set('Cookie', secondCookie);
    assert.equal(expired.status, 401);
  });

  it('marks production Session cookies Secure', async () => {
    const fixture = createAuthFixture();
    const app = authApp(fixture, { secureCookies: true });

    const response = await request(app)
      .post('/api/auth/register')
      .set('Origin', APP_ORIGIN)
      .send({ email: 'secure@example.com', password: 'correct horse battery staple!' });

    assert.equal(response.status, 201);
    assert.match(response.headers['set-cookie'][0], /Secure/);
  });
});
