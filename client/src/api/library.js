import { requestJson } from './request.js';

export const LIBRARY_STATUS_VALUES = Object.freeze([
  'PLANNING',
  'IN_PROGRESS',
  'COMPLETED',
  'ON_HOLD',
  'DROPPED'
]);

function invalidLibraryPayload() {
  const error = new Error('The API returned an invalid Library payload.');
  error.code = 'INVALID_PAYLOAD';
  return error;
}

export function isValidLibraryItem(item) {
  return Boolean(
    item &&
    typeof item === 'object' &&
    typeof item.id === 'string' &&
    typeof item.provider === 'string' &&
    typeof item.type === 'string' &&
    typeof item.providerId === 'string' &&
    LIBRARY_STATUS_VALUES.includes(item.libraryStatus) &&
    typeof item.favorite === 'boolean' &&
    typeof item.createdAt === 'string' &&
    typeof item.updatedAt === 'string'
  );
}

export function isValidLibraryPayload(payload) {
  return Boolean(
    payload &&
    typeof payload === 'object' &&
    Array.isArray(payload.results) &&
    payload.results.every(isValidLibraryItem) &&
    payload.pagination &&
    Number.isInteger(payload.pagination.page) &&
    Number.isInteger(payload.pagination.perPage) &&
    typeof payload.pagination.hasMore === 'boolean'
  );
}

function validateItemPayload(payload) {
  if (!isValidLibraryItem(payload)) throw invalidLibraryPayload();
  return payload;
}

export async function listLibrary({ page = 1, perPage = 20, signal } = {}) {
  const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
  const payload = await requestJson(`/api/library?${params.toString()}`, { signal });
  if (!isValidLibraryPayload(payload)) throw invalidLibraryPayload();
  return payload;
}

export function createLibraryItem(media, { signal } = {}) {
  const type = typeof media?.type === 'string' ? media.type.toLowerCase() : media?.type;
  return requestJson('/api/library', {
    method: 'POST',
    body: JSON.stringify({
      provider: media?.provider,
      type,
      providerId: media?.providerId
    }),
    signal
  }).then(validateItemPayload);
}

export function updateLibraryItem(id, changes, { signal } = {}) {
  return requestJson(`/api/library/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
    signal
  }).then(validateItemPayload);
}

export function removeLibraryItem(id, { signal } = {}) {
  return requestJson(`/api/library/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    allowEmpty: true,
    signal
  });
}
