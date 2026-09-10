import {
  LibraryConflictError,
  normalizeUserOwnedName
} from './library.js';

const RESOURCE_DEFINITIONS = Object.freeze({
  tag: Object.freeze({
    table: 'tags',
    membershipTable: 'library_item_tags',
    membershipColumn: 'tag_id'
  }),
  collection: Object.freeze({
    table: 'collections',
    membershipTable: 'library_item_collections',
    membershipColumn: 'collection_id'
  })
});

function definitionFor(resource) {
  const definition = RESOURCE_DEFINITIONS[resource];
  if (!definition) throw new TypeError(`Unknown User-owned resource: ${resource}`);
  return definition;
}

function publicResource(row) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function isUniqueViolation(error) {
  return error?.code === '23505';
}

function validatedDisplayName(name) {
  return normalizeUserOwnedName(name).name;
}

async function listResources(pool, resource, { userId, page = 1, perPage = 20 } = {}) {
  const definition = definitionFor(resource);
  const offset = ((BigInt(page) - 1n) * BigInt(perPage)).toString();
  const result = await pool.query(`
    SELECT id, name, created_at, updated_at
    FROM ${definition.table}
    WHERE user_id = $1
    ORDER BY normalized_name ASC, id ASC
    LIMIT $2 OFFSET $3
  `, [userId, perPage + 1, offset]);

  const hasMore = result.rows.length > perPage;
  return {
    results: result.rows.slice(0, perPage).map(publicResource),
    pagination: { page, perPage, hasMore }
  };
}

async function createResource(pool, resource, { userId, name } = {}) {
  const definition = definitionFor(resource);
  const displayName = validatedDisplayName(name);
  try {
    const result = await pool.query(`
      INSERT INTO ${definition.table} (user_id, name)
      VALUES ($1, $2)
      RETURNING id, name, created_at, updated_at
    `, [userId, displayName]);
    return publicResource(result.rows[0]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new LibraryConflictError(`The ${resource} name is already in use.`);
    }
    throw error;
  }
}

async function updateResource(pool, resource, { userId, id, name } = {}) {
  const definition = definitionFor(resource);
  const displayName = validatedDisplayName(name);
  try {
    const result = await pool.query(`
      UPDATE ${definition.table}
      SET name = $3
      WHERE user_id = $1 AND id = $2
      RETURNING id, name, created_at, updated_at
    `, [userId, id, displayName]);
    return result.rowCount === 0 ? null : publicResource(result.rows[0]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new LibraryConflictError(`The ${resource} name is already in use.`);
    }
    throw error;
  }
}

async function removeResource(pool, resource, { userId, id } = {}) {
  const definition = definitionFor(resource);
  const result = await pool.query(`
    DELETE FROM ${definition.table}
    WHERE user_id = $1 AND id = $2
    RETURNING id
  `, [userId, id]);
  return result.rowCount > 0;
}

async function hasOwnedMembershipResources(pool, resource, { userId, libraryItemId, resourceId } = {}) {
  const definition = definitionFor(resource);
  const result = await pool.query(`
    SELECT 1
    FROM library_items AS item
    JOIN ${definition.table} AS resource
      ON resource.user_id = item.user_id
     AND resource.id = $3
    WHERE item.user_id = $1 AND item.id = $2
  `, [userId, libraryItemId, resourceId]);
  return result.rowCount > 0;
}

async function attachMembership(pool, resource, { userId, libraryItemId, resourceId } = {}) {
  const definition = definitionFor(resource);
  if (!await hasOwnedMembershipResources(pool, resource, { userId, libraryItemId, resourceId })) return null;

  await pool.query(`
    INSERT INTO ${definition.membershipTable} (user_id, library_item_id, ${definition.membershipColumn})
    VALUES ($1, $2, $3)
    ON CONFLICT DO NOTHING
  `, [userId, libraryItemId, resourceId]);
  return true;
}

async function detachMembership(pool, resource, { userId, libraryItemId, resourceId } = {}) {
  const definition = definitionFor(resource);
  if (!await hasOwnedMembershipResources(pool, resource, { userId, libraryItemId, resourceId })) return null;

  await pool.query(`
    DELETE FROM ${definition.membershipTable}
    WHERE user_id = $1 AND library_item_id = $2 AND ${definition.membershipColumn} = $3
  `, [userId, libraryItemId, resourceId]);
  return true;
}

/**
 * Create the PostgreSQL-backed repository for private Tags, Collections, and
 * their ownership-scoped Library Item memberships.
 *
 * @param {{ pool: import('pg').Pool }} options
 */
export function createTagsCollectionsRepository({ pool } = {}) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A PostgreSQL pool is required for Tags and Collections.');
  }

  return {
    listTags: (options) => listResources(pool, 'tag', options),
    createTag: (options) => createResource(pool, 'tag', options),
    updateTag: (options) => updateResource(pool, 'tag', options),
    removeTag: (options) => removeResource(pool, 'tag', options),
    attachTag: (options) => attachMembership(pool, 'tag', options),
    detachTag: (options) => detachMembership(pool, 'tag', options),
    listCollections: (options) => listResources(pool, 'collection', options),
    createCollection: (options) => createResource(pool, 'collection', options),
    updateCollection: (options) => updateResource(pool, 'collection', options),
    removeCollection: (options) => removeResource(pool, 'collection', options),
    attachCollection: (options) => attachMembership(pool, 'collection', options),
    detachCollection: (options) => detachMembership(pool, 'collection', options)
  };
}
