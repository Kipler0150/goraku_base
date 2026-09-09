import { createMedia } from '../../shared/media.js';
import { ProviderError, PROVIDER_ERROR_CODES } from './errors.js';

export const MYANIMELIST_ENDPOINT = 'https://api.myanimelist.net/v2/anime';
export const MYANIMELIST_TIMEOUT_MS = 5_000;

const ERROR_MESSAGES = Object.freeze({
  [PROVIDER_ERROR_CODES.TIMEOUT]: 'MyAnimeList did not respond within the allowed time.',
  [PROVIDER_ERROR_CODES.RATE_LIMITED]: 'MyAnimeList rate limit reached.',
  [PROVIDER_ERROR_CODES.INVALID_RESPONSE]: 'MyAnimeList returned an invalid response.',
  [PROVIDER_ERROR_CODES.UNAVAILABLE]: 'MyAnimeList is currently unavailable.',
  [PROVIDER_ERROR_CODES.ERROR]: 'MyAnimeList request failed.'
});

const FIELDS = [
  'id',
  'title',
  'main_picture',
  'alternative_titles',
  'start_date',
  'synopsis',
  'mean',
  'status',
  'nsfw',
  'genres',
  'num_episodes',
  'average_episode_duration'
].join(',');

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
  if (value == null) return null;
  if (typeof value !== 'string') throw invalidResponse();
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value);
  if (!match) throw invalidResponse();
  return {
    year: Number(match[1]),
    month: match[2] ? Number(match[2]) : null,
    day: match[3] ? Number(match[3]) : null
  };
}

function normalizeImage(value) {
  if (value == null) return null;
  const image = assertObject(value);
  return nullableString(image.large) ?? nullableString(image.medium);
}

function normalizeAlternativeTitles(value, title, originalTitle) {
  if (value == null) return [];
  const titles = assertObject(value);
  const synonyms = titles.synonyms == null ? [] : titles.synonyms;
  if (!Array.isArray(synonyms)) throw invalidResponse();
  return [titles.en, ...synonyms]
    .map(nullableString)
    .filter((item) => item && item !== title && item !== originalTitle)
    .filter((item, index, values) => values.indexOf(item) === index);
}

function normalizeGenres(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw invalidResponse();
  return value.map((genre) => nullableString(assertObject(genre).name)).filter(Boolean);
}

function normalizeAdultStatus(value) {
  if (value == null) return null;
  if (typeof value !== 'string') throw invalidResponse();
  if (value === 'black') return true;
  if (value === 'white' || value === 'gray') return false;
  return null;
}

function normalizeEpisodeDuration(value) {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 0) throw invalidResponse();
  return Math.round(value / 60);
}

function normalizeAnime(value) {
  const item = assertObject(value);
  if (!Number.isInteger(item.id) || item.id < 1) throw invalidResponse();

  const title = nullableString(item.title);
  const alternativeTitles = item.alternative_titles == null ? null : assertObject(item.alternative_titles);
  const originalTitle = nullableString(alternativeTitles?.ja);
  const statusMap = {
    finished_airing: 'RELEASED',
    currently_airing: 'ONGOING',
    not_yet_aired: 'ANNOUNCED'
  };
  const mean = item.mean == null ? null : item.mean;
  if (mean !== null && (!Number.isFinite(mean) || mean < 0 || mean > 10)) throw invalidResponse();

  try {
    return createMedia({
      provider: 'myanimelist',
      providerId: String(item.id),
      type: 'ANIME',
      title,
      originalTitle,
      alternativeTitles: normalizeAlternativeTitles(alternativeTitles, title, originalTitle),
      description: nullableString(item.synopsis),
      image: normalizeImage(item.main_picture),
      bannerImage: null,
      releaseDate: normalizeDate(item.start_date),
      genres: normalizeGenres(item.genres),
      providerRating: mean === null ? null : { value: mean, max: 10 },
      releaseStatus: statusMap[item.status] ?? 'UNKNOWN',
      creators: [],
        isAdult: normalizeAdultStatus(item.nsfw),
        metadata: {
          episodeCount: item.num_episodes ?? null,
          episodeDurationMinutes: normalizeEpisodeDuration(item.average_episode_duration)
        }
    });
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw invalidResponse();
  }
}

function normalizePayload(payload, page, perPage, includeAdult) {
  const root = assertObject(payload);
  if (!Array.isArray(root.data)) throw invalidResponse();
  const results = root.data
    .map((entry) => normalizeAnime(assertObject(entry).node))
    .filter((media) => includeAdult || media.isAdult !== true);
  const paging = root.paging == null ? null : assertObject(root.paging);
  if (paging?.next != null && typeof paging.next !== 'string') throw invalidResponse();
  return {
    results,
    pagination: { page, perPage, hasMore: Boolean(paging?.next) }
  };
}

function errorForStatus(status) {
  if (status === 403) return providerError(PROVIDER_ERROR_CODES.UNAVAILABLE);
  if (status === 429) return providerError(PROVIDER_ERROR_CODES.RATE_LIMITED);
  if (status === 408 || status === 504) return providerError(PROVIDER_ERROR_CODES.TIMEOUT);
  return providerError(PROVIDER_ERROR_CODES.ERROR);
}

/**
 * Create the server-side MyAnimeList boundary.
 *
 * @param {{clientId?: string, request?: Function, endpoint?: string, timeoutMs?: number}} options
 */
export function createMyAnimeListAdapter({
  clientId = process.env.MAL_CLIENT_ID,
  request = globalThis.fetch,
  endpoint = MYANIMELIST_ENDPOINT,
  timeoutMs = MYANIMELIST_TIMEOUT_MS
} = {}) {
  if (typeof request !== 'function') throw new TypeError('An HTTP request function is required.');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('timeoutMs must be positive.');
  const normalizedClientId = typeof clientId === 'string' ? clientId.trim() : '';

  return {
    enabled: Boolean(normalizedClientId),
    async searchMedia({ query, page = 1, perPage = 12, includeAdult = true } = {}) {
      if (!normalizedClientId) throw providerError(PROVIDER_ERROR_CODES.UNAVAILABLE);

      const url = new URL(endpoint);
      url.searchParams.set('q', query);
      url.searchParams.set('limit', String(perPage));
      url.searchParams.set('offset', String((page - 1) * perPage));
      url.searchParams.set('fields', FIELDS);

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
              'X-MAL-CLIENT-ID': normalizedClientId
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
        return normalizePayload(payload, page, perPage, includeAdult);
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        if (timedOut || error?.name === 'AbortError') throw providerError(PROVIDER_ERROR_CODES.TIMEOUT);
        throw providerError(PROVIDER_ERROR_CODES.ERROR);
      } finally {
        clearTimeout(timeoutHandle);
      }
    },
    async searchAnime(options) {
      return this.searchMedia(options);
    }
  };
}
