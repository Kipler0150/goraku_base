import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SESSION_TTL_MS,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  hashPassword,
  hashSessionToken,
  normalizeEmail,
  normalizeLoginIdentifier,
  normalizeUsername,
  validatePassword,
  verifyPassword
} from '../server/auth.js';

describe('authentication model primitives', () => {
  it('normalizes a valid email by trimming and lowercasing it', () => {
    assert.equal(normalizeEmail('  User.Name@Example.COM  '), 'user.name@example.com');
  });

  it('rejects blank, malformed, and oversized email values', () => {
    assert.throws(() => normalizeEmail(''), { code: 'VALIDATION_ERROR' });
    assert.throws(() => normalizeEmail('not-an-email'), { code: 'VALIDATION_ERROR' });
    assert.throws(() => normalizeEmail(`${'a'.repeat(250)}@example.com`), { code: 'VALIDATION_ERROR' });
  });

  it('normalizes usernames and enforces the public-name policy', () => {
    assert.equal(normalizeUsername('  Reader_Name '), 'reader_name');
    assert.throws(() => normalizeUsername('ab'), { code: 'VALIDATION_ERROR' });
    assert.throws(() => normalizeUsername('reader-name'), { code: 'VALIDATION_ERROR' });
    assert.throws(() => normalizeUsername(`a${'b'.repeat(USERNAME_MAX_LENGTH)}`), { code: 'VALIDATION_ERROR' });
    assert.equal(USERNAME_MIN_LENGTH, 3);
  });

  it('normalizes either an email or username login identifier', () => {
    assert.equal(normalizeLoginIdentifier('  USER@Example.COM '), 'user@example.com');
    assert.equal(normalizeLoginIdentifier('  Reader_Name '), 'reader_name');
    assert.throws(() => normalizeLoginIdentifier('reader-name'), { code: 'VALIDATION_ERROR' });
  });

  it('requires a 12 to 128 character password with an ASCII special character', () => {
    assert.equal(validatePassword(`aA1${'b'.repeat(PASSWORD_MIN_LENGTH - 3)}!`), true);
    assert.equal(validatePassword(`aA1${'b'.repeat(PASSWORD_MAX_LENGTH - 4)}!`), true);
    assert.equal(validatePassword('short!'), false);
    assert.equal(validatePassword(`aA1${'b'.repeat(PASSWORD_MAX_LENGTH - 3)}!!`), false);
    assert.equal(validatePassword('abcdefghijkl'), false);
    assert.equal(validatePassword(`密码密码密码1!`), false);
  });

  it('hashes passwords with a versioned scrypt format and verifies without exposing plaintext', async () => {
    const password = 'correct horse battery staple!';
    const firstHash = await hashPassword(password);
    const secondHash = await hashPassword(password);

    assert.match(firstHash, /^scrypt\$v1\$N=\d+,r=\d+,p=\d+\$[^$]+\$[^$]+$/);
    assert.notEqual(firstHash, secondHash);
    assert.equal(firstHash.includes(password), false);
    assert.equal(await verifyPassword(password, firstHash), true);
    assert.equal(await verifyPassword('wrong password!', firstHash), false);
    assert.equal(await verifyPassword(password, 'not-a-password-hash'), false);
  });

  it('hashes opaque Session tokens without retaining the token', () => {
    const token = 'opaque-session-token';
    const hash = hashSessionToken(token);

    assert.match(hash, /^sha256\$[a-f0-9]{64}$/);
    assert.notEqual(hash, token);
    assert.equal(hashSessionToken(token), hash);
  });

  it('uses a seven-day Session lifetime', () => {
    assert.equal(SESSION_TTL_MS, 7 * 24 * 60 * 60 * 1000);
  });
});
