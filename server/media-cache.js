import { createHash } from 'node:crypto';
import { createMedia } from '../shared/media.js';
import { formatProviderFailure } from './media-search.js';
import { ProviderError } from './providers/errors.js';

export const MEDIA_CACHE_MAX_ENTRIES = 256;

export const MEDIA_CACHE_TTL_MS = Object.freeze({
  search: 60_000,
  trending: 60_000,
  popular: 60_000,
  discovery: 60_000,
  details: 300_000,
  recommendations: 300_000,
  episodes: 300_000
});

const CACHEABLE_PROVIDER_OPERATIONS = Object.freeze({
  anilist: ['search', 'details', 'trending', 'popular', 'recommendations', 'episodes'],
  myanimelist: ['search', 'details', 'trending', 'popular', 'latest', 'recommendations', 'episodes'],
  tmdb: ['search', 'details', 'trending', 'popular', 'recommendations', 'episodes'],
  thegamesdb: ['search', 'details'],
  rawg: ['search', 'details', 'popular', 'recommendations']
});

function providerPolicy(allowedOperations) {
  return Object.freeze({
    eligible: true,
    maxTtlMs: MEDIA_CACHE_TTL_MS.recommendations,
    requiresAttribution: true,
    allowedOperations: Object.freeze([...allowedOperations])
  });
}

/**
 * Explicit cache retention policy for each known Provider.
 *
 * A caller may replace this object when a Provider's public retention or
 * attribution terms change. Providers missing from a replacement policy are
 * intentionally treated as unknown and are never cached.
 */
export const DEFAULT_MEDIA_CACHE_POLICIES = Object.freeze(
  Object.fromEntries(Object.entries(CACHEABLE_PROVIDER_OPERATIONS).map(([provider, operations]) => [provider, providerPolicy(operations)]))
);

const KEY_IGNORED_FIELDS = new Set(['provider', 'type', 'operation', 'request', 'load', 'loader']);
const UNSAFE_FIELD_PATTERN = /(?:password|passwd|token|secret|credential|authorization|cookie|session|library|tracking|diagnostic|stack|personalrating|note|tag|collection|user|api[-_]?key|access[-_]?key|client[-_]?secret)/i;
const UNSAFE_RESPONSE_FIELD_PATTERN = /(?:query|password|passwd|token|secret|credential|authorization|cookie|session|library|tracking|diagnostic|stack|personalrating|note|tag|collection|user|api[-_]?key|access[-_]?key|client[-_]?secret)/i;

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalize(value, { response = false, rejectUnsafeFields = false } = {}) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'boolean') return String(value);
  if (typeof value !== 'object') return null;

  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalize(item, { response, rejectUnsafeFields }));
    return items.some((item) => item === null) ? null : `[${items.join(',')}]`;
  }
  if (!isPlainObject(value)) return null;

  const fields = Object.keys(value).sort();
  if ((response && fields.some((field) => UNSAFE_RESPONSE_FIELD_PATTERN.test(field))) ||
      (rejectUnsafeFields && fields.some((field) => UNSAFE_FIELD_PATTERN.test(field)))) return null;
  const entries = fields.map((field) => {
    const child = canonicalize(value[field], { response, rejectUnsafeFields });
    return child === null ? null : `${JSON.stringify(field)}:${child}`;
  });
  return entries.some((entry) => entry === null) ? null : `{${entries.join(',')}}`;
}

function requestFromContext(context) {
  const request = isPlainObject(context.request) ? { ...context.request } : {};
  for (const [field, value] of Object.entries(context)) {
    if (!KEY_IGNORED_FIELDS.has(field)) request[field] = value;
  }
  return request;
}

/**
 * Build an opaque key from all request-affecting values.
 *
 * Query text and opaque cursors are part of the key's identity, but the key
 * itself is a digest so those values cannot be read from cache state or
 * diagnostics. Sensitive request fields disable caching instead of being
 * retained in a key.
 */
export function createMediaMetadataCacheKey({ provider, type, operation, request, ...rest } = {}) {
  if (typeof provider !== 'string' || !provider || typeof type !== 'string' || !type ||
      typeof operation !== 'string' || !operation) return null;

  const requestValues = requestFromContext({ provider, type, operation, request, ...rest });
  if (Object.keys(requestValues).some((field) => UNSAFE_FIELD_PATTERN.test(field))) return null;

  const serialized = canonicalize(
    { provider, type, operation, request: requestValues },
    { rejectUnsafeFields: true }
  );
  if (serialized === null) return null;
  const digest = createHash('sha256').update(serialized, 'utf8').digest('hex');
  return `media:${digest}`;
}

function cloneValue(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : value;
}

function evaluateCachePolicy(policy, context, value, { checkResponse = false } = {}) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return null;

  const eligible = policy.eligible ?? true;
  if (typeof eligible === 'function' && !eligible({ ...context, response: value })) return null;
  if (eligible === false) return null;

  const maxTtlMs = policy.maxTtlMs;
  if (!Number.isFinite(maxTtlMs) || maxTtlMs <= 0) return null;

  if (Array.isArray(policy.allowedOperations) && !policy.allowedOperations.includes(context.operation)) return null;
  if (policy.restriction === false) return null;
  if (typeof policy.restriction === 'function' && !policy.restriction({ ...context, response: value })) return null;

  const operationTtlMs = MEDIA_CACHE_TTL_MS[context.operation];
  if (!Number.isFinite(operationTtlMs)) return null;

  if (checkResponse) {
    const requiresAttribution = policy.requiresAttribution ?? policy.attributionRequired ?? true;
    const attributed = ['details', 'episodes'].includes(context.operation)
      ? value?.provider === context.provider
      : value?.source === context.provider;
    if (requiresAttribution && !attributed) return null;
  }

  return Math.min(operationTtlMs, maxTtlMs);
}

const MEDIA_RESPONSE_FIELDS = new Set([
  'provider', 'providerId', 'type', 'id', 'title', 'originalTitle', 'alternativeTitles',
  'description', 'image', 'bannerImage', 'releaseDate', 'genres', 'providerRating',
  'releaseStatus', 'creators', 'isAdult', 'metadata'
]);
const LIST_RESPONSE_FIELDS = new Set(['results', 'source', 'pagination', 'providerErrors']);
const PAGINATION_FIELDS = new Set(['page', 'perPage', 'hasMore', 'providers', 'continuation']);
const PROVIDER_ERROR_FIELDS = new Set(['provider', 'code', 'message']);

function hasOnlyFields(value, fields) {
  return isPlainObject(value) && Object.keys(value).every((field) => fields.has(field));
}

function isNormalizedMedia(value) {
  if (!hasOnlyFields(value, MEDIA_RESPONSE_FIELDS)) return false;
  try {
    return canonicalize(createMedia(value)) === canonicalize(value, { response: true });
  } catch {
    return false;
  }
}

function isSafeListResponse(value) {
  if (!hasOnlyFields(value, LIST_RESPONSE_FIELDS) || !Array.isArray(value.results) ||
      typeof value.source !== 'string' || !hasOnlyFields(value.pagination, PAGINATION_FIELDS) ||
      !Array.isArray(value.providerErrors) || canonicalize(value, { response: true }) === null) return false;
  if (value.results.some((result) => !isNormalizedMedia(result))) return false;
  return value.providerErrors.every((error) => {
    if (!hasOnlyFields(error, PROVIDER_ERROR_FIELDS) ||
        typeof error.provider !== 'string' || typeof error.code !== 'string' || typeof error.message !== 'string') {
      return false;
    }
    const safeFailure = formatProviderFailure(new ProviderError(error.code), error.provider);
    return error.code === safeFailure.code && error.message === safeFailure.message;
  });
}

const EPISODE_RESPONSE_FIELDS = new Set(['provider', 'providerId', 'type', 'season', 'episodes']);
const EPISODE_FIELDS = new Set(['number', 'title', 'airDate', 'runtimeMinutes', 'image']);

function isSafeEpisodeResponse(value) {
  const expectedType = value?.provider === 'tmdb' ? 'TV' : ['anilist', 'myanimelist'].includes(value?.provider) ? 'ANIME' : null;
  if (!hasOnlyFields(value, EPISODE_RESPONSE_FIELDS) ||
      !expectedType || value.type !== expectedType ||
      typeof value.providerId !== 'string' || !/^[1-9]\d*$/.test(value.providerId) ||
      !Number.isInteger(value.season) || value.season < 1 ||
      !Array.isArray(value.episodes) || canonicalize(value, { response: true }) === null) return false;
  return value.episodes.every((episode) => (
    hasOnlyFields(episode, EPISODE_FIELDS)
    && Number.isInteger(episode.number)
    && episode.number >= 1
    && (episode.title === null || typeof episode.title === 'string')
    && (episode.airDate === null || (isPlainObject(episode.airDate) &&
      Number.isInteger(episode.airDate.year) && episode.airDate.year >= 1 &&
      (episode.airDate.month === null || (Number.isInteger(episode.airDate.month) && episode.airDate.month >= 1 && episode.airDate.month <= 12)) &&
      (episode.airDate.day === null || (Number.isInteger(episode.airDate.day) && episode.airDate.day >= 1 && episode.airDate.day <= 31))))
    && (episode.runtimeMinutes === null || (Number.isInteger(episode.runtimeMinutes) && episode.runtimeMinutes >= 0))
    && (episode.image === null || typeof episode.image === 'string')
  ));
}

function isSafeResponse(value, operation) {
  if (operation === 'details') return isNormalizedMedia(value);
  if (operation === 'episodes') return isSafeEpisodeResponse(value);
  return isSafeListResponse(value);
}

function responseProviderForCache(context, value) {
  const responseProvider = ['details', 'episodes'].includes(context.operation) ? value?.provider : value?.source;
  if (typeof responseProvider !== 'string' || !responseProvider) return null;
  if (responseProvider === context.provider) return responseProvider;

  const fallbackAllowed = context.operation === 'search' &&
    context.request?.provider == null && ['anime', 'game'].includes(context.type);
  return fallbackAllowed ? responseProvider : null;
}

function emit(onEvent, event) {
  try {
    onEvent(event);
  } catch {
    // Observability must never change cache or Provider behavior.
  }
}

/**
 * Create a bounded process-local cache for successful public Provider-owned
 * Media responses.
 *
 * @param {{maxEntries?: number, now?: () => number, policies?: object, onEvent?: (event: object) => void}} options
 */
export function createMediaMetadataCache({
  maxEntries = MEDIA_CACHE_MAX_ENTRIES,
  now = Date.now,
  policies = DEFAULT_MEDIA_CACHE_POLICIES,
  onEvent = () => {}
} = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new RangeError('maxEntries must be a positive integer.');
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function.');
  if (!policies || typeof policies !== 'object' || Array.isArray(policies)) {
    throw new TypeError('policies must be an object.');
  }
  if (typeof onEvent !== 'function') throw new TypeError('onEvent must be a function.');

  const entries = new Map();
  const inFlight = new Map();
  const stats = {
    hits: 0,
    misses: 0,
    inFlightHits: 0,
    providerRequests: 0,
    stores: 0,
    evictions: 0,
    expirations: 0,
    policyDenied: 0,
    unsafeRequests: 0
  };
  const capacity = Math.min(maxEntries, MEDIA_CACHE_MAX_ENTRIES);

  const currentTime = () => {
    const value = now();
    if (!Number.isFinite(value)) throw new TypeError('now must return a finite number.');
    return value;
  };

  const removeExpired = (time) => {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= time) {
        entries.delete(key);
        stats.expirations += 1;
      }
    }
  };

  const touch = (key, entry) => {
    entries.delete(key);
    entries.set(key, entry);
  };

  const store = (key, value, expiresAt, context) => {
    const entry = { value: cloneValue(value), expiresAt };
    entries.delete(key);
    entries.set(key, entry);
    stats.stores += 1;
    while (entries.size > capacity) {
      const oldestKey = entries.keys().next().value;
      entries.delete(oldestKey);
      stats.evictions += 1;
    }
    emit(onEvent, { type: 'store', operation: context.operation, provider: context.provider });
  };

  const getOrSet = async ({ provider, type, operation, request, load, ...rest } = {}) => {
    const loadFunction = load;
    if (typeof loadFunction !== 'function') throw new TypeError('load must be a function.');

    const context = { provider, type, operation, request, ...rest };
    const key = createMediaMetadataCacheKey(context);
    if (key === null) {
      stats.unsafeRequests += 1;
      return loadFunction();
    }

    const time = currentTime();
    const policy = evaluateCachePolicy(
      Object.hasOwn(policies, provider) ? policies[provider] : null,
      context,
      null
    );
    if (policy !== null) {
      const entry = entries.get(key);
      if (entry && entry.expiresAt > time) {
        touch(key, entry);
        stats.hits += 1;
        emit(onEvent, { type: 'hit', operation, provider });
        return cloneValue(entry.value);
      }
      if (entry) {
        entries.delete(key);
        stats.expirations += 1;
      }
    }

    const pending = inFlight.get(key);
    if (pending) {
      stats.inFlightHits += 1;
      emit(onEvent, { type: 'in-flight-hit', operation, provider });
      return pending.then(cloneValue);
    }

    stats.misses += 1;
    stats.providerRequests += 1;
    emit(onEvent, { type: 'miss', operation, provider });
    const requestPromise = Promise.resolve().then(loadFunction);
    inFlight.set(key, requestPromise);

    try {
      const value = await requestPromise;
      const responseProvider = responseProviderForCache(context, value);
      const responseContext = responseProvider ? { ...context, provider: responseProvider } : null;
      const cacheTtlMs = responseContext
        ? evaluateCachePolicy(
          Object.hasOwn(policies, responseContext.provider) ? policies[responseContext.provider] : null,
          responseContext,
          value,
          { checkResponse: true }
        )
        : null;
      if (cacheTtlMs !== null && isSafeResponse(value, operation)) {
        store(key, value, currentTime() + cacheTtlMs, responseContext);
      } else {
        stats.policyDenied += 1;
        emit(onEvent, { type: 'policy-denied', operation, provider });
      }
      return cloneValue(value);
    } finally {
      if (inFlight.get(key) === requestPromise) inFlight.delete(key);
    }
  };

  return {
    getOrSet,
    clear() {
      entries.clear();
      inFlight.clear();
    },
    getStats() {
      return { ...stats };
    },
    get size() {
      removeExpired(currentTime());
      return entries.size;
    },
    keys() {
      removeExpired(currentTime());
      return [...entries.keys()];
    }
  };
}
