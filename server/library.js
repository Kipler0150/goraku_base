export const LIBRARY_STATUS_VALUES = Object.freeze([
  'PLANNING',
  'IN_PROGRESS',
  'COMPLETED',
  'ON_HOLD',
  'DROPPED'
]);

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
