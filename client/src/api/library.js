import { requestJson } from './request.js';

export const LIBRARY_STATUS_VALUES = Object.freeze([
  'PLANNING',
  'IN_PROGRESS',
  'COMPLETED',
  'ON_HOLD',
  'DROPPED'
]);

const LIBRARY_ITEM_TYPES = new Set(['ANIME', 'MOVIE', 'TV', 'GAME']);

function isValidPersonalRating(value) {
  return value === null || (
    typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= 10
    && Number.isInteger(value * 2)
  );
}

function hasAtMostTwoDecimalPlaces(value) {
  const [coefficient, exponentText] = String(value).toLowerCase().split('e');
  const fractionalDigits = coefficient.includes('.') ? coefficient.split('.')[1].length : 0;
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  return Number.isInteger(exponent) && Math.max(0, fractionalDigits - exponent) <= 2;
}

function isValidProgress(type, value) {
  if (value === null) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const keys = Object.keys(value);
  if (type === 'ANIME') {
    return keys.length === 1
      && keys[0] === 'episodesWatched'
      && Number.isInteger(value.episodesWatched)
      && value.episodesWatched >= 0;
  }
  if (type === 'TV') {
    return keys.length === 2
      && keys.includes('season')
      && keys.includes('episode')
      && Number.isInteger(value.season)
      && value.season >= 0
      && Number.isInteger(value.episode)
      && value.episode >= 1;
  }
  if (type === 'MOVIE') {
    return keys.length === 1 && keys[0] === 'watched' && typeof value.watched === 'boolean';
  }
  return keys.length === 1
    && keys[0] === 'hoursPlayed'
    && typeof value.hoursPlayed === 'number'
    && Number.isFinite(value.hoursPlayed)
    && value.hoursPlayed >= 0
    && hasAtMostTwoDecimalPlaces(value.hoursPlayed);
}

function isValidRelationshipSummary(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
  );
}

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
    isValidPersonalRating(item.personalRating) &&
    (item.note === null || typeof item.note === 'string') &&
    LIBRARY_ITEM_TYPES.has(item.type) &&
    isValidProgress(item.type, item.progress) &&
    Array.isArray(item.tags) &&
    item.tags.every(isValidRelationshipSummary) &&
    Array.isArray(item.collections) &&
    item.collections.every(isValidRelationshipSummary) &&
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

export async function listLibrary({
  page = 1,
  perPage = 20,
  libraryStatus,
  favorite,
  tagId,
  collectionId,
  signal
} = {}) {
  const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
  for (const [field, value] of Object.entries({ libraryStatus, favorite, tagId, collectionId })) {
    if (value !== undefined && value !== null) {
      const queryValue = field === 'libraryStatus' && typeof value === 'string'
        ? value.toLowerCase()
        : String(value);
      params.set(field, queryValue);
    }
  }
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
