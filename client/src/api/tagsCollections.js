import { requestJson } from './request.js';

const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 50;

function invalidResourcePayload() {
  const error = new Error('The API returned an invalid Tag or Collection payload.');
  error.code = 'INVALID_PAYLOAD';
  return error;
}

function isValidResource(resource) {
  return Boolean(
    resource
    && typeof resource === 'object'
    && typeof resource.id === 'string'
    && resource.id.length > 0
    && typeof resource.name === 'string'
    && [...resource.name].length > 0
    && [...resource.name].length <= 50
    && typeof resource.createdAt === 'string'
    && typeof resource.updatedAt === 'string'
  );
}

export function isValidResourcePayload(payload) {
  return Boolean(
    payload
    && typeof payload === 'object'
    && Array.isArray(payload.results)
    && payload.results.every(isValidResource)
    && payload.pagination
    && Number.isInteger(payload.pagination.page)
    && Number.isInteger(payload.pagination.perPage)
    && typeof payload.pagination.hasMore === 'boolean'
  );
}

function validateResourcePayload(payload) {
  if (!isValidResource(payload)) throw invalidResourcePayload();
  return payload;
}

function validateResourceListPayload(payload) {
  if (!isValidResourcePayload(payload)) throw invalidResourcePayload();
  return payload;
}

function listResources(path, { page = DEFAULT_PAGE, perPage = DEFAULT_PER_PAGE, signal } = {}) {
  const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
  return requestJson(`/api/${path}?${params.toString()}`, { signal }).then(validateResourceListPayload);
}

function createResource(path, name, { signal } = {}) {
  return requestJson(`/api/${path}`, {
    method: 'POST',
    body: JSON.stringify({ name }),
    signal
  }).then(validateResourcePayload);
}

function updateResource(path, id, name, { signal } = {}) {
  return requestJson(`/api/${path}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
    signal
  }).then(validateResourcePayload);
}

function removeResource(path, id, { signal } = {}) {
  return requestJson(`/api/${path}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    allowEmpty: true,
    signal
  });
}

function updateMembership(path, libraryItemId, resourceId, method, { signal } = {}) {
  return requestJson(
    `/api/library/${encodeURIComponent(libraryItemId)}/${path}/${encodeURIComponent(resourceId)}`,
    { method, allowEmpty: true, signal }
  );
}

export function listTags(options) {
  return listResources('tags', options);
}

export function createTag(name, options) {
  return createResource('tags', name, options);
}

export function updateTag(id, name, options) {
  return updateResource('tags', id, name, options);
}

export function removeTag(id, options) {
  return removeResource('tags', id, options);
}

export function attachTag(libraryItemId, tagId, options) {
  return updateMembership('tags', libraryItemId, tagId, 'PUT', options);
}

export function detachTag(libraryItemId, tagId, options) {
  return updateMembership('tags', libraryItemId, tagId, 'DELETE', options);
}

export function listCollections(options) {
  return listResources('collections', options);
}

export function createCollection(name, options) {
  return createResource('collections', name, options);
}

export function updateCollection(id, name, options) {
  return updateResource('collections', id, name, options);
}

export function removeCollection(id, options) {
  return removeResource('collections', id, options);
}

export function attachCollection(libraryItemId, collectionId, options) {
  return updateMembership('collections', libraryItemId, collectionId, 'PUT', options);
}

export function detachCollection(libraryItemId, collectionId, options) {
  return updateMembership('collections', libraryItemId, collectionId, 'DELETE', options);
}
