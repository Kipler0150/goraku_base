import { createMedia } from '../../shared/media.js';
import { ProviderError, PROVIDER_ERROR_CODES } from './errors.js';
import { requestProviderJson } from './http.js';

export const MYANIMELIST_ENDPOINT = 'https://api.myanimelist.net/v2/anime';
export const MYANIMELIST_TIMEOUT_MS = 5_000;

const ERROR_MESSAGES = Object.freeze({
  [PROVIDER_ERROR_CODES.TIMEOUT]: 'MyAnimeList did not respond within the allowed time.',
  [PROVIDER_ERROR_CODES.RATE_LIMITED]: 'MyAnimeList rate limit reached.',
  [PROVIDER_ERROR_CODES.INVALID_RESPONSE]: 'MyAnimeList returned an invalid response.',
  [PROVIDER_ERROR_CODES.UNAVAILABLE]: 'MyAnimeList is currently unavailable.',
  [PROVIDER_ERROR_CODES.NOT_FOUND]: 'MyAnimeList media was not found.',
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

const SEASONS = Object.freeze([
  { throughMonth: 3, name: 'winter' },
  { throughMonth: 6, name: 'spring' },
  { throughMonth: 9, name: 'summer' },
  { throughMonth: 12, name: 'fall' }
]);

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

function normalizeRecommendationsPayload(payload, page, perPage, includeAdult) {
  const root = assertObject(payload);
  if (!Array.isArray(root.recommendations)) throw invalidResponse();
  return {
    results: root.recommendations
      .map((entry) => normalizeAnime(assertObject(entry).node))
      .filter((media) => includeAdult || media.isAdult !== true),
    pagination: { page, perPage, hasMore: false }
  };
}

function errorForStatus(status, isSearchRequest = false) {
  if (!isSearchRequest && status === 404) return providerError(PROVIDER_ERROR_CODES.NOT_FOUND);
  if (status === 403) return providerError(PROVIDER_ERROR_CODES.UNAVAILABLE);
  if (status === 429) return providerError(PROVIDER_ERROR_CODES.RATE_LIMITED);
  if (status === 408 || status === 504) return providerError(PROVIDER_ERROR_CODES.TIMEOUT);
  return providerError(PROVIDER_ERROR_CODES.ERROR);
}

function currentSeason(clock) {
  const now = clock();
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) throw invalidResponse();
  const month = date.getUTCMonth() + 1;
  return {
    year: date.getUTCFullYear(),
    season: SEASONS.find(({ throughMonth }) => month <= throughMonth).name
  };
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
  timeoutMs = MYANIMELIST_TIMEOUT_MS,
  clock = () => new Date()
} = {}) {
  if (typeof request !== 'function') throw new TypeError('An HTTP request function is required.');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('timeoutMs must be positive.');
  const normalizedClientId = typeof clientId === 'string' ? clientId.trim() : '';
  const normalizedEndpoint = endpoint.replace(/\/+$/, '');

  const validateDiscoveryOptions = ({ page = 1, perPage = 12, includeAdult = true } = {}) => {
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(perPage) || perPage < 1 || typeof includeAdult !== 'boolean') {
      throw invalidResponse();
    }
    return { page, perPage, includeAdult };
  };

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
          throw errorForStatus(requestResult.status, true);
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
    },
    async getRanking(rankingType, { page = 1, perPage = 12, includeAdult = true } = {}) {
      if (!normalizedClientId) throw providerError(PROVIDER_ERROR_CODES.UNAVAILABLE);
      const options = validateDiscoveryOptions({ page, perPage, includeAdult });
      const url = new URL(`${normalizedEndpoint}/ranking`);
      url.searchParams.set('ranking_type', rankingType);
      url.searchParams.set('limit', String(perPage));
      url.searchParams.set('offset', String((page - 1) * perPage));
      url.searchParams.set('fields', FIELDS);
      const payload = await requestProviderJson({
        request,
        url,
        timeoutMs,
        options: {
          method: 'GET',
          headers: { accept: 'application/json', 'X-MAL-CLIENT-ID': normalizedClientId }
        },
        invalidResponse,
        errorForStatus: (status) => errorForStatus(status, true)
      });
      return normalizePayload(payload, page, perPage, includeAdult);
    },
    async getRecommendations({ providerId, page = 1, perPage = 12, includeAdult = true } = {}) {
      if (!normalizedClientId) throw providerError(PROVIDER_ERROR_CODES.UNAVAILABLE);
      const options = validateDiscoveryOptions({ page, perPage, includeAdult });
      if (typeof providerId !== 'string' || !/^[1-9]\d*$/.test(providerId.trim())) throw invalidResponse();
      const url = new URL(`${normalizedEndpoint}/${providerId.trim()}`);
      url.searchParams.set('fields', 'recommendations');
      const payload = await requestProviderJson({
        request,
        url,
        timeoutMs,
        options: {
          method: 'GET',
          headers: { accept: 'application/json', 'X-MAL-CLIENT-ID': normalizedClientId }
        },
        invalidResponse,
        errorForStatus: (status) => errorForStatus(status)
      });
      return normalizeRecommendationsPayload(payload, page, perPage, options.includeAdult);
    },
    async getTrending(options) {
      return this.getRanking('airing', options);
    },
    async getPopular(options) {
      return this.getRanking('bypopularity', options);
    },
    async getLatest({ page = 1, perPage = 12, includeAdult = true } = {}) {
      if (!normalizedClientId) throw providerError(PROVIDER_ERROR_CODES.UNAVAILABLE);
      const options = validateDiscoveryOptions({ page, perPage, includeAdult });
      const { year, season } = currentSeason(clock);
      const url = new URL(`${normalizedEndpoint}/season/${year}/${season}`);
      url.searchParams.set('sort', 'anime_score');
      url.searchParams.set('limit', String(perPage));
      url.searchParams.set('offset', String((page - 1) * perPage));
      url.searchParams.set('fields', FIELDS);
      const payload = await requestProviderJson({
        request,
        url,
        timeoutMs,
        options: {
          method: 'GET',
          headers: { accept: 'application/json', 'X-MAL-CLIENT-ID': normalizedClientId }
        },
        invalidResponse,
        errorForStatus: (status) => errorForStatus(status, true)
      });
      return normalizePayload(payload, page, perPage, options.includeAdult);
    },
    getPopularMedia(options) {
      return this.getPopular(options);
    },
    getTrendingMedia(options) {
      return this.getTrending(options);
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
      if (!normalizedClientId) throw providerError(PROVIDER_ERROR_CODES.UNAVAILABLE);

      const url = new URL(`${endpoint.replace(/\/+$/, '')}/${providerId.trim()}`);
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
        const media = normalizeAnime(payload);
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
