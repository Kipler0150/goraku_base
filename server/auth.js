import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { normalizeProfileAvatar } from './profile.js';
import { isDisposableEmailDomain } from './disposable-email-domains.js';
import { createEmailDelivery } from './email-delivery.js';

const scryptAsync = promisify(scrypt);

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

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
const USERNAME_PATTERN = /^[a-z0-9_]+$/;

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

export class AuthVerificationRequiredError extends Error {
  constructor(message = 'Verify your email before signing in.') {
    super(message);
    this.name = 'AuthVerificationRequiredError';
    this.code = 'EMAIL_NOT_VERIFIED';
  }
}

export class AuthTokenError extends Error {
  constructor(message = 'This authentication link is invalid or expired.') {
    super(message);
    this.name = 'AuthTokenError';
    this.code = 'AUTH_TOKEN_INVALID';
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

  if (isDisposableEmailDomain(normalized)) {
    throw new AuthValidationError('Disposable email addresses cannot be used for Goraku Base accounts.');
  }

  return normalized;
}

/**
 * Normalize the unique display name used by the local User identity.
 *
 * @param {unknown} username
 * @returns {string}
 */
export function normalizeUsername(username) {
  if (typeof username !== 'string') {
    throw new AuthValidationError('Username must use letters, numbers, or underscores.');
  }

  const normalized = username.trim().toLowerCase();
  const length = [...normalized].length;
  if (length < USERNAME_MIN_LENGTH || length > USERNAME_MAX_LENGTH || !USERNAME_PATTERN.test(normalized)) {
    throw new AuthValidationError(
      `Username must be ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} characters using letters, numbers, or underscores.`
    );
  }

  return normalized;
}

/**
 * Normalize either unique login identity accepted by the local credential.
 *
 * @param {unknown} identifier
 * @returns {string}
 */
export function normalizeLoginIdentifier(identifier) {
  if (typeof identifier !== 'string') {
    throw new AuthValidationError('Email or username is invalid.');
  }

  const normalized = identifier.trim().toLowerCase();
  return normalized.includes('@') ? normalizeEmail(normalized) : normalizeUsername(normalized);
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

/** Hash one-time verification and recovery tokens before persistence. */
export function hashAuthToken(token) {
  if (typeof token !== 'string' || token.length === 0) {
    throw new AuthValidationError('Authentication token is invalid.');
  }
  return `sha256$${createHash('sha256').update(token, 'utf8').digest('hex')}`;
}

export async function generateAuthToken({ randomBytesImpl = randomBytes } = {}) {
  const tokenBytes = await randomBytesImpl(32);
  if (!Buffer.isBuffer(tokenBytes) || tokenBytes.length !== 32) {
    throw new Error('Authentication token generation failed.');
  }
  return tokenBytes.toString('base64url');
}

function nowAsDate(clock) {
  const value = typeof clock === 'function' ? clock() : clock;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Authentication clock returned an invalid time.');
  return date;
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    avatarUpdatedAt: row.avatar_updated_at ?? null
  };
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

async function insertAuthToken(client, { userId, purpose, expiresAt } = {}) {
  const token = await generateAuthToken();
  const tokenHash = hashAuthToken(token);
  const result = await client.query(`
    INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
    VALUES ($1, $2, $3, $4)
    RETURNING expires_at
  `, [userId, purpose, tokenHash, expiresAt]);
  return { token, expiresAt: result.rows[0].expires_at };
}

/**
 * Create the PostgreSQL-backed local authentication model.
 *
 * The returned service is the seam for authentication routes. It returns a
 * token only to the immediate caller so the HTTP adapter can place it in a
 * cookie; it never includes password hashes or token hashes in a User or
 * Session value.
 *
 * @param {{ pool: import('pg').Pool, clock?: Function, emailDelivery?: object, appOrigin?: string }} options
 */
export function createAuthService({
  pool,
  clock = () => new Date(),
  emailDelivery = null,
  appOrigin
} = {}) {
  if (!pool || typeof pool.connect !== 'function' || typeof pool.query !== 'function') {
    throw new TypeError('A PostgreSQL pool is required for authentication.');
  }

  const delivery = emailDelivery ?? createEmailDelivery({ appOrigin });

  async function register({ username, email, password } = {}) {
    const normalizedUsername = normalizeUsername(username);
    const normalizedEmail = normalizeEmail(email);
    assertValidPassword(password);
    const passwordHash = await hashPassword(password);

    try {
      const result = await withTransaction(pool, async (client) => {
        const userResult = await client.query(`
          INSERT INTO users (username, email)
          VALUES ($1, $2)
          RETURNING id, username, email, avatar_updated_at
        `, [normalizedUsername, normalizedEmail]);
        const user = publicUser(userResult.rows[0]);

        await client.query(`
          INSERT INTO local_credentials (user_id, password_hash)
          VALUES ($1, $2)
        `, [user.id, passwordHash]);

        const verification = await insertAuthToken(client, {
          userId: user.id,
          purpose: 'EMAIL_VERIFICATION',
          expiresAt: new Date(nowAsDate(clock).getTime() + delivery.verificationTokenTtlMs)
        });
        return { user, verification };
      });

      await delivery.sendVerificationEmail({
        to: result.user.email,
        username: result.user.username,
        token: result.verification.token,
        expiresAt: result.verification.expiresAt
      });
      return {
        user: result.user,
        verificationRequired: true,
        email: result.user.email
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AuthConflictError('A User with that username or email already exists.');
      }
      throw error;
    }
  }

  async function login({ identifier, email, password } = {}) {
    let normalizedIdentifier;
    try {
      normalizedIdentifier = normalizeLoginIdentifier(identifier ?? email);
    } catch {
      return null;
    }
    if (typeof password !== 'string') return null;

    const result = await pool.query(`
      SELECT u.id, u.username, u.email, u.avatar_updated_at, u.email_verified_at, c.password_hash
      FROM users AS u
      INNER JOIN local_credentials AS c ON c.user_id = u.id
      WHERE u.email = $1 OR u.username = $1
    `, [normalizedIdentifier]);
    if (result.rowCount === 0) return null;

    const user = result.rows[0];
    if (!await verifyPassword(password, user.password_hash)) return null;

    if (!user.email_verified_at) throw new AuthVerificationRequiredError();

    const session = await createSession(user.id);
    return { user: publicUser(user), session };
  }

  async function createSession(userId) {
    if (typeof userId !== 'string' || userId.length === 0) {
      throw new AuthValidationError('User ID is invalid.');
    }
    return withTransaction(pool, async (client) => {
      const userResult = await client.query('SELECT email_verified_at FROM users WHERE id = $1 FOR UPDATE', [userId]);
      if (userResult.rowCount === 0) throw new AuthValidationError('User ID is invalid.');
      if (!userResult.rows[0].email_verified_at) throw new AuthVerificationRequiredError();
      return insertSession(client, userId);
    });
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
      SELECT s.id, s.user_id, s.expires_at, s.created_at, u.username, u.email, u.avatar_updated_at
      FROM sessions AS s
      INNER JOIN users AS u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > $2
        AND u.email_verified_at IS NOT NULL
    `, [tokenHash, now]);
    if (result.rowCount === 0) return null;

    const row = result.rows[0];
    return {
      session: publicSession(row),
      user: publicUser({
        id: row.user_id,
        username: row.username,
        email: row.email,
        avatar_updated_at: row.avatar_updated_at
      })
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

  async function verifyEmail(token) {
    const tokenHash = hashAuthToken(token);
    const now = nowAsDate(clock);
    return withTransaction(pool, async (client) => {
      const tokenResult = await client.query(`
        SELECT t.id, t.user_id
        FROM auth_tokens AS t
        WHERE t.purpose = 'EMAIL_VERIFICATION'
          AND t.token_hash = $1
          AND t.consumed_at IS NULL
          AND t.expires_at > $2
        FOR UPDATE
      `, [tokenHash, now]);
      if (tokenResult.rowCount === 0) throw new AuthTokenError();

      await client.query(`
        UPDATE auth_tokens
        SET consumed_at = $2
        WHERE id = $1
      `, [tokenResult.rows[0].id, now]);
      const userResult = await client.query(`
        UPDATE users
        SET email_verified_at = COALESCE(email_verified_at, $2),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING id, username, email, avatar_updated_at
      `, [tokenResult.rows[0].user_id, now]);
      if (userResult.rowCount === 0) throw new AuthTokenError();

      const user = publicUser(userResult.rows[0]);
      const session = await insertSession(client, user.id);
      return { user, session };
    });
  }

  async function resendVerification({ email } = {}) {
    const normalizedEmail = normalizeEmail(email);
    const result = await pool.query(`
      SELECT id, username, email, email_verified_at
      FROM users
      WHERE email = $1
    `, [normalizedEmail]);
    if (result.rowCount === 0 || result.rows[0].email_verified_at) return false;

    const user = result.rows[0];
    const tokenResult = await withTransaction(pool, async (client) => {
      await client.query(`
        UPDATE auth_tokens
        SET consumed_at = CURRENT_TIMESTAMP
        WHERE user_id = $1
          AND purpose = 'EMAIL_VERIFICATION'
          AND consumed_at IS NULL
      `, [user.id]);
      return insertAuthToken(client, {
        userId: user.id,
        purpose: 'EMAIL_VERIFICATION',
        expiresAt: new Date(nowAsDate(clock).getTime() + delivery.verificationTokenTtlMs)
      });
    });
    await delivery.sendVerificationEmail({
      to: user.email,
      username: user.username,
      token: tokenResult.token,
      expiresAt: tokenResult.expiresAt
    });
    return true;
  }

  async function requestPasswordReset({ email } = {}) {
    const normalizedEmail = normalizeEmail(email);
    const result = await pool.query(`
      SELECT id, username, email
      FROM users
      WHERE email = $1
        AND email_verified_at IS NOT NULL
    `, [normalizedEmail]);
    if (result.rowCount === 0) return false;

    const user = result.rows[0];
    const tokenResult = await withTransaction(pool, async (client) => {
      await client.query(`
        UPDATE auth_tokens
        SET consumed_at = CURRENT_TIMESTAMP
        WHERE user_id = $1
          AND purpose = 'PASSWORD_RESET'
          AND consumed_at IS NULL
      `, [user.id]);
      return insertAuthToken(client, {
        userId: user.id,
        purpose: 'PASSWORD_RESET',
        expiresAt: new Date(nowAsDate(clock).getTime() + delivery.passwordResetTokenTtlMs)
      });
    });
    await delivery.sendPasswordResetEmail({
      to: user.email,
      username: user.username,
      token: tokenResult.token,
      expiresAt: tokenResult.expiresAt
    });
    return true;
  }

  async function resetPassword({ token, password } = {}) {
    assertValidPassword(password);
    const passwordHash = await hashPassword(password);
    const tokenHash = hashAuthToken(token);
    const now = nowAsDate(clock);

    return withTransaction(pool, async (client) => {
      const tokenResult = await client.query(`
        SELECT id, user_id
        FROM auth_tokens
        WHERE purpose = 'PASSWORD_RESET'
          AND token_hash = $1
          AND consumed_at IS NULL
          AND expires_at > $2
        FOR UPDATE
      `, [tokenHash, now]);
      if (tokenResult.rowCount === 0) throw new AuthTokenError();

      await client.query('UPDATE auth_tokens SET consumed_at = $2 WHERE id = $1', [tokenResult.rows[0].id, now]);
      const credentialResult = await client.query(`
        UPDATE local_credentials
        SET password_hash = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $1
        RETURNING user_id
      `, [tokenResult.rows[0].user_id, passwordHash]);
      if (credentialResult.rowCount === 0) throw new AuthTokenError();
      await client.query(`
        UPDATE sessions
        SET revoked_at = CURRENT_TIMESTAMP
        WHERE user_id = $1 AND revoked_at IS NULL
      `, [tokenResult.rows[0].user_id]);
      return true;
    });
  }

  async function getAvatar(userId) {
    if (typeof userId !== 'string' || userId.length === 0) {
      throw new AuthValidationError('User ID is invalid.');
    }

    const result = await pool.query(`
      SELECT avatar_data, avatar_content_type
      FROM users
      WHERE id = $1
    `, [userId]);
    if (result.rowCount === 0 || !result.rows[0].avatar_data) return null;
    return {
      data: result.rows[0].avatar_data,
      contentType: result.rows[0].avatar_content_type
    };
  }

  async function updateAvatar({ userId, data, contentType } = {}) {
    if (typeof userId !== 'string' || userId.length === 0) {
      throw new AuthValidationError('User ID is invalid.');
    }

    const avatar = await normalizeProfileAvatar({ data, contentType });
    const result = await pool.query(`
      UPDATE users
      SET avatar_data = $2,
          avatar_content_type = $3,
          avatar_updated_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, username, email, avatar_updated_at
    `, [userId, avatar.data, avatar.contentType]);
    return result.rowCount === 0 ? null : publicUser(result.rows[0]);
  }

  async function removeAvatar(userId) {
    if (typeof userId !== 'string' || userId.length === 0) {
      throw new AuthValidationError('User ID is invalid.');
    }

    const result = await pool.query(`
      UPDATE users
      SET avatar_data = NULL,
          avatar_content_type = NULL,
          avatar_updated_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, username, email, avatar_updated_at
    `, [userId]);
    return result.rowCount === 0 ? null : publicUser(result.rows[0]);
  }

  return {
    register,
    login,
    createSession,
    getSession,
    revokeSession,
    verifyEmail,
    resendVerification,
    requestPasswordReset,
    resetPassword,
    getAvatar,
    updateAvatar,
    removeAvatar
  };
}
