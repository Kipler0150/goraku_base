import { createMedia } from '../../shared/media.js';
import { ProviderError, PROVIDER_ERROR_CODES } from './errors.js';
import { requestProviderJson } from './http.js';

export const TMDB_ENDPOINT = 'https://api.themoviedb.org/3/search';
export const TMDB_DETAILS_ENDPOINT = 'https://api.themoviedb.org/3';
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
  [PROVIDER_ERROR_CODES.NOT_FOUND]: 'TMDB media was not found.',
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
  if (!Array.isArray(value)) throw invalidResponse();
  if (value.every((genre) => Number.isInteger(genre))) {
    const genreMap = type === 'MOVIE' ? MOVIE_GENRES : TV_GENRES;
    return value.map((genre) => genreMap[genre]).filter(Boolean);
  }
  if (value.some((genre) => !genre || typeof genre !== 'object' || typeof genre.name !== 'string')) throw invalidResponse();
  return value.map((genre) => genre.name.trim()).filter(Boolean);
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

function normalizeDetailStatus(value) {
  const status = nullableString(value);
  if (status == null) return 'UNKNOWN';
  if (status === 'Released' || status === 'Ended') return 'RELEASED';
  if (status === 'Returning Series' || status === 'In Production') return 'ONGOING';
  if (status === 'Planned' || status === 'Pilot') return 'ANNOUNCED';
  if (status === 'Canceled') return 'CANCELLED';
  return 'UNKNOWN';
}

function normalizeCreators(value, type) {
  if (type === 'tv' && value.created_by != null) {
    if (!Array.isArray(value.created_by)) throw invalidResponse();
    return value.created_by.map((creator) => {
      const item = assertObject(creator);
      const name = nullableString(item.name);
      if (!name) throw invalidResponse();
      return { name, role: 'creator' };
    });
  }

  const credits = value.credits;
  if (credits == null) return [];
  const crew = assertObject(credits).crew;
  if (crew == null) return [];
  if (!Array.isArray(crew)) throw invalidResponse();
  return crew.map((creator) => {
    const item = assertObject(creator);
    const name = nullableString(item.name);
    const role = nullableString(item.job ?? item.department);
    if (!name || !role) throw invalidResponse();
    return { name, role };
  });
}

function normalizeDetailsResult(value, type, imageBaseUrl) {
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
      genres: normalizeGenres(item.genres, mediaType),
      providerRating: normalizeRating(item.vote_average),
      releaseStatus: normalizeDetailStatus(item.status),
      creators: normalizeCreators(item, type),
      isAdult: normalizeAdult(item.adult),
      metadata: mediaType === 'MOVIE'
        ? { runtimeMinutes: item.runtime == null ? null : item.runtime }
        : {
            seasonCount: item.number_of_seasons == null ? null : item.number_of_seasons,
            episodeCount: item.number_of_episodes == null ? null : item.number_of_episodes
          }
    });
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw invalidResponse();
  }
}

function normalizeEpisodeRuntime(value) {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 0) throw invalidResponse();
  return value;
}

function isReleasedDate(date) {
  if (!date || !Number.isInteger(date.year) || !Number.isInteger(date.month) || !Number.isInteger(date.day)) return false;
  return Date.UTC(date.year, date.month - 1, date.day) <= Date.now();
}

function normalizeSeasonEpisodes(value, providerId, season, imageBaseUrl) {
  const root = assertObject(value);
  if (!Array.isArray(root.episodes)) throw invalidResponse();

  const episodes = root.episodes
    .map((episode) => {
      const item = assertObject(episode);
      if (!Number.isInteger(item.episode_number) || item.episode_number < 1) return null;
      const airDate = normalizeDate(item.air_date);
      if (!isReleasedDate(airDate)) return null;
      return {
        number: item.episode_number,
        title: nullableString(item.name) ?? `Episode ${item.episode_number}`,
        airDate,
        runtimeMinutes: normalizeEpisodeRuntime(item.runtime),
        image: imageUrl(imageBaseUrl, POSTER_SIZE, item.still_path)
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.number - right.number);

  return {
    provider: 'tmdb',
    providerId: normalizeProviderId(providerId),
    type: 'TV',
    season,
    episodes
  };
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

function errorForStatus(status, isSearchRequest = false) {
  if (!isSearchRequest && status === 404) return providerError(PROVIDER_ERROR_CODES.NOT_FOUND);
  if (status === 401 || status === 403) return providerError(PROVIDER_ERROR_CODES.UNAVAILABLE);
  if (status === 429) return providerError(PROVIDER_ERROR_CODES.RATE_LIMITED);
  if (status === 408 || status === 504) return providerError(PROVIDER_ERROR_CODES.TIMEOUT);
  return providerError(PROVIDER_ERROR_CODES.ERROR);
}

function hasFilters(filters) {
  return Boolean(filters && (
    (Array.isArray(filters.genres) && filters.genres.length > 0) ||
    filters.creator ||
    Number.isFinite(filters.minRating)
  ));
}

function validateSearchOptions({ type, query, page, perPage, includeAdult, filters }) {
  if (!SEARCH_TYPES.has(type) || typeof query !== 'string' || (!query.trim() && !hasFilters(filters))) throw invalidResponse();
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(perPage) || perPage < 1) throw invalidResponse();
  if (typeof includeAdult !== 'boolean') throw invalidResponse();
}

function normalizeFilterOptions(payload, field) {
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

function normalizeCreatorOptions(payload) {
  const root = assertObject(payload);
  if (!Array.isArray(root.results)) throw invalidResponse();
  return root.results.map((entry) => {
    const item = assertObject(entry);
    const id = normalizeProviderId(item.id);
    const label = nullableString(item.name);
    if (!label) throw invalidResponse();
    return { id, label };
  });
}

/**
 * Create the server-side TMDB search boundary.
 *
 * @param {{accessToken?: string, request?: Function, endpoint?: string, detailsEndpoint?: string, imageBaseUrl?: string, timeoutMs?: number}} options
 */
export function createTMDBAdapter({
  accessToken = process.env.TMDB_ACCESS_TOKEN,
  request = globalThis.fetch,
  endpoint = TMDB_ENDPOINT,
  detailsEndpoint = TMDB_DETAILS_ENDPOINT,
  imageBaseUrl = process.env.TMDB_IMAGE_BASE_URL ?? TMDB_IMAGE_BASE_URL,
  timeoutMs = TMDB_TIMEOUT_MS
} = {}) {
  if (typeof request !== 'function') throw new TypeError('An HTTP request function is required.');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('timeoutMs must be positive.');
  const normalizedToken = typeof accessToken === 'string' ? accessToken.trim() : '';
  const normalizedImageBaseUrl = (typeof imageBaseUrl === 'string' && imageBaseUrl.trim()
    ? imageBaseUrl.trim()
    : TMDB_IMAGE_BASE_URL).replace(/\/+$/, '');
  const normalizedDetailsEndpoint = (typeof detailsEndpoint === 'string' && detailsEndpoint.trim()
    ? detailsEndpoint.trim()
    : TMDB_DETAILS_ENDPOINT).replace(/\/+$/, '');

  const validateDiscoveryOptions = ({ type, page = 1, perPage = 12, includeAdult = true } = {}) => {
    if (!SEARCH_TYPES.has(type) || !Number.isInteger(page) || page < 1 ||
        !Number.isInteger(perPage) || perPage < 1 || typeof includeAdult !== 'boolean') {
      throw invalidResponse();
    }
    return { type, page, perPage, includeAdult };
  };

  return {
    enabled: Boolean(normalizedToken),
    async searchMedia(options = {}) {
      const { type = 'movie', query = '', page = 1, perPage = 12, includeAdult = true, filters = null } = options;
      validateSearchOptions({ type, query, page, perPage, includeAdult, filters });
      if (!normalizedToken) throw providerError(PROVIDER_ERROR_CODES.UNAVAILABLE);

      const filtered = hasFilters(filters);
      const url = new URL(filtered
        ? `${normalizedDetailsEndpoint}/discover/${type}`
        : `${endpoint.replace(/\/+$/, '')}/${type}`);
      if (!filtered) url.searchParams.set('query', query.trim());
      url.searchParams.set('page', String(page));
      url.searchParams.set('include_adult', String(includeAdult));
      url.searchParams.set('language', 'en-US');
      if (filtered) {
        url.searchParams.set('sort_by', `${type === 'movie' ? 'primary_release_date' : 'first_air_date'}.desc`);
        if (filters.genres?.length) url.searchParams.set('with_genres', filters.genres.join('|'));
        if (filters.creator) url.searchParams.set('with_people', filters.creator);
        if (Number.isFinite(filters.minRating)) url.searchParams.set('vote_average.gte', String(filters.minRating));
      }

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
          throw errorForStatus(requestResult.status, true);
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
    },
    async getFilterOptions({ type = 'movie', creatorQuery = '', includeAdult = true } = {}) {
      if (!SEARCH_TYPES.has(type) || typeof creatorQuery !== 'string' || typeof includeAdult !== 'boolean') throw invalidResponse();
      if (!normalizedToken) throw providerError(PROVIDER_ERROR_CODES.UNAVAILABLE);

      const headers = { accept: 'application/json', Authorization: `Bearer ${normalizedToken}` };
      const genreUrl = new URL(`${normalizedDetailsEndpoint}/genre/${type}/list`);
      genreUrl.searchParams.set('language', 'en-US');
      const requests = [requestProviderJson({
        request,
        url: genreUrl,
        timeoutMs,
        options: { method: 'GET', headers },
        invalidResponse,
        errorForStatus: (status) => errorForStatus(status, true)
      })];

      if (creatorQuery.trim()) {
        const creatorUrl = new URL(`${normalizedDetailsEndpoint}/search/person`);
        creatorUrl.searchParams.set('query', creatorQuery.trim());
        creatorUrl.searchParams.set('page', '1');
        creatorUrl.searchParams.set('include_adult', String(includeAdult));
        creatorUrl.searchParams.set('language', 'en-US');
        requests.push(requestProviderJson({
          request,
          url: creatorUrl,
          timeoutMs,
          options: { method: 'GET', headers },
          invalidResponse,
          errorForStatus: (status) => errorForStatus(status, true)
        }));
      }

      const [genres, creators = { results: [] }] = await Promise.all(requests);
      return {
        genres: normalizeFilterOptions(genres, 'genres'),
        creators: normalizeCreatorOptions(creators),
        rating: { field: 'minRating', label: 'Minimum Provider Rating', max: 10, step: 0.5 }
      };
    },
    async getTrending({ type = 'movie', page = 1, perPage = 12, includeAdult = true } = {}) {
      const options = validateDiscoveryOptions({ type, page, perPage, includeAdult });
      if (!normalizedToken) throw providerError(PROVIDER_ERROR_CODES.UNAVAILABLE);
      const url = new URL(`${normalizedDetailsEndpoint}/trending/${type}/week`);
      url.searchParams.set('page', String(page));
      url.searchParams.set('include_adult', String(includeAdult));
      url.searchParams.set('language', 'en-US');
      const payload = await requestProviderJson({
        request,
        url,
        timeoutMs,
        options: {
          method: 'GET',
          headers: { accept: 'application/json', Authorization: `Bearer ${normalizedToken}` }
        },
        invalidResponse,
        errorForStatus: (status) => errorForStatus(status, true)
      });
      return normalizePayload(payload, options.type, normalizedImageBaseUrl, includeAdult);
    },
    async getPopular({ type = 'movie', page = 1, perPage = 12, includeAdult = true } = {}) {
      const options = validateDiscoveryOptions({ type, page, perPage, includeAdult });
      if (!normalizedToken) throw providerError(PROVIDER_ERROR_CODES.UNAVAILABLE);
      const url = new URL(`${normalizedDetailsEndpoint}/${type}/popular`);
      url.searchParams.set('page', String(page));
      url.searchParams.set('include_adult', String(includeAdult));
      url.searchParams.set('language', 'en-US');
      const payload = await requestProviderJson({
        request,
        url,
        timeoutMs,
        options: {
          method: 'GET',
          headers: { accept: 'application/json', Authorization: `Bearer ${normalizedToken}` }
        },
        invalidResponse,
        errorForStatus: (status) => errorForStatus(status, true)
      });
      return normalizePayload(payload, options.type, normalizedImageBaseUrl, includeAdult);
    },
    async getLatest({ type = 'movie', page = 1, perPage = 12, includeAdult = true } = {}) {
      const options = validateDiscoveryOptions({ type, page, perPage, includeAdult });
      if (!normalizedToken) throw providerError(PROVIDER_ERROR_CODES.UNAVAILABLE);
      const latestPath = options.type === 'movie' ? 'movie/now_playing' : 'tv/on_the_air';
      const url = new URL(`${normalizedDetailsEndpoint}/${latestPath}`);
      url.searchParams.set('page', String(page));
      url.searchParams.set('include_adult', String(includeAdult));
      url.searchParams.set('language', 'en-US');
      const payload = await requestProviderJson({
        request,
        url,
        timeoutMs,
        options: {
          method: 'GET',
          headers: { accept: 'application/json', Authorization: `Bearer ${normalizedToken}` }
        },
        invalidResponse,
        errorForStatus: (status) => errorForStatus(status, true)
      });
      return normalizePayload(payload, options.type, normalizedImageBaseUrl, includeAdult);
    },
    async getRecommendations({ type = 'movie', providerId, page = 1, perPage = 12, includeAdult = true } = {}) {
      const options = validateDiscoveryOptions({ type, page, perPage, includeAdult });
      if (typeof providerId !== 'string' || !/^[1-9]\d*$/.test(providerId.trim())) throw invalidResponse();
      if (!normalizedToken) throw providerError(PROVIDER_ERROR_CODES.UNAVAILABLE);
      const url = new URL(`${normalizedDetailsEndpoint}/${type}/${providerId.trim()}/recommendations`);
      url.searchParams.set('page', String(page));
      url.searchParams.set('include_adult', String(includeAdult));
      url.searchParams.set('language', 'en-US');
      const payload = await requestProviderJson({
        request,
        url,
        timeoutMs,
        options: {
          method: 'GET',
          headers: { accept: 'application/json', Authorization: `Bearer ${normalizedToken}` }
        },
        invalidResponse,
        errorForStatus: (status) => errorForStatus(status)
      });
      return normalizePayload(payload, options.type, normalizedImageBaseUrl, includeAdult);
    },
    getTrendingMedia(options) {
      return this.getTrending(options);
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
    async getSeasonEpisodes({ providerId, season = 1 } = {}) {
      if (typeof providerId !== 'string' || !/^[1-9]\d*$/.test(providerId.trim()) ||
          !Number.isInteger(season) || season < 1 || season > 1_000) {
        throw invalidResponse();
      }
      if (!normalizedToken) throw providerError(PROVIDER_ERROR_CODES.UNAVAILABLE);

      const normalizedProviderId = providerId.trim();
      const url = new URL(`${normalizedDetailsEndpoint}/tv/${normalizedProviderId}/season/${season}`);
      url.searchParams.set('language', 'en-US');
      const payload = await requestProviderJson({
        request,
        url,
        timeoutMs,
        options: {
          method: 'GET',
          headers: { accept: 'application/json', Authorization: `Bearer ${normalizedToken}` }
        },
        invalidResponse,
        errorForStatus: (status) => errorForStatus(status)
      });
      return normalizeSeasonEpisodes(payload, normalizedProviderId, season, normalizedImageBaseUrl);
    },
    async getMediaDetails({ type = 'movie', providerId, includeAdult = true } = {}) {
      if (!SEARCH_TYPES.has(type) || typeof providerId !== 'string' || !/^[1-9]\d*$/.test(providerId.trim())) {
        throw invalidResponse();
      }
      if (!normalizedToken) throw providerError(PROVIDER_ERROR_CODES.UNAVAILABLE);

      const url = new URL(`${normalizedDetailsEndpoint}/${type}/${providerId.trim()}`);
      url.searchParams.set('language', 'en-US');
      url.searchParams.set('append_to_response', 'credits');

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
        const media = normalizeDetailsResult(payload, type, normalizedImageBaseUrl);
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
