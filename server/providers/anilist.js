import { createMedia } from '../../shared/media.js';
import { ProviderError, PROVIDER_ERROR_CODES } from './errors.js';
import { requestProviderJson } from './http.js';

export const ANILIST_ENDPOINT = 'https://graphql.anilist.co';
export const ANILIST_TIMEOUT_MS = 5_000;

const PROVIDER_ERROR_MESSAGES = Object.freeze({
  [PROVIDER_ERROR_CODES.TIMEOUT]: 'AniList did not respond within the allowed time.',
  [PROVIDER_ERROR_CODES.RATE_LIMITED]: 'AniList rate limit reached.',
  [PROVIDER_ERROR_CODES.INVALID_RESPONSE]: 'AniList returned an invalid response.',
  [PROVIDER_ERROR_CODES.UNAVAILABLE]: 'AniList is currently unavailable.',
  [PROVIDER_ERROR_CODES.NOT_FOUND]: 'AniList media was not found.',
  [PROVIDER_ERROR_CODES.ERROR]: 'AniList request failed.'
});

const GRAPHQL_QUERY = `
  query SearchAnime($search: String!, $page: Int!, $perPage: Int!, $includeAdult: Boolean!) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { currentPage perPage hasNextPage }
      media(search: $search, type: ANIME, isAdult: $includeAdult) {
        id
        title { english romaji native }
        description
        coverImage { extraLarge large medium }
        bannerImage
        startDate { year month day }
        genres
        averageScore
        status
        staff { edges { role node { name { full } } } }
        studios { edges { isMain node { name } } }
        episodes
        duration
        isAdult
      }
    }
  }
`;

const DETAILS_GRAPHQL_QUERY = `
  query MediaDetails($id: Int!) {
    Media(id: $id, type: ANIME) {
      id
      title { english romaji native }
      description
      coverImage { extraLarge large medium }
      bannerImage
      startDate { year month day }
      genres
      averageScore
      status
      staff { edges { role node { name { full } } } }
      studios { edges { isMain node { name } } }
      episodes
      duration
      isAdult
    }
  }
`;

const DISCOVERY_MEDIA_FIELDS = `
      id
      title { english romaji native }
      description
      coverImage { extraLarge large medium }
      bannerImage
      startDate { year month day }
      genres
      averageScore
      status
      staff { edges { role node { name { full } } } }
      studios { edges { isMain node { name } } }
      episodes
      duration
      isAdult
`;

const DISCOVERY_GRAPHQL_QUERY = `
  query DiscoverAnime($page: Int!, $perPage: Int!, $includeAdult: Boolean!, $sort: [MediaSort]!) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { currentPage perPage hasNextPage }
      media(type: ANIME, sort: $sort, isAdult: $includeAdult) {
${DISCOVERY_MEDIA_FIELDS}
      }
    }
  }
`;

const RECOMMENDATIONS_GRAPHQL_QUERY = `
  query AnimeRecommendations($id: Int!, $page: Int!, $perPage: Int!) {
    Media(id: $id, type: ANIME) {
      recommendations(page: $page, perPage: $perPage) {
        pageInfo { currentPage perPage hasNextPage }
        nodes {
          media {
${DISCOVERY_MEDIA_FIELDS}
          }
        }
      }
    }
  }
`;

/**
 * A safe, stable error raised by a provider adapter.
 */
export { ProviderError, PROVIDER_ERROR_CODES };

function invalidResponse() {
  return new ProviderError(PROVIDER_ERROR_CODES.INVALID_RESPONSE, PROVIDER_ERROR_MESSAGES[PROVIDER_ERROR_CODES.INVALID_RESPONSE]);
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

function optionalObject(value) {
  if (value == null) return null;
  return assertObject(value);
}

function firstText(...values) {
  return values.map(nullableString).find(Boolean) ?? null;
}

function decodeEntity(entity) {
  const named = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"'
  };
  if (entity in named) return named[entity];
  if (entity.startsWith('#x') || entity.startsWith('#X')) {
    const codePoint = Number.parseInt(entity.slice(2), 16);
    return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : `&${entity};`;
  }
  if (entity.startsWith('#')) {
    const codePoint = Number.parseInt(entity.slice(1), 10);
    return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : `&${entity};`;
  }
  return `&${entity};`;
}

/**
 * Turn an AniList description into plain text. This output is data, never HTML.
 * @param {string|null|undefined} value
 * @returns {string|null}
 */
export function normalizeAniListDescription(value) {
  if (value == null) return null;
  if (typeof value !== 'string') throw invalidResponse();

  const withLineBreaks = value
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<(?:p|div|li|h[1-6]|blockquote)(?:\s[^>]*)?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/~!([\s\S]*?)!~/g, '$1')
    .replace(/(\*\*|__|~~|[*_])/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (_, entity) => decodeEntity(entity));

  const lines = withLineBreaks
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim());
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() || null;
}

function normalizeTitleFields(value) {
  if (value == null) return { english: null, romaji: null, native: null };
  const title = assertObject(value);
  return {
    english: nullableString(title.english),
    romaji: nullableString(title.romaji),
    native: nullableString(title.native)
  };
}

function normalizeImage(value, preferredFields) {
  const image = optionalObject(value);
  if (!image) return null;
  return firstText(...preferredFields.map((field) => image[field]));
}

function normalizeDate(value) {
  const date = optionalObject(value);
  if (!date || date.year == null && date.month == null && date.day == null) return null;
  return {
    year: date.year ?? null,
    month: date.month ?? null,
    day: date.day ?? null
  };
}

function normalizeStringList(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw invalidResponse();
  return value.map((item) => nullableString(item)).filter(Boolean);
}

function normalizeCreators(item) {
  const creators = [];
  const staff = optionalObject(item.staff);
  if (staff) {
    if (!Array.isArray(staff.edges)) throw invalidResponse();
    for (const edgeValue of staff.edges) {
      const edge = assertObject(edgeValue);
      const node = assertObject(edge.node);
      const name = assertObject(node.name);
      const creatorName = nullableString(name.full);
      const role = nullableString(edge.role);
      if (!creatorName || !role) throw invalidResponse();
      creators.push({ name: creatorName, role });
    }
  }

  const studios = optionalObject(item.studios);
  if (studios) {
    if (!Array.isArray(studios.edges)) throw invalidResponse();
    for (const edgeValue of studios.edges) {
      const edge = assertObject(edgeValue);
      const node = assertObject(edge.node);
      if (edge.isMain !== true) continue;
      const name = nullableString(node.name);
      if (!name) throw invalidResponse();
      creators.push({ name, role: 'studio' });
    }
  }
  return creators;
}

function normalizeAnime(itemValue) {
  const item = assertObject(itemValue);
  if (!Number.isInteger(item.id) || item.id < 1) throw invalidResponse();

  const titles = normalizeTitleFields(item.title);
  const title = titles.english ?? titles.romaji ?? titles.native;
  const alternativeTitles = [titles.english, titles.romaji, titles.native]
    .filter((value) => value && value !== title && value !== titles.native)
    .filter((value, index, values) => values.indexOf(value) === index);

  const averageScore = item.averageScore == null ? null : item.averageScore;
  if (averageScore !== null && (!Number.isFinite(averageScore) || averageScore < 0 || averageScore > 100)) {
    throw invalidResponse();
  }
  if (item.isAdult != null && typeof item.isAdult !== 'boolean') throw invalidResponse();

  const statusMap = {
    FINISHED: 'RELEASED',
    RELEASING: 'ONGOING',
    NOT_YET_RELEASED: 'ANNOUNCED',
    CANCELLED: 'CANCELLED'
  };
  if (item.status != null && typeof item.status !== 'string') throw invalidResponse();

  try {
    return createMedia({
      provider: 'anilist',
      providerId: String(item.id),
      type: 'ANIME',
      title,
      originalTitle: titles.native,
      alternativeTitles,
      description: normalizeAniListDescription(item.description),
      image: normalizeImage(item.coverImage, ['extraLarge', 'large', 'medium']),
      bannerImage: nullableString(item.bannerImage),
      releaseDate: normalizeDate(item.startDate),
      genres: normalizeStringList(item.genres),
      providerRating: averageScore === null ? null : { value: averageScore, max: 100 },
      releaseStatus: statusMap[item.status] ?? 'UNKNOWN',
      creators: normalizeCreators(item),
      isAdult: item.isAdult ?? null,
      metadata: {
        episodeCount: item.episodes ?? null,
        episodeDurationMinutes: item.duration ?? null
      }
    });
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw invalidResponse();
  }
}

function normalizePayload(payload, includeAdult = true) {
  const root = assertObject(payload);
  if (Object.prototype.hasOwnProperty.call(root, 'errors')) {
    if (!Array.isArray(root.errors)) throw invalidResponse();
    throw new ProviderError(PROVIDER_ERROR_CODES.ERROR, 'AniList returned a provider error.');
  }
  const data = assertObject(root.data);
  const page = assertObject(data.Page);
  const pageInfo = assertObject(page.pageInfo);
  if (!Number.isInteger(pageInfo.currentPage) || pageInfo.currentPage < 1) throw invalidResponse();
  if (!Number.isInteger(pageInfo.perPage) || pageInfo.perPage < 1) throw invalidResponse();
  if (typeof pageInfo.hasNextPage !== 'boolean' || !Array.isArray(page.media)) throw invalidResponse();

  return {
    results: page.media
      .map(normalizeAnime)
      .filter((media) => includeAdult || media.isAdult !== true),
    pagination: {
      page: pageInfo.currentPage,
      perPage: pageInfo.perPage,
      hasMore: pageInfo.hasNextPage
    }
  };
}

function normalizeDetailsPayload(payload) {
  const root = assertObject(payload);
  if (Object.prototype.hasOwnProperty.call(root, 'errors')) {
    if (!Array.isArray(root.errors)) throw invalidResponse();
    throw new ProviderError(PROVIDER_ERROR_CODES.ERROR, 'AniList returned a provider error.');
  }
  const data = assertObject(root.data);
  if (data.Media == null) throw new ProviderError(PROVIDER_ERROR_CODES.NOT_FOUND, PROVIDER_ERROR_MESSAGES[PROVIDER_ERROR_CODES.NOT_FOUND]);
  return normalizeAnime(data.Media);
}

function normalizeRecommendationsPayload(payload, includeAdult) {
  const root = assertObject(payload);
  if (Object.prototype.hasOwnProperty.call(root, 'errors')) {
    if (!Array.isArray(root.errors)) throw invalidResponse();
    throw new ProviderError(PROVIDER_ERROR_CODES.ERROR, 'AniList returned a provider error.');
  }
  const data = assertObject(root.data);
  if (data.Media == null) throw new ProviderError(PROVIDER_ERROR_CODES.NOT_FOUND, PROVIDER_ERROR_MESSAGES[PROVIDER_ERROR_CODES.NOT_FOUND]);
  const media = assertObject(data.Media);
  const connection = assertObject(media.recommendations);
  const pageInfo = assertObject(connection.pageInfo);
  if (!Number.isInteger(pageInfo.currentPage) || pageInfo.currentPage < 1 ||
      !Number.isInteger(pageInfo.perPage) || pageInfo.perPage < 1 || typeof pageInfo.hasNextPage !== 'boolean') {
    throw invalidResponse();
  }

  let entries;
  if (connection.nodes != null) {
    if (!Array.isArray(connection.nodes)) throw invalidResponse();
    entries = connection.nodes.map((entry) => assertObject(entry).media);
  } else if (connection.edges != null) {
    if (!Array.isArray(connection.edges)) throw invalidResponse();
    entries = connection.edges.map((entry) => {
      const edge = assertObject(entry);
      return assertObject(edge.node).media;
    });
  } else {
    throw invalidResponse();
  }

  return {
    results: entries
      .filter((entry) => entry != null)
      .map(normalizeAnime)
      .filter((mediaEntry) => includeAdult || mediaEntry.isAdult !== true),
    pagination: {
      page: pageInfo.currentPage,
      perPage: pageInfo.perPage,
      hasMore: pageInfo.hasNextPage
    }
  };
}

function errorForStatus(status, isSearchRequest = false) {
  if (!isSearchRequest && status === 404) return new ProviderError(PROVIDER_ERROR_CODES.NOT_FOUND, PROVIDER_ERROR_MESSAGES[PROVIDER_ERROR_CODES.NOT_FOUND]);
  if (status === 403) return new ProviderError(PROVIDER_ERROR_CODES.UNAVAILABLE, PROVIDER_ERROR_MESSAGES[PROVIDER_ERROR_CODES.UNAVAILABLE]);
  if (status === 429) return new ProviderError(PROVIDER_ERROR_CODES.RATE_LIMITED, PROVIDER_ERROR_MESSAGES[PROVIDER_ERROR_CODES.RATE_LIMITED]);
  if (status === 408 || status === 504) return new ProviderError(PROVIDER_ERROR_CODES.TIMEOUT, PROVIDER_ERROR_MESSAGES[PROVIDER_ERROR_CODES.TIMEOUT]);
  return new ProviderError(PROVIDER_ERROR_CODES.ERROR, PROVIDER_ERROR_MESSAGES[PROVIDER_ERROR_CODES.ERROR]);
}

/**
 * Create the server-side AniList boundary.
 *
 * @param {{request?: Function, endpoint?: string, timeoutMs?: number}} options
 */
export function createAniListAdapter({
  request = globalThis.fetch,
  endpoint = ANILIST_ENDPOINT,
  timeoutMs = ANILIST_TIMEOUT_MS
} = {}) {
  if (typeof request !== 'function') throw new TypeError('An HTTP request function is required.');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('timeoutMs must be positive.');

  const validateDiscoveryOptions = ({ page = 1, perPage = 12, includeAdult = true } = {}) => {
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(perPage) || perPage < 1 || typeof includeAdult !== 'boolean') {
      throw invalidResponse();
    }
    return { page, perPage, includeAdult };
  };

  return {
    async searchMedia({ query, page = 1, perPage = 12, includeAdult = true } = {}) {
      const controller = new AbortController();
      let timedOut = false;
      let timeoutHandle;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new ProviderError(PROVIDER_ERROR_CODES.TIMEOUT, PROVIDER_ERROR_MESSAGES[PROVIDER_ERROR_CODES.TIMEOUT]));
        }, timeoutMs);
      });

      try {
        const requestResult = await Promise.race([
          Promise.resolve().then(() => request(endpoint, {
            method: 'POST',
            headers: {
              accept: 'application/json',
              'content-type': 'application/json'
            },
            body: JSON.stringify({
              query: GRAPHQL_QUERY,
              variables: { search: query, page, perPage, includeAdult }
            }),
            signal: controller.signal
          })),
          timeoutPromise
        ]);

        if (!requestResult || typeof requestResult !== 'object') throw invalidResponse();
        const status = requestResult.status;
        if ((status !== undefined && (status < 200 || status >= 300)) || requestResult.ok === false) {
          throw errorForStatus(status, true);
        }
        if (typeof requestResult.json !== 'function') throw invalidResponse();

        let payload;
        try {
          payload = await requestResult.json();
        } catch {
          throw invalidResponse();
        }
        return normalizePayload(payload, includeAdult);
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        if (timedOut || error?.name === 'AbortError') {
          throw new ProviderError(PROVIDER_ERROR_CODES.TIMEOUT, PROVIDER_ERROR_MESSAGES[PROVIDER_ERROR_CODES.TIMEOUT]);
        }
        throw new ProviderError(PROVIDER_ERROR_CODES.ERROR, PROVIDER_ERROR_MESSAGES[PROVIDER_ERROR_CODES.ERROR]);
      } finally {
        clearTimeout(timeoutHandle);
      }
    },
    async searchAnime(options) {
      return this.searchMedia(options);
    },
    async getTrending({ page = 1, perPage = 12, includeAdult = true } = {}) {
      const options = validateDiscoveryOptions({ page, perPage, includeAdult });
      const payload = await requestProviderJson({
        request,
        url: endpoint,
        timeoutMs,
        options: {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({
            query: DISCOVERY_GRAPHQL_QUERY,
            variables: { ...options, sort: ['TRENDING_DESC'] }
          })
        },
        invalidResponse,
        errorForStatus: (status) => errorForStatus(status, true)
      });
      return normalizePayload(payload, includeAdult);
    },
    async getPopular({ page = 1, perPage = 12, includeAdult = true } = {}) {
      const options = validateDiscoveryOptions({ page, perPage, includeAdult });
      const payload = await requestProviderJson({
        request,
        url: endpoint,
        timeoutMs,
        options: {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({
            query: DISCOVERY_GRAPHQL_QUERY,
            variables: { ...options, sort: ['POPULARITY_DESC'] }
          })
        },
        invalidResponse,
        errorForStatus: (status) => errorForStatus(status, true)
      });
      return normalizePayload(payload, includeAdult);
    },
    async getRecommendations({ providerId, page = 1, perPage = 12, includeAdult = true } = {}) {
      const options = validateDiscoveryOptions({ page, perPage, includeAdult });
      if (typeof providerId !== 'string' || !/^[1-9]\d*$/.test(providerId.trim())) throw invalidResponse();
      const payload = await requestProviderJson({
        request,
        url: endpoint,
        timeoutMs,
        options: {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({
            query: RECOMMENDATIONS_GRAPHQL_QUERY,
            variables: { id: Number(providerId), page, perPage }
          })
        },
        invalidResponse,
        errorForStatus: (status) => errorForStatus(status)
      });
      return normalizeRecommendationsPayload(payload, includeAdult);
    },
    getTrendingMedia(options) {
      return this.getTrending(options);
    },
    getPopularMedia(options) {
      return this.getPopular(options);
    },
    getMediaRecommendations(options) {
      return this.getRecommendations(options);
    },
    async getMediaDetails({ providerId, includeAdult = true } = {}) {
      if (typeof providerId !== 'string' || !/^[1-9]\d*$/.test(providerId.trim())) {
        throw invalidResponse();
      }

      const controller = new AbortController();
      let timedOut = false;
      let timeoutHandle;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new ProviderError(PROVIDER_ERROR_CODES.TIMEOUT, PROVIDER_ERROR_MESSAGES[PROVIDER_ERROR_CODES.TIMEOUT]));
        }, timeoutMs);
      });

      try {
        const requestResult = await Promise.race([
          Promise.resolve().then(() => request(endpoint, {
            method: 'POST',
            headers: {
              accept: 'application/json',
              'content-type': 'application/json'
            },
            body: JSON.stringify({
              query: DETAILS_GRAPHQL_QUERY,
              variables: { id: Number(providerId) }
            }),
            signal: controller.signal
          })),
          timeoutPromise
        ]);

        if (!requestResult || typeof requestResult !== 'object') throw invalidResponse();
        const status = requestResult.status;
        if ((status !== undefined && (status < 200 || status >= 300)) || requestResult.ok === false) {
          throw errorForStatus(status);
        }
        if (typeof requestResult.json !== 'function') throw invalidResponse();

        let payload;
        try {
          payload = await requestResult.json();
        } catch {
          throw invalidResponse();
        }
        const media = normalizeDetailsPayload(payload);
        if (!includeAdult && media.isAdult === true) {
          throw new ProviderError(PROVIDER_ERROR_CODES.NOT_FOUND, PROVIDER_ERROR_MESSAGES[PROVIDER_ERROR_CODES.NOT_FOUND]);
        }
        return media;
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        if (timedOut || error?.name === 'AbortError') {
          throw new ProviderError(PROVIDER_ERROR_CODES.TIMEOUT, PROVIDER_ERROR_MESSAGES[PROVIDER_ERROR_CODES.TIMEOUT]);
        }
        throw new ProviderError(PROVIDER_ERROR_CODES.ERROR, PROVIDER_ERROR_MESSAGES[PROVIDER_ERROR_CODES.ERROR]);
      } finally {
        clearTimeout(timeoutHandle);
      }
    }
  };
}
