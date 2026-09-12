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
  query SearchAnime($search: String!, $page: Int!, $perPage: Int!, $includeAdult: Boolean!, $genres: [String], $averageScoreGreater: Int, $mediaIds: [Int], $sort: [MediaSort]) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { currentPage perPage hasNextPage }
      media(search: $search, type: ANIME, isAdult: $includeAdult, genre_in: $genres, averageScore_greater: $averageScoreGreater, id_in: $mediaIds, sort: $sort) {
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

const FILTER_OPTIONS_QUERY = `
  query AnimeFilterOptions($creatorQuery: String, $page: Int!, $perPage: Int!) {
    GenreCollection
    Page(page: $page, perPage: $perPage) {
      staff(search: $creatorQuery) {
        nodes { id name { full } }
      }
    }
  }
`;

const STAFF_MEDIA_QUERY = `
  query StaffAnime($id: Int!, $page: Int!, $perPage: Int!) {
    Staff(id: $id) {
      staffMedia(type: ANIME, page: $page, perPage: $perPage) {
        pageInfo { currentPage perPage hasNextPage }
        nodes { id }
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

const EPISODES_GRAPHQL_QUERY = `
  query AnimeEpisodes($id: Int, $idMal: Int, $page: Int!, $perPage: Int!, $notYetAired: Boolean!) {
    Media(id: $id, idMal: $idMal, type: ANIME) {
      episodes
      status
      airingSchedule(page: $page, perPage: $perPage, notYetAired: $notYetAired) {
        pageInfo { currentPage perPage hasNextPage }
        nodes { episode airingAt }
      }
    }
  }
`;

const EPISODE_PAGE_SIZE = 25;
const MAX_EPISODE_PAGES = 200;
const MAX_EPISODES = 10_000;

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

function normalizeFilterOptions(payload, creatorQuery) {
  const root = assertObject(payload);
  if (Object.prototype.hasOwnProperty.call(root, 'errors')) throw new ProviderError(PROVIDER_ERROR_CODES.ERROR, 'AniList returned a provider error.');
  const data = assertObject(root.data);
  const genres = normalizeStringList(data.GenreCollection).map((name) => ({ id: name, label: name }));
  const page = assertObject(data.Page);
  const staff = page.staff == null ? { nodes: [] } : assertObject(page.staff);
  if (!Array.isArray(staff.nodes)) throw invalidResponse();
  const creators = creatorQuery
    ? staff.nodes.map((entry) => {
        const item = assertObject(entry);
        if (!Number.isInteger(item.id) || item.id < 1) throw invalidResponse();
        const name = assertObject(item.name);
        const label = nullableString(name.full);
        if (!label) throw invalidResponse();
        return { id: String(item.id), label };
      })
    : [];
  return { genres, creators, rating: { field: 'minRating', label: 'Minimum Provider Rating', max: 10, step: 0.5 } };
}

function normalizeStaffMediaPayload(payload, page) {
  const root = assertObject(payload);
  if (Object.prototype.hasOwnProperty.call(root, 'errors')) throw new ProviderError(PROVIDER_ERROR_CODES.ERROR, 'AniList returned a provider error.');
  const staff = assertObject(assertObject(root.data).Staff);
  const connection = assertObject(staff.staffMedia);
  const pageInfo = assertObject(connection.pageInfo);
  if (pageInfo.currentPage !== page || !Number.isInteger(pageInfo.perPage) || typeof pageInfo.hasNextPage !== 'boolean' || !Array.isArray(connection.nodes)) throw invalidResponse();
  return { pageInfo, ids: connection.nodes.map((entry) => {
    const item = assertObject(entry);
    if (!Number.isInteger(item.id) || item.id < 1) throw invalidResponse();
    return item.id;
  }) };
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

function normalizeEpisodePagePayload(payload) {
  const root = assertObject(payload);
  if (Object.prototype.hasOwnProperty.call(root, 'errors')) {
    if (!Array.isArray(root.errors)) throw invalidResponse();
    throw new ProviderError(PROVIDER_ERROR_CODES.ERROR, 'AniList returned a provider error.');
  }
  const data = assertObject(root.data);
  if (data.Media == null) {
    throw new ProviderError(PROVIDER_ERROR_CODES.NOT_FOUND, PROVIDER_ERROR_MESSAGES[PROVIDER_ERROR_CODES.NOT_FOUND]);
  }
  const media = assertObject(data.Media);
  const episodeCount = media.episodes == null ? null : media.episodes;
  if (episodeCount !== null && (!Number.isInteger(episodeCount) || episodeCount < 0 || episodeCount > MAX_EPISODES)) {
    throw invalidResponse();
  }
  if (media.status != null && typeof media.status !== 'string') throw invalidResponse();

  const schedule = assertObject(media.airingSchedule);
  const pageInfo = assertObject(schedule.pageInfo);
  if (!Number.isInteger(pageInfo.currentPage) || pageInfo.currentPage < 1 ||
      !Number.isInteger(pageInfo.perPage) || pageInfo.perPage < 1 ||
      typeof pageInfo.hasNextPage !== 'boolean' || !Array.isArray(schedule.nodes)) {
    throw invalidResponse();
  }

  const nodes = schedule.nodes.map((value) => {
    const node = assertObject(value);
    if (!Number.isInteger(node.episode) || node.episode < 1 || node.episode > MAX_EPISODES ||
        !Number.isInteger(node.airingAt) || node.airingAt < 0) {
      throw invalidResponse();
    }
    return { episode: node.episode, airingAt: node.airingAt };
  });

  return {
    episodeCount,
    status: media.status ?? null,
    pageInfo,
    nodes
  };
}

function episodeAirDate(airingAt) {
  const date = new Date(airingAt * 1000);
  if (Number.isNaN(date.getTime())) throw invalidResponse();
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function validateEpisodeLookup({ provider, providerId, season }) {
  const normalizedProvider = typeof provider === 'string' ? provider.trim().toLowerCase() : '';
  if (!['anilist', 'myanimelist'].includes(normalizedProvider) ||
      typeof providerId !== 'string' || !/^[1-9]\d*$/.test(providerId.trim()) ||
      !Number.isInteger(season) || season !== 1) {
    throw invalidResponse();
  }
  return { provider: normalizedProvider, providerId: providerId.trim(), season };
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
  timeoutMs = ANILIST_TIMEOUT_MS,
  clock = Date.now
} = {}) {
  if (typeof request !== 'function') throw new TypeError('An HTTP request function is required.');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('timeoutMs must be positive.');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function.');

  const validateDiscoveryOptions = ({ page = 1, perPage = 12, includeAdult = true } = {}) => {
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(perPage) || perPage < 1 || typeof includeAdult !== 'boolean') {
      throw invalidResponse();
    }
    return { page, perPage, includeAdult };
  };

  const graphQLRequest = (query, variables, errorStatus = false) => requestProviderJson({
    request,
    url: endpoint,
    timeoutMs,
    options: {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables })
    },
    invalidResponse,
    errorForStatus: (status) => errorForStatus(status, errorStatus)
  });

  const resolveStaffMediaIds = async (creatorId) => {
    const ids = [];
    let page = 1;
    let hasNextPage = true;
    while (hasNextPage && page <= 40) {
      const payload = await graphQLRequest(STAFF_MEDIA_QUERY, { id: Number(creatorId), page, perPage: 50 });
      const result = normalizeStaffMediaPayload(payload, page);
      ids.push(...result.ids);
      hasNextPage = result.pageInfo.hasNextPage;
      page += 1;
    }
    if (hasNextPage) throw invalidResponse();
    return [...new Set(ids)].slice(0, 2_000);
  };

  return {
    async searchMedia({ query, page = 1, perPage = 12, includeAdult = true, filters = null } = {}) {
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
        const mediaIds = filters?.creator ? await resolveStaffMediaIds(filters.creator) : null;
        if (mediaIds && mediaIds.length === 0) {
          return { results: [], pagination: { page, perPage, hasMore: false } };
        }
        const variables = { search: query, page, perPage, includeAdult };
        if (filters?.genres?.length) variables.genres = filters.genres;
        if (Number.isFinite(filters?.minRating)) variables.averageScoreGreater = Math.round(filters.minRating * 10);
        if (mediaIds) variables.mediaIds = mediaIds;
        if (!query.trim()) variables.sort = ['START_DATE_DESC'];
        const requestResult = await Promise.race([
          Promise.resolve().then(() => request(endpoint, {
            method: 'POST',
            headers: {
              accept: 'application/json',
              'content-type': 'application/json'
            },
            body: JSON.stringify({
              query: GRAPHQL_QUERY,
              variables
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
    async getFilterOptions({ type = 'anime', creatorQuery = '', includeAdult = true } = {}) {
      if (type !== 'anime' || typeof creatorQuery !== 'string' || typeof includeAdult !== 'boolean') throw invalidResponse();
      const payload = await graphQLRequest(FILTER_OPTIONS_QUERY, {
        creatorQuery: creatorQuery.trim() || null,
        page: 1,
        perPage: 10
      }, true);
      return normalizeFilterOptions(payload, creatorQuery.trim());
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
    async getLatest({ page = 1, perPage = 12, includeAdult = true } = {}) {
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
            variables: { ...options, sort: ['START_DATE_DESC'] }
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
    async getSeasonEpisodes({ provider = 'anilist', providerId, season = 1 } = {}) {
      const lookup = validateEpisodeLookup({ provider, providerId, season });
      const now = clock();
      if (!Number.isFinite(now)) throw invalidResponse();

      const variables = {
        page: 1,
        perPage: EPISODE_PAGE_SIZE,
        notYetAired: false
      };
      if (lookup.provider === 'anilist') variables.id = Number(lookup.providerId);
      else variables.idMal = Number(lookup.providerId);
      const released = new Map();
      let episodeCount = null;
      let status = null;
      let hasNextPage = true;
      let page = 1;

      while (hasNextPage) {
        const payload = await requestProviderJson({
          request,
          url: endpoint,
          timeoutMs,
          options: {
            method: 'POST',
            headers: { accept: 'application/json', 'content-type': 'application/json' },
            body: JSON.stringify({
              query: EPISODES_GRAPHQL_QUERY,
              variables: { ...variables, page }
            })
          },
          invalidResponse,
          errorForStatus: (responseStatus) => errorForStatus(responseStatus)
        });
        const result = normalizeEpisodePagePayload(payload);
        if (result.pageInfo.currentPage !== page) throw invalidResponse();
        episodeCount ??= result.episodeCount;
        status ??= result.status;
        for (const node of result.nodes) {
          if (node.airingAt > Math.floor(now / 1000) || released.has(node.episode)) continue;
          released.set(node.episode, episodeAirDate(node.airingAt));
        }
        hasNextPage = result.pageInfo.hasNextPage;
        page += 1;
        if (hasNextPage && page > MAX_EPISODE_PAGES) throw invalidResponse();
      }

      const maxReleasedEpisode = Math.max(0, ...released.keys());
      const completeEpisodeCount = status === 'FINISHED' && episodeCount != null ? episodeCount : maxReleasedEpisode;
      const totalEpisodes = Math.max(maxReleasedEpisode, completeEpisodeCount);
      const episodes = Array.from({ length: totalEpisodes }, (_, index) => {
        const number = index + 1;
        return {
          number,
          title: `Episode ${number}`,
          airDate: released.get(number) ?? null,
          runtimeMinutes: null,
          image: null
        };
      });

      return {
        provider: lookup.provider,
        providerId: lookup.providerId,
        type: 'ANIME',
        season: lookup.season,
        episodes
      };
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
