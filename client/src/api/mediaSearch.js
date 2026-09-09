import { requestJson } from './request.js';

const SEARCH_PAGE_LIMIT = 100;
const SEARCH_PER_PAGE_LIMIT = 24;
const SEARCH_TYPES = new Set(['anime', 'movie', 'tv', 'game', 'all']);
const SEARCH_PROVIDERS = new Set(['anilist', 'myanimelist', 'tmdb', 'thegamesdb', 'rawg']);

function isValidProviderPagination(pagination) {
  return Boolean(
    pagination &&
    typeof pagination === 'object' &&
    Number.isInteger(pagination.page) &&
    Number.isInteger(pagination.perPage) &&
    typeof pagination.hasMore === 'boolean'
  );
}

function isValidCombinedPagination(pagination) {
  if (!pagination || typeof pagination !== 'object') return false;
  if (!Number.isInteger(pagination.page) || typeof pagination.hasMore !== 'boolean') return false;
  if (pagination.continuation !== null && (typeof pagination.continuation !== 'string' || pagination.continuation.length === 0)) return false;
  if (!pagination.providers || typeof pagination.providers !== 'object' || Array.isArray(pagination.providers)) return false;

  return Object.entries(pagination.providers).every(([provider, providerPagination]) => (
    SEARCH_PROVIDERS.has(provider) && isValidProviderPagination(providerPagination)
  ));
}

export function isValidMediaSearchPayload(payload) {
  return Boolean(
    payload &&
    typeof payload === 'object' &&
    Array.isArray(payload.results) &&
    payload.pagination &&
    (payload.source === 'combined'
      ? isValidCombinedPagination(payload.pagination)
      : isValidProviderPagination(payload.pagination) && SEARCH_PROVIDERS.has(payload.source)) &&
    Array.isArray(payload.providerErrors)
  );
}

export async function searchMedia({
  type = 'anime',
  query,
  page = 1,
  perPage = 12,
  includeAdult = true,
  provider,
  cursor,
  retryProvider,
  signal
} = {}) {
  if (!SEARCH_TYPES.has(type)) throw new TypeError('type must be anime, movie, tv, game, or all.');

  const searchParams = new URLSearchParams({
    type,
    q: query.trim(),
    page: String(Math.min(page, SEARCH_PAGE_LIMIT)),
    perPage: String(Math.min(perPage, SEARCH_PER_PAGE_LIMIT)),
    includeAdult: String(includeAdult)
  });
  if (provider) searchParams.set('provider', provider);
  if (cursor) searchParams.set('cursor', cursor);
  if (retryProvider) searchParams.set('retryProvider', retryProvider);
  const payload = await requestJson(`/api/media/search?${searchParams.toString()}`, { signal });
  if (!isValidMediaSearchPayload(payload)) {
    const error = new Error('The API returned an invalid media search payload.');
    error.code = 'INVALID_PAYLOAD';
    throw error;
  }
  return payload;
}
