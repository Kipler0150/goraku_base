export const LIBRARY_STATUS_VALUES = Object.freeze([
  'PLANNING',
  'IN_PROGRESS',
  'COMPLETED',
  'ON_HOLD',
  'DROPPED'
]);

export const PERSONAL_RATING_MIN = 0;
export const PERSONAL_RATING_MAX = 10;
export const PERSONAL_RATING_STEP = 0.5;
export const MAX_NOTE_LENGTH = 5_000;
export const MAX_USER_OWNED_NAME_LENGTH = 50;
export const SUPPORTED_PROGRESS_TYPES = Object.freeze(['ANIME', 'MOVIE', 'TV', 'GAME']);

export class LibraryValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'LibraryValidationError';
    this.code = 'VALIDATION_ERROR';
    this.details = details;
  }
}

export class LibraryConflictError extends Error {
  constructor(message = 'The Library Item is already in the library.') {
    super(message);
    this.name = 'LibraryConflictError';
    this.code = 'CONFLICT';
  }
}

function trackingValidationError(field, message) {
  return new LibraryValidationError(message, [{ field, message }]);
}

/**
 * Normalize a private Tag or Collection name for storage. The database owns
 * the final uniqueness check, while this function gives both resources the
 * same trimmed display and case-insensitive key policy.
 *
 * @param {unknown} value
 * @returns {{ name: string, normalizedName: string }}
 */
export function normalizeUserOwnedName(value) {
  if (typeof value !== 'string') {
    throw trackingValidationError('name', 'name must be text from 1 to 50 Unicode characters.');
  }

  const name = value.trim();
  if ([...name].length < 1 || [...name].length > MAX_USER_OWNED_NAME_LENGTH) {
    throw trackingValidationError('name', `name must be from 1 to ${MAX_USER_OWNED_NAME_LENGTH} Unicode characters.`);
  }

  return { name, normalizedName: name.toLowerCase() };
}

/**
 * Validate and preserve a User's Personal Rating. A null value clears it and
 * zero remains a valid rating.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
export function normalizePersonalRating(value) {
  if (value === null) return null;
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < PERSONAL_RATING_MIN
    || value > PERSONAL_RATING_MAX
    || !Number.isInteger(value / PERSONAL_RATING_STEP)
  ) {
    throw trackingValidationError(
      'personalRating',
      `personalRating must be null or a number from ${PERSONAL_RATING_MIN} to ${PERSONAL_RATING_MAX} in ${PERSONAL_RATING_STEP} increments.`
    );
  }
  return value;
}

/**
 * Validate a User-owned Note. Empty and null values both clear the Note.
 * Length is measured in Unicode code points rather than UTF-16 code units.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeNote(value) {
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw trackingValidationError('note', 'note must be null or plain text.');
  }
  if (value.length === 0) return null;
  if ([...value].length > MAX_NOTE_LENGTH) {
    throw trackingValidationError('note', `note must be at most ${MAX_NOTE_LENGTH} Unicode characters.`);
  }
  return value;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactlyKeys(value, expectedKeys) {
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length && expectedKeys.every((key) => Object.hasOwn(value, key));
}

function hasAtMostTwoDecimalPlaces(value) {
  const [coefficient, exponentText] = String(value).toLowerCase().split('e');
  const fractionalDigits = coefficient.includes('.') ? coefficient.split('.')[1].length : 0;
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  return Number.isInteger(exponent) && Math.max(0, fractionalDigits - exponent) <= 2;
}

/**
 * Validate Progress against the Library Item's immutable Media type.
 * Null clears Progress. The returned object contains only the accepted typed
 * fields, so callers can pass it directly to the persistence boundary.
 *
 * @param {unknown} type normalized Media type
 * @param {unknown} value
 * @returns {Record<string, number|boolean>|null}
 */
export function validateProgress(type, value) {
  if (value === null) return null;
  if (!SUPPORTED_PROGRESS_TYPES.includes(type)) {
    throw trackingValidationError('progress', 'progress is not supported for this Media type.');
  }
  if (!isPlainObject(value)) {
    throw trackingValidationError('progress', 'progress must be null or a typed JSON object.');
  }

  if (type === 'ANIME') {
    if (!hasExactlyKeys(value, ['episodesWatched']) || !Number.isInteger(value.episodesWatched) || value.episodesWatched < 0) {
      throw trackingValidationError('progress', 'ANIME progress must contain only a non-negative integer episodesWatched value.');
    }
    return { episodesWatched: value.episodesWatched };
  }

  if (type === 'TV') {
    if (
      !hasExactlyKeys(value, ['season', 'episode'])
      || !Number.isInteger(value.season)
      || value.season < 0
      || !Number.isInteger(value.episode)
      || value.episode < 1
    ) {
      throw trackingValidationError('progress', 'TV progress must contain a non-negative integer season and positive integer episode.');
    }
    return { season: value.season, episode: value.episode };
  }

  if (type === 'MOVIE') {
    if (!hasExactlyKeys(value, ['watched']) || typeof value.watched !== 'boolean') {
      throw trackingValidationError('progress', 'MOVIE progress must contain only a boolean watched value.');
    }
    return { watched: value.watched };
  }

  if (
    !hasExactlyKeys(value, ['hoursPlayed'])
    || typeof value.hoursPlayed !== 'number'
    || !Number.isFinite(value.hoursPlayed)
    || value.hoursPlayed < 0
    || !hasAtMostTwoDecimalPlaces(value.hoursPlayed)
  ) {
    throw trackingValidationError('progress', 'GAME progress must contain only a non-negative hoursPlayed value with at most two decimal places.');
  }
  return { hoursPlayed: value.hoursPlayed };
}

function isUniqueViolation(error) {
  return error?.code === '23505';
}

function publicLibraryItem(row) {
  return {
    id: row.id,
    provider: row.provider,
    type: row.type,
    providerId: row.provider_id,
    libraryStatus: row.library_status,
    favorite: row.favorite,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Create the PostgreSQL-backed Library Item repository.
 *
 * Every operation takes a User ID and includes it in its predicate. The
 * repository stores references and user-owned fields only; it has no Provider
 * adapter dependency and therefore cannot hydrate metadata during CRUD.
 *
 * @param {{ pool: import('pg').Pool }} options
 */
export function createLibraryRepository({ pool } = {}) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A PostgreSQL pool is required for the Library repository.');
  }

  return {
    async list({ userId, page = 1, perPage = 20 } = {}) {
      const offset = ((BigInt(page) - 1n) * BigInt(perPage)).toString();
      const result = await pool.query(`
        SELECT id, provider, type, provider_id, library_status, favorite, created_at, updated_at
        FROM library_items
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2 OFFSET $3
      `, [userId, perPage + 1, offset]);

      const hasMore = result.rows.length > perPage;
      return {
        results: result.rows.slice(0, perPage).map(publicLibraryItem),
        pagination: { page, perPage, hasMore }
      };
    },

    async create({ userId, provider, type, providerId } = {}) {
      try {
        const result = await pool.query(`
          INSERT INTO library_items (user_id, provider, type, provider_id)
          VALUES ($1, $2, $3, $4)
          RETURNING id, provider, type, provider_id, library_status, favorite, created_at, updated_at
        `, [userId, provider, type, providerId]);
        return publicLibraryItem(result.rows[0]);
      } catch (error) {
        if (isUniqueViolation(error)) throw new LibraryConflictError();
        throw error;
      }
    },

    async update({ userId, id, changes = {} } = {}) {
      const values = [userId, id];
      const assignments = [];

      if (Object.hasOwn(changes, 'libraryStatus')) {
        values.push(changes.libraryStatus);
        assignments.push(`library_status = $${values.length}`);
      }
      if (Object.hasOwn(changes, 'favorite')) {
        values.push(changes.favorite);
        assignments.push(`favorite = $${values.length}`);
      }

      if (assignments.length === 0) return null;

      const result = await pool.query(`
        UPDATE library_items
        SET ${assignments.join(', ')}
        WHERE user_id = $1 AND id = $2
        RETURNING id, provider, type, provider_id, library_status, favorite, created_at, updated_at
      `, values);
      return result.rowCount === 0 ? null : publicLibraryItem(result.rows[0]);
    },

    async remove({ userId, id } = {}) {
      const result = await pool.query(`
        DELETE FROM library_items
        WHERE user_id = $1 AND id = $2
        RETURNING id
      `, [userId, id]);
      return result.rowCount > 0;
    }
  };
}
