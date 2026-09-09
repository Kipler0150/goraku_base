import { requestJson } from './request.js';

const SEARCH_PAGE_LIMIT = 100;
const SEARCH_PER_PAGE_LIMIT = 24;
const SEARCH_TYPES = new Set(['anime', 'movie', 'tv', 'game']);
const SEARCH_PROVIDERS = new Set(['anilist', 'myanimelist', 'tmdb', 'rawg']);

export function isValidMediaSearchPayload(payload) {
  return Boolean(
    payload &&
    typeof payload === 'object' &&
    Array.isArray(payload.results) &&
    payload.pagination &&
    Number.isInteger(payload.pagination.page) &&
    Number.isInteger(payload.pagination.perPage) &&
    typeof payload.pagination.hasMore === 'boolean' &&
    SEARCH_PROVIDERS.has(payload.source) &&
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
  signal
} = {}) {
  if (!SEARCH_TYPES.has(type)) throw new TypeError('type must be anime, movie, tv, or game.');

  const searchParams = new URLSearchParams({
    type,
    q: query.trim(),
    page: String(Math.min(page, SEARCH_PAGE_LIMIT)),
    perPage: String(Math.min(perPage, SEARCH_PER_PAGE_LIMIT)),
    includeAdult: String(includeAdult)
  });
  if (provider) searchParams.set('provider', provider);
  const payload = await requestJson(`/api/media/search?${searchParams.toString()}`, { signal });
  if (!isValidMediaSearchPayload(payload)) {
    const error = new Error('The API returned an invalid media search payload.');
    error.code = 'INVALID_PAYLOAD';
    throw error;
  }
  return payload;
}
