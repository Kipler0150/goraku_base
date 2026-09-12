import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import {
  AuthConflictError,
  AuthValidationError,
  normalizeEmail,
  normalizeLoginIdentifier,
  normalizeUsername,
  validatePassword
} from '../server/auth.js';
import { createApp } from '../server/app.js';

const APP_ORIGIN = 'http://localhost:5173';

function createAuthFixture() {
  let nextToken = 0;
  const users = new Map();
  const sessions = new Map();
  const avatars = new Map();
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
      async register({ username, email, password }) {
        calls += 1;
        const normalizedUsername = normalizeUsername(username);
        const normalizedEmail = normalizeEmail(email);
        if (!validatePassword(password)) {
          throw new AuthValidationError('Password does not meet the local policy.');
        }
        if (users.has(normalizedEmail)) throw new AuthConflictError('duplicate');
        const user = { id: `user-${users.size + 1}`, username: normalizedUsername, email: normalizedEmail };
        users.set(normalizedEmail, user);
        return { user, session: createSession(user) };
      },
      async login({ identifier, password }) {
        calls += 1;
        let normalizedIdentifier;
        try {
          normalizedIdentifier = normalizeLoginIdentifier(identifier);
        } catch {
          return null;
        }
        if (password !== 'correct horse battery staple!') return null;
        const user = [...users.values()].find((candidate) => candidate.email === normalizedIdentifier || candidate.username === normalizedIdentifier);
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
      },
      async getAvatar(userId) {
        return avatars.get(userId) ?? null;
      },
      async updateAvatar({ userId, data }) {
        const user = [...users.values()].find((candidate) => candidate.id === userId);
        if (!user) return null;
        avatars.set(userId, { data, contentType: 'image/png' });
        user.avatarUpdatedAt = new Date().toISOString();
        return user;
      },
      async removeAvatar(userId) {
        const user = [...users.values()].find((candidate) => candidate.id === userId);
        if (!user) return null;
        avatars.delete(userId);
        user.avatarUpdatedAt = null;
        return user;
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
      .send({ username: 'reader', email: 'user@example.com', password: 'correct horse battery staple!' });

    assert.equal(registration.status, 201);
    assert.equal(registration.headers.location, '/api/auth/me');
    assert.deepEqual(registration.body, { id: 'user-1', username: 'reader', email: 'user@example.com' });
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
      .send({ username: 'reader', email: 'user@example.com', password: 'correct horse battery staple!' });

    const invalid = await request(app)
      .post('/api/auth/login')
      .set('Origin', APP_ORIGIN)
      .send({ email: 'user@example.com', password: 'wrong password!' });

    assert.equal(invalid.status, 401);
    assert.deepEqual(invalid.body, {
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'The email, username, or password is invalid.',
        details: []
      }
    });
    assert.doesNotMatch(JSON.stringify(invalid.body), /wrong password|session|token/i);

    const duplicate = await request(app)
      .post('/api/auth/register')
      .set('Origin', APP_ORIGIN)
      .send({ username: 'reader', email: 'user@example.com', password: 'another valid password!' });

    assert.equal(duplicate.status, 409);
    assert.deepEqual(duplicate.body, {
      error: {
        code: 'CONFLICT',
        message: 'Registration could not be completed.',
        details: []
      }
    });
  });

  it('accepts a username through the canonical identifier field', async () => {
    const fixture = createAuthFixture();
    const app = authApp(fixture);

    await request(app)
      .post('/api/auth/register')
      .set('Origin', APP_ORIGIN)
      .send({ username: 'reader', email: 'user@example.com', password: 'correct horse battery staple!' });

    const login = await request(app)
      .post('/api/auth/login')
      .set('Origin', APP_ORIGIN)
      .send({ identifier: ' READER ', password: 'correct horse battery staple!' });

    assert.equal(login.status, 200);
    assert.deepEqual(login.body, { id: 'user-1', username: 'reader', email: 'user@example.com' });
  });

  it('normalizes registration emails and rejects passwords outside the policy', async () => {
    const fixture = createAuthFixture();
    const app = authApp(fixture);

    const normalized = await request(app)
      .post('/api/auth/register')
      .set('Origin', APP_ORIGIN)
      .send({ username: '  Reader_Name ', email: '  User@EXAMPLE.COM ', password: 'correct horse battery staple!' });
    const invalidPassword = await request(app)
      .post('/api/auth/register')
      .set('Origin', APP_ORIGIN)
      .send({ email: 'short-password@example.com', password: 'short!' });

    assert.equal(normalized.status, 201);
    assert.deepEqual(normalized.body, { id: 'user-1', username: 'reader_name', email: 'user@example.com' });
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
      .send({ username: 'reader', email: 'user@example.com', password: 'correct horse battery staple!', userId: 'attacker' });

    assert.equal(unknownField.status, 400);
    assert.equal(unknownField.body.error.code, 'VALIDATION_ERROR');

    const missingOrigin = await request(app)
      .post('/api/auth/register')
      .send({ username: 'reader', email: 'user@example.com', password: 'correct horse battery staple!' });
    const wrongOrigin = await request(app)
      .post('/api/auth/register')
      .set('Origin', 'https://attacker.example')
      .send({ username: 'reader', email: 'user@example.com', password: 'correct horse battery staple!' });

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
      .send({ username: 'reader', email: 'user@example.com', password: 'correct horse battery staple!' });

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
      .send({ username: 'secure_reader', email: 'secure@example.com', password: 'correct horse battery staple!' });

    assert.equal(response.status, 201);
    assert.match(response.headers['set-cookie'][0], /Secure/);
  });

  it('protects, serves, replaces, and removes the private profile avatar', async () => {
    const fixture = createAuthFixture();
    const app = authApp(fixture);
    const unauthorized = await request(app)
      .put('/api/auth/avatar')
      .set('Origin', APP_ORIGIN)
      .set('Content-Type', 'image/png')
      .send(Buffer.from('image-bytes'));

    assert.equal(unauthorized.status, 401);

    const registration = await request(app)
      .post('/api/auth/register')
      .set('Origin', APP_ORIGIN)
      .send({ username: 'reader', email: 'user@example.com', password: 'correct horse battery staple!' });
    const cookie = cookieValue(registration);
    const image = Buffer.from('image-bytes');

    const uploaded = await request(app)
      .put('/api/auth/avatar')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', cookie)
      .set('Content-Type', 'image/png')
      .send(image);

    assert.equal(uploaded.status, 200);
    assert.equal(typeof uploaded.body.avatarUpdatedAt, 'string');

    const served = await request(app)
      .get('/api/auth/avatar')
      .set('Cookie', cookie);
    assert.equal(served.status, 200);
    assert.equal(served.headers['content-type'], 'image/png');
    assert.deepEqual(served.body, image);

    const removed = await request(app)
      .delete('/api/auth/avatar')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', cookie);
    assert.equal(removed.status, 200);
    assert.equal(removed.body.avatarUpdatedAt, null);
    assert.equal((await request(app).get('/api/auth/avatar').set('Cookie', cookie)).status, 404);
  });
});
