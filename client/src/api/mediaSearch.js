import { requestJson } from './request.js';

const SEARCH_PAGE_LIMIT = 100;
const SEARCH_PER_PAGE_LIMIT = 24;
const SEARCH_TYPES = new Set(['anime', 'movie', 'tv', 'game', 'all']);
const SEARCH_PROVIDERS = new Set(['anilist', 'myanimelist', 'tmdb', 'thegamesdb', 'rawg']);
const FILTER_TYPES = new Set(['anime', 'movie', 'tv', 'game']);

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
  filters = null,
  signal
} = {}) {
  if (!SEARCH_TYPES.has(type)) throw new TypeError('type must be anime, movie, tv, game, or all.');

  const trimmedQuery = typeof query === 'string' ? query.trim() : '';
  const searchParams = new URLSearchParams({ type });
  if (trimmedQuery) searchParams.set('q', trimmedQuery);
  searchParams.set('page', String(Math.min(page, SEARCH_PAGE_LIMIT)));
  searchParams.set('perPage', String(Math.min(perPage, SEARCH_PER_PAGE_LIMIT)));
  searchParams.set('includeAdult', String(includeAdult));
  if (Array.isArray(filters?.genres) && filters.genres.length > 0) searchParams.set('genres', filters.genres.join('|'));
  if (filters?.creator) searchParams.set('creator', typeof filters.creator === 'string' ? filters.creator : filters.creator.id);
  if (filters?.minRating !== '' && filters?.minRating !== null && filters?.minRating !== undefined) searchParams.set('minRating', String(filters.minRating));
  if (filters?.minMetacritic !== '' && filters?.minMetacritic !== null && filters?.minMetacritic !== undefined) searchParams.set('minMetacritic', String(filters.minMetacritic));
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

function isValidFilterOption(option) {
  return Boolean(
    option && typeof option === 'object' && !Array.isArray(option) &&
    typeof option.id === 'string' && option.id.length > 0 &&
    typeof option.label === 'string' && option.label.length > 0
  );
}

export function isValidMediaFilterOptionsPayload(payload) {
  return Boolean(
    payload && typeof payload === 'object' && !Array.isArray(payload) &&
    FILTER_TYPES.has(payload.type) && SEARCH_PROVIDERS.has(payload.source) &&
    Array.isArray(payload.genres) && payload.genres.every(isValidFilterOption) &&
    Array.isArray(payload.creators) && payload.creators.every(isValidFilterOption) &&
    payload.rating && typeof payload.rating === 'object' &&
    typeof payload.rating.field === 'string' && typeof payload.rating.label === 'string' &&
    Number.isFinite(payload.rating.max) && Number.isFinite(payload.rating.step)
  );
}

export async function getMediaFilterOptions({ type, creatorQuery = '', includeAdult = true, signal } = {}) {
  if (!FILTER_TYPES.has(type)) throw new TypeError('type must be anime, movie, tv, or game.');
  const searchParams = new URLSearchParams({ type, includeAdult: String(includeAdult) });
  if (creatorQuery.trim()) searchParams.set('creatorQuery', creatorQuery.trim());
  const payload = await requestJson(`/api/media/filter-options?${searchParams.toString()}`, { signal });
  if (!isValidMediaFilterOptionsPayload(payload)) {
    const error = new Error('The API returned invalid media filter options.');
    error.code = 'INVALID_PAYLOAD';
    throw error;
  }
  return payload;
}
