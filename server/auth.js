import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const PASSWORD_SCRYPT_VERSION = 'v1';
const PASSWORD_SCRYPT_N = 16_384;
const PASSWORD_SCRYPT_R = 8;
const PASSWORD_SCRYPT_P = 1;
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_SALT_LENGTH = 16;
const PASSWORD_SCRYPT_MAXMEM = 32 * 1024 * 1024;
const SESSION_TOKEN_LENGTH = 32;

const ASCII_SPECIAL_CHARACTER = /[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

export class AuthValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthValidationError';
    this.code = 'VALIDATION_ERROR';
  }
}

export class AuthConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthConflictError';
    this.code = 'CONFLICT';
  }
}

/**
 * Normalize the value used as the local User's unique email identity.
 *
 * @param {unknown} email
 * @returns {string}
 */
export function normalizeEmail(email) {
  if (typeof email !== 'string') {
    throw new AuthValidationError('Email must be a valid email address.');
  }

  const normalized = email.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > 254 || !EMAIL_PATTERN.test(normalized)) {
    throw new AuthValidationError('Email must be a valid email address.');
  }

  return normalized;
}

/**
 * Check the local password policy without exposing policy details in errors.
 * Password length counts Unicode code points while the required special
 * character is deliberately restricted to printable ASCII punctuation.
 *
 * @param {unknown} password
 * @returns {boolean}
 */
export function validatePassword(password) {
  if (typeof password !== 'string') return false;

  const length = [...password].length;
  return length >= PASSWORD_MIN_LENGTH
    && length <= PASSWORD_MAX_LENGTH
    && ASCII_SPECIAL_CHARACTER.test(password);
}

function assertValidPassword(password) {
  if (!validatePassword(password)) {
    throw new AuthValidationError(
      `Password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters and contain an ASCII special character.`
    );
  }
}

function encodeBase64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function decodeBase64Url(value) {
  if (typeof value !== 'string' || value.length === 0 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    return Buffer.from(value, 'base64url');
  } catch {
    return null;
  }
}

/**
 * Derive a password hash in a versioned format so future cost changes can be
 * introduced without making existing credentials unreadable.
 *
 * @param {string} password
 * @param {{ randomBytesImpl?: Function, scryptImpl?: Function }} [options]
 * @returns {Promise<string>}
 */
export async function hashPassword(
  password,
  { randomBytesImpl = randomBytes, scryptImpl = scryptAsync } = {}
) {
  assertValidPassword(password);

  const salt = await randomBytesImpl(PASSWORD_SALT_LENGTH);
  if (!Buffer.isBuffer(salt) || salt.length !== PASSWORD_SALT_LENGTH) {
    throw new Error('Password salt generation failed.');
  }

  const derivedKey = await scryptImpl(password, salt, PASSWORD_KEY_LENGTH, {
    N: PASSWORD_SCRYPT_N,
    r: PASSWORD_SCRYPT_R,
    p: PASSWORD_SCRYPT_P,
    maxmem: PASSWORD_SCRYPT_MAXMEM
  });
  if (!Buffer.isBuffer(derivedKey) || derivedKey.length !== PASSWORD_KEY_LENGTH) {
    throw new Error('Password derivation failed.');
  }

  return [
    'scrypt',
    PASSWORD_SCRYPT_VERSION,
    `N=${PASSWORD_SCRYPT_N},r=${PASSWORD_SCRYPT_R},p=${PASSWORD_SCRYPT_P}`,
    encodeBase64Url(salt),
    encodeBase64Url(derivedKey)
  ].join('$');
}

function parsePasswordHash(storedHash) {
  if (typeof storedHash !== 'string') return null;

  const [algorithm, version, parameters, encodedSalt, encodedKey, ...extra] = storedHash.split('$');
  if (algorithm !== 'scrypt' || version !== PASSWORD_SCRYPT_VERSION || extra.length > 0) return null;
  if (parameters !== `N=${PASSWORD_SCRYPT_N},r=${PASSWORD_SCRYPT_R},p=${PASSWORD_SCRYPT_P}`) return null;

  const salt = decodeBase64Url(encodedSalt);
  const expectedKey = decodeBase64Url(encodedKey);
  if (!salt || salt.length !== PASSWORD_SALT_LENGTH || !expectedKey || expectedKey.length !== PASSWORD_KEY_LENGTH) {
    return null;
  }

  return { salt, expectedKey };
}

/**
 * Verify a password against the versioned derived value. Malformed hashes and
 * wrong passwords are indistinguishable to callers.
 *
 * @param {unknown} password
 * @param {unknown} storedHash
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, storedHash) {
  if (typeof password !== 'string') return false;

  const parsed = parsePasswordHash(storedHash);
  if (!parsed) return false;

  const derivedKey = await scryptAsync(password, parsed.salt, PASSWORD_KEY_LENGTH, {
    N: PASSWORD_SCRYPT_N,
    r: PASSWORD_SCRYPT_R,
    p: PASSWORD_SCRYPT_P,
    maxmem: PASSWORD_SCRYPT_MAXMEM
  });

  return timingSafeEqual(derivedKey, parsed.expectedKey);
}

/**
 * Create a high-entropy opaque Session token for the client boundary.
 *
 * @param {{ randomBytesImpl?: Function }} [options]
 * @returns {Promise<string>}
 */
export async function generateSessionToken({ randomBytesImpl = randomBytes } = {}) {
  const tokenBytes = await randomBytesImpl(SESSION_TOKEN_LENGTH);
  if (!Buffer.isBuffer(tokenBytes) || tokenBytes.length !== SESSION_TOKEN_LENGTH) {
    throw new Error('Session token generation failed.');
  }
  return tokenBytes.toString('base64url');
}

/**
 * Hash a Session token before it crosses the persistence boundary.
 *
 * @param {unknown} token
 * @returns {string}
 */
export function hashSessionToken(token) {
  if (typeof token !== 'string' || token.length === 0) {
    throw new AuthValidationError('Session token is invalid.');
  }
  return `sha256$${createHash('sha256').update(token, 'utf8').digest('hex')}`;
}

function nowAsDate(clock) {
  const value = typeof clock === 'function' ? clock() : clock;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Authentication clock returned an invalid time.');
  return date;
}

function publicUser(row) {
  return { id: row.id, email: row.email };
}

function publicSession(row, token) {
  const session = {
    id: row.id,
    userId: row.user_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at
  };
  if (token) {
    // Route code can read this value to set the HTTP-only cookie, while JSON
    // responses and ordinary object logging cannot serialize the secret.
    Object.defineProperty(session, 'token', {
      value: token,
      enumerable: false,
      writable: false
    });
  }
  return session;
}

function isUniqueViolation(error) {
  return error?.code === '23505';
}

async function rollback(client) {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original database error. No authentication secret is in it.
  }
}

async function withTransaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}

async function insertSession(client, userId, { token } = {}) {
  const sessionToken = token ?? await generateSessionToken();
  const tokenHash = hashSessionToken(sessionToken);
  const result = await client.query(`
    INSERT INTO sessions (user_id, token_hash, expires_at)
    VALUES ($1, $2, CURRENT_TIMESTAMP + ($3 * INTERVAL '1 millisecond'))
    RETURNING id, user_id, expires_at, created_at
  `, [userId, tokenHash, SESSION_TTL_MS]);

  return publicSession(result.rows[0], sessionToken);
}

/**
 * Create the PostgreSQL-backed local authentication model.
 *
 * The returned service is the seam for authentication routes. It returns a
 * token only to the immediate caller so the HTTP adapter can place it in a
 * cookie; it never includes password hashes or token hashes in a User or
 * Session value.
 *
 * @param {{ pool: import('pg').Pool, clock?: Function }} options
 */
export function createAuthService({ pool, clock = () => new Date() } = {}) {
  if (!pool || typeof pool.connect !== 'function' || typeof pool.query !== 'function') {
    throw new TypeError('A PostgreSQL pool is required for authentication.');
  }

  async function register({ email, password } = {}) {
    const normalizedEmail = normalizeEmail(email);
    assertValidPassword(password);
    const passwordHash = await hashPassword(password);

    try {
      return await withTransaction(pool, async (client) => {
        const userResult = await client.query(`
          INSERT INTO users (email)
          VALUES ($1)
          RETURNING id, email
        `, [normalizedEmail]);
        const user = publicUser(userResult.rows[0]);

        await client.query(`
          INSERT INTO local_credentials (user_id, password_hash)
          VALUES ($1, $2)
        `, [user.id, passwordHash]);

        const session = await insertSession(client, user.id);
        return { user, session };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AuthConflictError('A User with that email already exists.');
      }
      throw error;
    }
  }

  async function login({ email, password } = {}) {
    let normalizedEmail;
    try {
      normalizedEmail = normalizeEmail(email);
    } catch {
      return null;
    }
    if (typeof password !== 'string') return null;

    const result = await pool.query(`
      SELECT u.id, u.email, c.password_hash
      FROM users AS u
      INNER JOIN local_credentials AS c ON c.user_id = u.id
      WHERE u.email = $1
    `, [normalizedEmail]);
    if (result.rowCount === 0) return null;

    const user = result.rows[0];
    if (!await verifyPassword(password, user.password_hash)) return null;

    const session = await createSession(user.id);
    return { user: publicUser(user), session };
  }

  async function createSession(userId) {
    if (typeof userId !== 'string' || userId.length === 0) {
      throw new AuthValidationError('User ID is invalid.');
    }
    return withTransaction(pool, (client) => insertSession(client, userId));
  }

  async function getSession(token) {
    if (typeof token !== 'string' || token.length === 0) return null;

    const tokenHash = hashSessionToken(token);
    const now = nowAsDate(clock);
    const result = await pool.query(`
      WITH expired AS (
        DELETE FROM sessions
        WHERE token_hash = $1 AND expires_at <= $2
      )
      SELECT s.id, s.user_id, s.expires_at, s.created_at, u.email
      FROM sessions AS s
      INNER JOIN users AS u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > $2
    `, [tokenHash, now]);
    if (result.rowCount === 0) return null;

    const row = result.rows[0];
    return {
      session: publicSession(row),
      user: { id: row.user_id, email: row.email }
    };
  }

  async function revokeSession(token) {
    if (typeof token !== 'string' || token.length === 0) return false;

    const result = await pool.query(`
      UPDATE sessions
      SET revoked_at = CURRENT_TIMESTAMP
      WHERE token_hash = $1 AND revoked_at IS NULL
      RETURNING id
    `, [hashSessionToken(token)]);
    return result.rowCount > 0;
  }

  return {
    register,
    login,
    createSession,
    getSession,
    revokeSession
  };
}
