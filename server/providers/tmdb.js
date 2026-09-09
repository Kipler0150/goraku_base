import { createMedia } from '../../shared/media.js';
import { ProviderError, PROVIDER_ERROR_CODES } from './errors.js';

export const TMDB_ENDPOINT = 'https://api.themoviedb.org/3/search';
export const TMDB_TIMEOUT_MS = 5_000;
export const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p';
export const TMDB_PAGE_SIZE = 20;

const POSTER_SIZE = 'w500';
const BACKDROP_SIZE = 'w1280';
const SEARCH_TYPES = new Set(['movie', 'tv']);
const MOVIE_GENRES = Object.freeze({
  12: 'Adventure',
  14: 'Fantasy',
  16: 'Animation',
  18: 'Drama',
  27: 'Horror',
  28: 'Action',
  35: 'Comedy',
  36: 'History',
  37: 'Western',
  53: 'Thriller',
  80: 'Crime',
  99: 'Documentary',
  10751: 'Family',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Science Fiction',
  10770: 'TV Movie',
  10752: 'War'
});

const TV_GENRES = Object.freeze({
  16: 'Animation',
  18: 'Drama',
  35: 'Comedy',
  37: 'Western',
  80: 'Crime',
  99: 'Documentary',
  10751: 'Family',
  10759: 'Action & Adventure',
  10762: 'Kids',
  10763: 'News',
  10764: 'Reality',
  10765: 'Sci-Fi & Fantasy',
  10766: 'Soap',
  10767: 'Talk',
  10768: 'War & Politics',
  9648: 'Mystery'
});

const ERROR_MESSAGES = Object.freeze({
  [PROVIDER_ERROR_CODES.TIMEOUT]: 'TMDB did not respond within the allowed time.',
  [PROVIDER_ERROR_CODES.RATE_LIMITED]: 'TMDB rate limit reached.',
  [PROVIDER_ERROR_CODES.INVALID_RESPONSE]: 'TMDB returned an invalid response.',
  [PROVIDER_ERROR_CODES.UNAVAILABLE]: 'TMDB is currently unavailable.',
  [PROVIDER_ERROR_CODES.ERROR]: 'TMDB request failed.'
});

function providerError(code) {
  return new ProviderError(code, ERROR_MESSAGES[code]);
}

function invalidResponse() {
  return providerError(PROVIDER_ERROR_CODES.INVALID_RESPONSE);
}

function assertObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidResponse();
  return value;
}

function nullableString(value) {
  if (value == null) return null;
  if (typeof value !== 'string') throw invalidResponse();
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeProviderId(value) {
  if (Number.isInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value.trim())) return value.trim();
  throw invalidResponse();
}

function normalizeDate(value) {
  const date = nullableString(value);
  if (date == null) return null;
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(date);
  if (!match) throw invalidResponse();
  return {
    year: Number(match[1]),
    month: match[2] ? Number(match[2]) : null,
    day: match[3] ? Number(match[3]) : null
  };
}

function normalizeAdult(value) {
  if (value == null) return null;
  if (typeof value !== 'boolean') throw invalidResponse();
  return value;
}

function normalizeRating(value) {
  if (value == null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 10) throw invalidResponse();
  return { value, max: 10 };
}

function normalizeGenres(value, type) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((genre) => !Number.isInteger(genre))) throw invalidResponse();
  const genreMap = type === 'MOVIE' ? MOVIE_GENRES : TV_GENRES;
  return value.map((genre) => genreMap[genre]).filter(Boolean);
}

function imageUrl(baseUrl, size, value) {
  const path = nullableString(value);
  if (path == null) return null;
  return `${baseUrl}/${size}/${path.replace(/^\/+/, '')}`;
}

function normalizeResult(value, type, imageBaseUrl) {
  const item = assertObject(value);
  const mediaType = type === 'movie' ? 'MOVIE' : 'TV';
  const title = nullableString(item[type === 'movie' ? 'title' : 'name']);
  const originalTitle = nullableString(item[type === 'movie' ? 'original_title' : 'original_name']);
  const date = type === 'movie' ? item.release_date : item.first_air_date;

  try {
    return createMedia({
      provider: 'tmdb',
      providerId: normalizeProviderId(item.id),
      type: mediaType,
      title,
      originalTitle,
      alternativeTitles: [],
      description: nullableString(item.overview),
      image: imageUrl(imageBaseUrl, POSTER_SIZE, item.poster_path),
      bannerImage: imageUrl(imageBaseUrl, BACKDROP_SIZE, item.backdrop_path),
      releaseDate: normalizeDate(date),
      genres: normalizeGenres(item.genre_ids, mediaType),
      providerRating: normalizeRating(item.vote_average),
      releaseStatus: 'UNKNOWN',
      creators: [],
      isAdult: normalizeAdult(item.adult),
      metadata: mediaType === 'MOVIE'
        ? { runtimeMinutes: null }
        : { seasonCount: null, episodeCount: null }
    });
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw invalidResponse();
  }
}

function normalizePayload(payload, type, imageBaseUrl, includeAdult) {
  const root = assertObject(payload);
  if (!Number.isInteger(root.page) || root.page < 1) throw invalidResponse();
  if (!Number.isInteger(root.total_pages) || root.total_pages < 0) throw invalidResponse();
  if (!Array.isArray(root.results)) throw invalidResponse();

  const results = root.results
    .map((item) => normalizeResult(item, type, imageBaseUrl))
    .filter((media) => includeAdult || media.isAdult !== true);

  return {
    results,
    pagination: {
      page: root.page,
      perPage: TMDB_PAGE_SIZE,
      hasMore: root.page < root.total_pages
    }
  };
}

function errorForStatus(status) {
  if (status === 401 || status === 403) return providerError(PROVIDER_ERROR_CODES.UNAVAILABLE);
  if (status === 429) return providerError(PROVIDER_ERROR_CODES.RATE_LIMITED);
  if (status === 408 || status === 504) return providerError(PROVIDER_ERROR_CODES.TIMEOUT);
  return providerError(PROVIDER_ERROR_CODES.ERROR);
}

function validateSearchOptions({ type, query, page, perPage, includeAdult }) {
  if (!SEARCH_TYPES.has(type) || typeof query !== 'string' || !query.trim()) throw invalidResponse();
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(perPage) || perPage < 1) throw invalidResponse();
  if (typeof includeAdult !== 'boolean') throw invalidResponse();
}

/**
 * Create the server-side TMDB search boundary.
 *
 * @param {{accessToken?: string, request?: Function, endpoint?: string, imageBaseUrl?: string, timeoutMs?: number}} options
 */
export function createTMDBAdapter({
  accessToken = process.env.TMDB_ACCESS_TOKEN,
  request = globalThis.fetch,
  endpoint = TMDB_ENDPOINT,
  imageBaseUrl = process.env.TMDB_IMAGE_BASE_URL ?? TMDB_IMAGE_BASE_URL,
  timeoutMs = TMDB_TIMEOUT_MS
} = {}) {
  if (typeof request !== 'function') throw new TypeError('An HTTP request function is required.');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('timeoutMs must be positive.');
  const normalizedToken = typeof accessToken === 'string' ? accessToken.trim() : '';
  const normalizedImageBaseUrl = (typeof imageBaseUrl === 'string' && imageBaseUrl.trim()
    ? imageBaseUrl.trim()
    : TMDB_IMAGE_BASE_URL).replace(/\/+$/, '');

  return {
    enabled: Boolean(normalizedToken),
    async searchMedia(options = {}) {
      const { type = 'movie', query, page = 1, perPage = 12, includeAdult = true } = options;
      validateSearchOptions({ type, query, page, perPage, includeAdult });
      if (!normalizedToken) throw providerError(PROVIDER_ERROR_CODES.UNAVAILABLE);

      const url = new URL(`${endpoint.replace(/\/+$/, '')}/${type}`);
      url.searchParams.set('query', query);
      url.searchParams.set('page', String(page));
      url.searchParams.set('include_adult', String(includeAdult));
      url.searchParams.set('language', 'en-US');

      const controller = new AbortController();
      let timedOut = false;
      let timeoutHandle;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(providerError(PROVIDER_ERROR_CODES.TIMEOUT));
        }, timeoutMs);
      });

      try {
        const requestResult = await Promise.race([
          Promise.resolve().then(() => request(url, {
            method: 'GET',
            headers: {
              accept: 'application/json',
              Authorization: `Bearer ${normalizedToken}`
            },
            signal: controller.signal
          })),
          timeoutPromise
        ]);

        if (!requestResult || typeof requestResult !== 'object') throw invalidResponse();
        if ((requestResult.status !== undefined && (requestResult.status < 200 || requestResult.status >= 300)) || requestResult.ok === false) {
          throw errorForStatus(requestResult.status);
        }
        if (typeof requestResult.json !== 'function') throw invalidResponse();

        let payload;
        try {
          payload = await requestResult.json();
        } catch {
          throw invalidResponse();
        }
        return normalizePayload(payload, type, normalizedImageBaseUrl, includeAdult);
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        if (timedOut || error?.name === 'AbortError') throw providerError(PROVIDER_ERROR_CODES.TIMEOUT);
        throw providerError(PROVIDER_ERROR_CODES.ERROR);
      } finally {
        clearTimeout(timeoutHandle);
      }
    }
  };
}
