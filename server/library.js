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

function updateValidationError(details) {
  return new LibraryValidationError('The Library Item patch is invalid.', details);
}

/**
 * Normalize every scalar Library Item update before persistence. Progress is
 * checked against the immutable Media type so a mixed valid/invalid patch
 * can be rejected before the UPDATE statement runs.
 *
 * @param {unknown} changes
 * @param {unknown} type
 * @returns {Record<string, unknown>}
 */
export function normalizeLibraryUpdate(changes, type) {
  if (!isPlainObject(changes)) {
    throw updateValidationError([{ field: 'body', message: 'The body must be a JSON object.' }]);
  }

  const allowedFields = new Set(['libraryStatus', 'favorite', 'personalRating', 'note', 'progress']);
  const details = [
    ...Object.keys(changes)
      .filter((field) => !allowedFields.has(field))
      .map((field) => ({ field, message: 'Unknown field.' }))
  ];
  if (Object.keys(changes).length === 0) {
    details.push({ field: 'body', message: 'At least one editable field is required.' });
  }

  const normalized = {};
  if (Object.hasOwn(changes, 'libraryStatus')) {
    if (!LIBRARY_STATUS_VALUES.includes(changes.libraryStatus)) {
      details.push({ field: 'libraryStatus', message: `libraryStatus must be one of ${LIBRARY_STATUS_VALUES.join(', ')}.` });
    } else {
      normalized.libraryStatus = changes.libraryStatus;
    }
  }
  if (Object.hasOwn(changes, 'favorite')) {
    if (typeof changes.favorite !== 'boolean') {
      details.push({ field: 'favorite', message: 'favorite must be a boolean.' });
    } else {
      normalized.favorite = changes.favorite;
    }
  }

  const normalizeField = (field, normalizer) => {
    if (!Object.hasOwn(changes, field)) return;
    try {
      normalized[field] = normalizer(changes[field]);
    } catch (error) {
      details.push(...(error.details ?? [{ field, message: error.message }]));
    }
  };
  normalizeField('personalRating', normalizePersonalRating);
  normalizeField('note', normalizeNote);
  if (Object.hasOwn(changes, 'progress')) {
    try {
      normalized.progress = validateProgress(type, changes.progress);
    } catch (error) {
      details.push(...(error.details ?? [{ field: 'progress', message: error.message }]));
    }
  }

  if (details.length > 0) throw updateValidationError(details);
  return normalized;
}

function libraryItemColumns(alias) {
  return [
    `${alias}.id`,
    `${alias}.provider`,
    `${alias}.type`,
    `${alias}.provider_id`,
    `${alias}.library_status`,
    `${alias}.favorite`,
    `${alias}.personal_rating`,
    `${alias}.note`,
    `${alias}.progress`,
    `${alias}.created_at`,
    `${alias}.updated_at`
  ].join(', ');
}

function relationshipColumns(alias) {
  return `
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('id', tag.id, 'name', tag.name)
        ORDER BY tag.normalized_name ASC, tag.id ASC
      )
      FROM library_item_tags AS item_tag
      JOIN tags AS tag
        ON tag.user_id = item_tag.user_id AND tag.id = item_tag.tag_id
      WHERE item_tag.user_id = ${alias}.user_id
        AND item_tag.library_item_id = ${alias}.id
    ), '[]'::jsonb) AS tags,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('id', collection.id, 'name', collection.name)
        ORDER BY collection.normalized_name ASC, collection.id ASC
      )
      FROM library_item_collections AS item_collection
      JOIN collections AS collection
        ON collection.user_id = item_collection.user_id AND collection.id = item_collection.collection_id
      WHERE item_collection.user_id = ${alias}.user_id
        AND item_collection.library_item_id = ${alias}.id
    ), '[]'::jsonb) AS collections`;
}

function publicLibraryItem(row) {
  return {
    id: row.id,
    provider: row.provider,
    type: row.type,
    providerId: row.provider_id,
    libraryStatus: row.library_status,
    favorite: row.favorite,
    personalRating: row.personal_rating === null || row.personal_rating === undefined ? null : Number(row.personal_rating),
    note: row.note ?? null,
    progress: row.progress ?? null,
    tags: row.tags ?? [],
    collections: row.collections ?? [],
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
    async list({ userId, page = 1, perPage = 20, libraryStatus = null, favorite = null, tagId = null, collectionId = null } = {}) {
      const offset = ((BigInt(page) - 1n) * BigInt(perPage)).toString();
      const result = await pool.query(`
        SELECT ${libraryItemColumns('item')},
          ${relationshipColumns('item')}
        FROM library_items AS item
        WHERE item.user_id = $1
          AND ($2::text IS NULL OR item.library_status = $2::text)
          AND ($3::boolean IS NULL OR item.favorite = $3::boolean)
          AND (
            $4::uuid IS NULL
            OR EXISTS (
              SELECT 1
              FROM library_item_tags AS item_tag
              WHERE item_tag.user_id = item.user_id
                AND item_tag.library_item_id = item.id
                AND item_tag.tag_id = $4::uuid
            )
          )
          AND (
            $5::uuid IS NULL
            OR EXISTS (
              SELECT 1
              FROM library_item_collections AS item_collection
              WHERE item_collection.user_id = item.user_id
                AND item_collection.library_item_id = item.id
                AND item_collection.collection_id = $5::uuid
            )
          )
        ORDER BY item.created_at DESC, item.id DESC
        LIMIT $6 OFFSET $7
      `, [userId, libraryStatus, favorite, tagId, collectionId, perPage + 1, offset]);

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
          RETURNING id, provider, type, provider_id, library_status, favorite,
            personal_rating, note, progress, created_at, updated_at
        `, [userId, provider, type, providerId]);
        return publicLibraryItem(result.rows[0]);
      } catch (error) {
        if (isUniqueViolation(error)) throw new LibraryConflictError();
        throw error;
      }
    },

    async update({ userId, id, changes = {} } = {}) {
      const current = await pool.query(`
        SELECT type
        FROM library_items
        WHERE user_id = $1 AND id = $2
      `, [userId, id]);
      if (current.rowCount === 0) return null;

      const normalizedChanges = normalizeLibraryUpdate(changes, current.rows[0].type);
      const values = [userId, id];
      const assignments = [];

      if (Object.hasOwn(normalizedChanges, 'libraryStatus')) {
        values.push(normalizedChanges.libraryStatus);
        assignments.push(`library_status = $${values.length}`);
      }
      if (Object.hasOwn(normalizedChanges, 'favorite')) {
        values.push(normalizedChanges.favorite);
        assignments.push(`favorite = $${values.length}`);
      }
      if (Object.hasOwn(normalizedChanges, 'personalRating')) {
        values.push(normalizedChanges.personalRating);
        assignments.push(`personal_rating = $${values.length}`);
      }
      if (Object.hasOwn(normalizedChanges, 'note')) {
        values.push(normalizedChanges.note);
        assignments.push(`note = $${values.length}`);
      }
      if (Object.hasOwn(normalizedChanges, 'progress')) {
        values.push(normalizedChanges.progress);
        assignments.push(`progress = $${values.length}`);
      }

      if (assignments.length === 0) return null;

      const result = await pool.query(`
        WITH updated AS (
          UPDATE library_items
          SET ${assignments.join(', ')}
          WHERE user_id = $1 AND id = $2
          RETURNING id, user_id, provider, type, provider_id, library_status, favorite,
            personal_rating, note, progress, created_at, updated_at
        )
        SELECT ${libraryItemColumns('updated')},
          ${relationshipColumns('updated')}
        FROM updated
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
