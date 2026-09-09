import { createMedia } from '../../shared/media.js';
import { ProviderError, PROVIDER_ERROR_CODES } from './errors.js';

export const THEGAMESDB_ENDPOINT = 'https://api.thegamesdb.net/v1.1/Games/ByGameName';
export const THEGAMESDB_TIMEOUT_MS = 5_000;
export const THEGAMESDB_PAGE_SIZE = 20;

const ERROR_MESSAGES = Object.freeze({
  [PROVIDER_ERROR_CODES.TIMEOUT]: 'TheGamesDB did not respond within the allowed time.',
  [PROVIDER_ERROR_CODES.RATE_LIMITED]: 'TheGamesDB rate limit reached.',
  [PROVIDER_ERROR_CODES.INVALID_RESPONSE]: 'TheGamesDB returned an invalid response.',
  [PROVIDER_ERROR_CODES.UNAVAILABLE]: 'TheGamesDB is currently unavailable.',
  [PROVIDER_ERROR_CODES.ERROR]: 'TheGamesDB request failed.'
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
  return description
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim() || null;
}

function normalizeProviderId(value) {
  if (!Number.isInteger(value) || value < 1) throw invalidResponse();
  return String(value);
}

function normalizeNamedValues(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw invalidResponse();
  return value.map((entry) => {
    if (Number.isInteger(entry) && entry >= 0) return String(entry);
    if (typeof entry === 'string') return entry.trim();
    if (entry && typeof entry === 'object' && typeof entry.name === 'string') return entry.name.trim();
    throw invalidResponse();
  }).filter(Boolean);
}

function normalizePlatform(game, platformData) {
  if (!Number.isInteger(game.platform) || game.platform < 0) return [];
  const platform = platformData?.[String(game.platform)];
  if (!platform || typeof platform !== 'object' || typeof platform.name !== 'string') return [String(game.platform)];
  return [platform.name.trim()].filter(Boolean);
}

function normalizeImage(gameId, include) {
  const boxart = include?.boxart;
  const images = boxart?.data?.[String(gameId)];
  if (!Array.isArray(images)) return { image: null, bannerImage: null };

  const front = images.find((image) => image?.type === 'boxart' && image?.side === 'front')
    ?? images.find((image) => image?.type === 'boxart');
  const banner = images.find((image) => image?.type === 'banner' || image?.type === 'fanart');
  const baseUrl = boxart.base_url;
  const imageUrl = (image, size = 'original') => {
    if (!image || typeof image.filename !== 'string' || !baseUrl || typeof baseUrl[size] !== 'string') return null;
    return `${baseUrl[size]}${image.filename}`;
  };

  return {
    image: imageUrl(front),
    bannerImage: imageUrl(banner)
  };
}

function normalizeAdultClassification(value) {
  const rating = nullableString(value)?.toLowerCase();
  if (rating == null) return null;
  return /(?:^|\b)(?:ao|adults?\s*only)(?:\b|$)/i.test(rating);
}

function normalizeResult(value, include) {
  const game = assertObject(value);
  const images = normalizeImage(game.id, include);
  try {
    return createMedia({
      provider: 'thegamesdb',
      providerId: normalizeProviderId(game.id),
      type: 'GAME',
      title: nullableString(game.game_title),
      originalTitle: null,
      alternativeTitles: normalizeNamedValues(game.alternates),
      description: normalizeDescription(game.overview),
      image: images.image,
      bannerImage: images.bannerImage,
      releaseDate: normalizeDate(game.release_date),
      genres: normalizeNamedValues(game.genres),
      providerRating: null,
      releaseStatus: game.release_date ? 'RELEASED' : 'UNKNOWN',
      creators: [],
      isAdult: normalizeAdultClassification(game.rating),
      metadata: {
        platforms: normalizePlatform(game, include?.platform?.data),
        developers: normalizeNamedValues(game.developers),
        publishers: normalizeNamedValues(game.publishers)
      }
    });
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw invalidResponse();
  }
}

function normalizePayload(payload, page, includeAdult) {
  const root = assertObject(payload);
  const data = assertObject(root.data);
  if (!Array.isArray(data.games)) throw invalidResponse();
  const pages = assertObject(root.pages);
  if (!Object.hasOwn(pages, 'next') || (pages.next !== null && typeof pages.next !== 'string')) {
    throw invalidResponse();
  }

  return {
    results: data.games
      .map((game) => normalizeResult(game, root.include))
      .filter((media) => includeAdult || media.isAdult !== true),
    pagination: {
      page,
      perPage: THEGAMESDB_PAGE_SIZE,
      hasMore: pages.next !== null
    }
  };
}

function errorForStatus(status, payload) {
  if (status === 403) {
    if (payload?.status === 'Invalid API key was provided.') return providerError(PROVIDER_ERROR_CODES.UNAVAILABLE);
    return providerError(PROVIDER_ERROR_CODES.RATE_LIMITED);
  }
  if (status === 401 || status === 404 || status === 503) return providerError(PROVIDER_ERROR_CODES.UNAVAILABLE);
  if (status === 429) return providerError(PROVIDER_ERROR_CODES.RATE_LIMITED);
  if (status === 408 || status === 504) return providerError(PROVIDER_ERROR_CODES.TIMEOUT);
  return providerError(PROVIDER_ERROR_CODES.ERROR);
}

function validateSearchOptions({ type, query, page, perPage, includeAdult }) {
  if (type !== 'game' || typeof query !== 'string' || !query.trim()) throw invalidResponse();
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(perPage) || perPage < 1 || typeof includeAdult !== 'boolean') {
    throw invalidResponse();
  }
}

/**
 * Create the server-side TheGamesDB game search boundary.
 *
 * @param {{apiKey?: string, request?: Function, endpoint?: string, timeoutMs?: number}} options
 */
export function createTheGamesDBAdapter({
  apiKey = process.env.THEGAMESDB_API_KEY,
  request = globalThis.fetch,
  endpoint = THEGAMESDB_ENDPOINT,
  timeoutMs = THEGAMESDB_TIMEOUT_MS
} = {}) {
  if (typeof request !== 'function') throw new TypeError('An HTTP request function is required.');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('timeoutMs must be positive.');
  const normalizedKey = typeof apiKey === 'string' ? apiKey.trim() : '';

  return {
    enabled: Boolean(normalizedKey),
    async searchMedia(options = {}) {
      const {
        type = 'game',
        query,
        page = 1,
        perPage = THEGAMESDB_PAGE_SIZE,
        includeAdult = true
      } = options;
      validateSearchOptions({ type, query, page, perPage, includeAdult });
      if (!normalizedKey) throw providerError(PROVIDER_ERROR_CODES.UNAVAILABLE);

      const url = new URL(endpoint);
      url.searchParams.set('apikey', normalizedKey);
      url.searchParams.set('name', query.trim());
      url.searchParams.set('fields', 'overview,rating,genres,developers,publishers,alternates');
      url.searchParams.set('include', 'boxart,platform');
      url.searchParams.set('page', String(page));

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
          let errorPayload;
          if (typeof requestResult.json === 'function') {
            try {
              errorPayload = await requestResult.json();
            } catch {
              errorPayload = null;
            }
          }
          throw errorForStatus(requestResult.status, errorPayload);
        }
        if (typeof requestResult.json !== 'function') throw invalidResponse();

        let payload;
        try {
          payload = await requestResult.json();
        } catch {
          throw invalidResponse();
        }
        return normalizePayload(payload, page, includeAdult);
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
