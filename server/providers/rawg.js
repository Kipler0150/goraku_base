import { createMedia } from '../../shared/media.js';
import { ProviderError, PROVIDER_ERROR_CODES } from './errors.js';
import { requestProviderJson } from './http.js';

export const RAWG_ENDPOINT = 'https://api.rawg.io/api/games';
export const RAWG_DETAILS_ENDPOINT = RAWG_ENDPOINT;
export const RAWG_TIMEOUT_MS = 5_000;
export const RAWG_PAGE_SIZE = 20;
export const RAWG_LATEST_LOOKBACK_DAYS = 365;

const ERROR_MESSAGES = Object.freeze({
  [PROVIDER_ERROR_CODES.TIMEOUT]: 'RAWG did not respond within the allowed time.',
  [PROVIDER_ERROR_CODES.RATE_LIMITED]: 'RAWG rate limit reached.',
  [PROVIDER_ERROR_CODES.INVALID_RESPONSE]: 'RAWG returned an invalid response.',
  [PROVIDER_ERROR_CODES.UNAVAILABLE]: 'RAWG is currently unavailable.',
  [PROVIDER_ERROR_CODES.NOT_FOUND]: 'RAWG media was not found.',
  [PROVIDER_ERROR_CODES.ERROR]: 'RAWG request failed.'
});

const TRANSLATED_DESCRIPTION_MARKER = /(?:^|\n)\s*(?:Español|Spanish|Deutsch|German|Français|French|Italiano|Italian|Português|Portuguese|Nederlands|Dutch|Polski|Polish|Русский|Russian|日本語|中文|한국어|Korean)\b/i;

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

function normalizeDescription(value) {
  const description = nullableString(value);
  if (description == null) return null;

  const normalized = description
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<(?:p|div|li|h[1-6]|blockquote)(?:\s[^>]*)?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim() || null;

  if (normalized == null) return null;
  const translatedSection = TRANSLATED_DESCRIPTION_MARKER.exec(normalized);
  return (translatedSection ? normalized.slice(0, translatedSection.index) : normalized).trim() || null;
}

function normalizeProviderId(value) {
  if (!Number.isInteger(value) || value < 1) throw invalidResponse();
  return String(value);
}

function normalizeRating(value) {
  if (value == null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 5) throw invalidResponse();
  return { value, max: 5 };
}

function normalizeNamedValues(value, nestedField = null) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw invalidResponse();

  return value.map((entry) => {
    const item = assertObject(entry);
    const namedValue = nestedField ? item[nestedField] : item;
    if (namedValue == null) return null;
    return nullableString(assertObject(namedValue).name);
  }).filter(Boolean);
}

function normalizeAdultClassification(value) {
  if (value == null) return null;
  const classification = assertObject(value);
  const name = nullableString(classification.name)?.toLowerCase();
  const slug = nullableString(classification.slug)?.toLowerCase();
  if (name === 'adults only' || slug === 'adults-only') return true;
  return false;
}

function normalizeReleaseStatus(value) {
  if (value == null) return 'UNKNOWN';
  if (typeof value !== 'boolean') throw invalidResponse();
  return value ? 'ANNOUNCED' : 'UNKNOWN';
}

function formatUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

function latestReleaseDateRange(now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - RAWG_LATEST_LOOKBACK_DAYS);
  return `${formatUtcDate(start)},${formatUtcDate(end)}`;
}

function normalizeResult(value) {
  const item = assertObject(value);
  const description = Object.hasOwn(item, 'description_raw') && item.description_raw != null
    ? item.description_raw
    : item.description;

  try {
    return createMedia({
      provider: 'rawg',
      providerId: normalizeProviderId(item.id),
      type: 'GAME',
      title: nullableString(item.name),
      originalTitle: null,
      alternativeTitles: [],
      description: normalizeDescription(description),
      image: nullableString(item.background_image),
      bannerImage: null,
      releaseDate: normalizeDate(item.released),
      genres: normalizeNamedValues(item.genres),
      providerRating: normalizeRating(item.rating),
      releaseStatus: normalizeReleaseStatus(item.tba),
      creators: [],
      isAdult: normalizeAdultClassification(item.esrb_rating),
      metadata: {
        platforms: normalizeNamedValues(item.platforms, 'platform'),
        developers: normalizeNamedValues(item.developers),
        publishers: normalizeNamedValues(item.publishers)
      }
    });
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw invalidResponse();
  }
}

function normalizePayload(payload, page, perPage, includeAdult) {
  const root = assertObject(payload);
  if (!Array.isArray(root.results)) throw invalidResponse();
  if (!Object.hasOwn(root, 'next') || (root.next !== null && typeof root.next !== 'string')) {
    throw invalidResponse();
  }

  return {
    results: root.results
      .map(normalizeResult)
      .filter((media) => includeAdult || media.isAdult !== true),
    pagination: {
      page,
      perPage,
      hasMore: root.next !== null
    }
  };
}

function hasFilters(filters) {
  return Boolean(filters && (
    (Array.isArray(filters.genres) && filters.genres.length > 0) ||
    filters.creator ||
    Number.isFinite(filters.minMetacritic)
  ));
}

function normalizeFilterOptions(payload, field = 'results') {
  const root = assertObject(payload);
  if (!Array.isArray(root[field])) throw invalidResponse();
  return root[field].map((entry) => {
    const item = assertObject(entry);
    const id = normalizeProviderId(item.id);
    const label = nullableString(item.name);
    if (!label) throw invalidResponse();
    return { id, label };
  });
}

function errorForStatus(status, details = false) {
  if (details && status === 404) return providerError(PROVIDER_ERROR_CODES.NOT_FOUND);
  if (status === 401 || status === 403 || status === 503) return providerError(PROVIDER_ERROR_CODES.UNAVAILABLE);
  if (status === 429) return providerError(PROVIDER_ERROR_CODES.RATE_LIMITED);
  if (status === 408 || status === 504) return providerError(PROVIDER_ERROR_CODES.TIMEOUT);
  return providerError(PROVIDER_ERROR_CODES.ERROR);
}

function validateSearchOptions({ type, query, page, perPage, includeAdult, filters }) {
  if (type !== 'game' || typeof query !== 'string' || (!query.trim() && !hasFilters(filters))) throw invalidResponse();
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(perPage) || perPage < 1) throw invalidResponse();
  if (typeof includeAdult !== 'boolean') throw invalidResponse();
}

/**
 * Create the server-side RAWG game search boundary.
 *
 * @param {{apiKey?: string, request?: Function, endpoint?: string, detailsEndpoint?: string, timeoutMs?: number}} options
 */
export function createRAWGAdapter({
  apiKey = process.env.RAWG_API_KEY,
  request = globalThis.fetch,
  endpoint = RAWG_ENDPOINT,
  detailsEndpoint = RAWG_DETAILS_ENDPOINT,
  timeoutMs = RAWG_TIMEOUT_MS
} = {}) {
  if (typeof request !== 'function') throw new TypeError('An HTTP request function is required.');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('timeoutMs must be positive.');
  const normalizedKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  const normalizedDetailsEndpoint = (typeof detailsEndpoint === 'string' && detailsEndpoint.trim()
    ? detailsEndpoint.trim()
    : RAWG_DETAILS_ENDPOINT).replace(/\/+$/, '');

  const validateDiscoveryOptions = ({ page = 1, perPage = RAWG_PAGE_SIZE, includeAdult = true } = {}) => {
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(perPage) || perPage < 1 || typeof includeAdult !== 'boolean') {
      throw invalidResponse();
    }
    return { page, perPage, includeAdult };
  };

  return {
    enabled: Boolean(normalizedKey),
    async searchMedia(options = {}) {
      const {
        type = 'game',
        query = '',
        page = 1,
        perPage = RAWG_PAGE_SIZE,
        includeAdult = true,
        filters = null
      } = options;
      validateSearchOptions({ type, query, page, perPage, includeAdult, filters });
      if (!normalizedKey) throw providerError(PROVIDER_ERROR_CODES.UNAVAILABLE);

      const url = new URL(endpoint);
      url.searchParams.set('key', normalizedKey);
      if (query.trim()) url.searchParams.set('search', query.trim());
      if (!query.trim() && hasFilters(filters)) url.searchParams.set('ordering', '-released');
      url.searchParams.set('page', String(page));
      url.searchParams.set('page_size', String(perPage));
      if (filters?.genres?.length) url.searchParams.set('genres', filters.genres.join(','));
      if (filters?.creator) url.searchParams.set('creators', filters.creator);
      if (Number.isFinite(filters?.minMetacritic)) url.searchParams.set('metacritic', `${filters.minMetacritic},100`);

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
            headers: { accept: 'application/json' },
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
        return normalizePayload(payload, page, perPage, includeAdult);
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        if (timedOut || error?.name === 'AbortError') throw providerError(PROVIDER_ERROR_CODES.TIMEOUT);
        throw providerError(PROVIDER_ERROR_CODES.ERROR);
      } finally {
        clearTimeout(timeoutHandle);
      }
    },
    async getFilterOptions({ type = 'game', creatorQuery = '', includeAdult = true } = {}) {
      if (type !== 'game' || typeof creatorQuery !== 'string' || typeof includeAdult !== 'boolean') throw invalidResponse();
      if (!normalizedKey) throw providerError(PROVIDER_ERROR_CODES.UNAVAILABLE);
      const apiRoot = normalizedDetailsEndpoint.replace(/\/games\/?$/, '');
      const headers = { accept: 'application/json' };
      const genresUrl = new URL(`${apiRoot}/genres`);
      genresUrl.searchParams.set('key', normalizedKey);
      const creatorsUrl = new URL(`${apiRoot}/creators`);
      creatorsUrl.searchParams.set('key', normalizedKey);
      creatorsUrl.searchParams.set('page', '1');
      creatorsUrl.searchParams.set('page_size', '10');
      if (creatorQuery.trim()) creatorsUrl.searchParams.set('search', creatorQuery.trim());
      const [genres, creators] = await Promise.all([
        requestProviderJson({
          request,
          url: genresUrl,
          timeoutMs,
          options: { method: 'GET', headers },
          invalidResponse,
          errorForStatus: (status) => errorForStatus(status)
        }),
        requestProviderJson({
          request,
          url: creatorsUrl,
          timeoutMs,
          options: { method: 'GET', headers },
          invalidResponse,
          errorForStatus: (status) => errorForStatus(status)
        })
      ]);
      return {
        genres: normalizeFilterOptions(genres),
        creators: normalizeFilterOptions(creators),
        rating: { field: 'minMetacritic', label: 'Minimum Metacritic', max: 100, step: 1 }
      };
    },
    async getPopular({ page = 1, perPage = RAWG_PAGE_SIZE, includeAdult = true } = {}) {
      const options = validateDiscoveryOptions({ page, perPage, includeAdult });
      if (!normalizedKey) throw providerError(PROVIDER_ERROR_CODES.UNAVAILABLE);
      const url = new URL(endpoint);
      url.searchParams.set('key', normalizedKey);
      url.searchParams.set('ordering', '-added');
      url.searchParams.set('page', String(page));
      url.searchParams.set('page_size', String(perPage));
      const payload = await requestProviderJson({
        request,
        url,
        timeoutMs,
        options: { method: 'GET', headers: { accept: 'application/json' } },
        invalidResponse,
        errorForStatus: (status) => errorForStatus(status)
      });
      return normalizePayload(payload, page, perPage, options.includeAdult);
    },
    async getLatest({ page = 1, perPage = RAWG_PAGE_SIZE, includeAdult = true } = {}) {
      const options = validateDiscoveryOptions({ page, perPage, includeAdult });
      if (!normalizedKey) throw providerError(PROVIDER_ERROR_CODES.UNAVAILABLE);
      const url = new URL(endpoint);
      url.searchParams.set('key', normalizedKey);
      url.searchParams.set('ordering', '-released');
      url.searchParams.set('dates', latestReleaseDateRange());
      url.searchParams.set('page', String(page));
      url.searchParams.set('page_size', String(perPage));
      const payload = await requestProviderJson({
        request,
        url,
        timeoutMs,
        options: { method: 'GET', headers: { accept: 'application/json' } },
        invalidResponse,
        errorForStatus: (status) => errorForStatus(status)
      });
      return normalizePayload(payload, page, perPage, options.includeAdult);
    },
    async getRecommendations({ providerId, page = 1, perPage = RAWG_PAGE_SIZE, includeAdult = true } = {}) {
      const options = validateDiscoveryOptions({ page, perPage, includeAdult });
      if (typeof providerId !== 'string' || !/^[1-9]\d*$/.test(providerId.trim())) throw invalidResponse();
      if (!normalizedKey) throw providerError(PROVIDER_ERROR_CODES.UNAVAILABLE);
      const url = new URL(`${normalizedDetailsEndpoint}/${providerId.trim()}/suggested`);
      url.searchParams.set('key', normalizedKey);
      url.searchParams.set('page', String(page));
      url.searchParams.set('page_size', String(perPage));
      const payload = await requestProviderJson({
        request,
        url,
        timeoutMs,
        options: { method: 'GET', headers: { accept: 'application/json' } },
        invalidResponse,
        errorForStatus: (status) => errorForStatus(status, true)
      });
      return normalizePayload(payload, page, perPage, options.includeAdult);
    },
    getPopularMedia(options) {
      return this.getPopular(options);
    },
    getLatestMedia(options) {
      return this.getLatest(options);
    },
    getMediaRecommendations(options) {
      return this.getRecommendations(options);
    },
    async getMediaDetails({ providerId, includeAdult = true } = {}) {
      if (typeof providerId !== 'string' || !/^[1-9]\d*$/.test(providerId.trim())) {
        throw invalidResponse();
      }
      if (!normalizedKey) throw providerError(PROVIDER_ERROR_CODES.UNAVAILABLE);

      const url = new URL(`${normalizedDetailsEndpoint}/${providerId.trim()}`);
      url.searchParams.set('key', normalizedKey);

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
            headers: { accept: 'application/json' },
            signal: controller.signal
          })),
          timeoutPromise
        ]);
        if (!requestResult || typeof requestResult !== 'object') throw invalidResponse();
        if ((requestResult.status !== undefined && (requestResult.status < 200 || requestResult.status >= 300)) || requestResult.ok === false) {
          throw errorForStatus(requestResult.status, true);
        }
        if (typeof requestResult.json !== 'function') throw invalidResponse();

        let payload;
        try {
          payload = await requestResult.json();
        } catch {
          throw invalidResponse();
        }
        const media = normalizeResult(payload);
        if (!includeAdult && media.isAdult === true) {
          throw providerError(PROVIDER_ERROR_CODES.NOT_FOUND);
        }
        return media;
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
