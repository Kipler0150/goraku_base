import express from 'express';
import { createAuthService } from './auth.js';
import { createLibraryRepository } from './library.js';
import { createTagsCollectionsRepository } from './tags-collections.js';
import {
  createAuthRouter,
  createMutationOriginMiddleware,
  DEFAULT_APP_ORIGIN
} from './auth-http.js';
import { createAniListAdapter } from './providers/anilist.js';
import { createMyAnimeListAdapter } from './providers/myanimelist.js';
import { createTMDBAdapter } from './providers/tmdb.js';
import { createTheGamesDBAdapter } from './providers/thegamesdb.js';
import { createRAWGAdapter } from './providers/rawg.js';
import {
  createMediaSearchService,
  formatProviderFailure,
  MEDIA_SEARCH_TYPES,
  providersUnavailable
} from './media-search.js';
import { getProvidersForType, PROVIDER_CAPABILITY_MATRIX } from './media-capabilities.js';
import {
  CAPABILITY_UNSUPPORTED_CODE,
  createMediaDetailsService,
  MediaCapabilityError
} from './media-details.js';
import {
  createMediaDiscoveryService,
  MediaDiscoveryCapabilityError
} from './media-discovery.js';
import { createMediaMetadataCache } from './media-cache.js';
import { createLibraryRouter } from './library-http.js';
import { createTagsCollectionsRouter } from './tags-collections-http.js';
import {
  createApplicationRateLimiter,
  readApplicationRateLimitConfig,
  resolveClientIp
} from './rate-limit.js';
import { createRuntimeSignals } from './observability.js';

const NOT_FOUND_ERROR = {
  code: 'NOT_FOUND',
  message: 'The requested resource was not found.',
  details: []
};

const SEARCH_QUERY_FIELDS = new Set(['type', 'q', 'page', 'perPage', 'includeAdult', 'provider', 'cursor', 'retryProvider']);
const MEDIA_DISCOVERY_QUERY_FIELDS = new Set(['type', 'page', 'perPage', 'includeAdult', 'provider']);
const MEDIA_DETAIL_QUERY_FIELDS = new Set(['includeAdult']);
const MEDIA_DETAIL_TYPES = new Set(['anime', 'movie', 'tv', 'game']);
const DEFAULT_DISCOVERY_PROVIDERS = Object.freeze({ anime: 'anilist', movie: 'tmdb', tv: 'tmdb', game: 'thegamesdb' });

function validationError(details) {
  return {
    status: 400,
    body: {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The request query parameters are invalid.',
        details
      }
    }
  };
}

function validateMediaSearchQuery(query) {
  const details = [];
  const searchQuery = query && typeof query === 'object' ? query : {};

  for (const [field, value] of Object.entries(searchQuery)) {
    if (!SEARCH_QUERY_FIELDS.has(field)) {
      details.push({ field, message: 'Unknown query parameter.' });
    }
    if (Array.isArray(value)) {
      details.push({ field, message: 'Query parameters may only appear once.' });
    }
  }

  const hasSingleValue = (field) => Object.hasOwn(searchQuery, field) && !Array.isArray(searchQuery[field]);

  const validType = hasSingleValue('type') && MEDIA_SEARCH_TYPES.includes(searchQuery.type);
  if (!Object.hasOwn(searchQuery, 'type')) {
    details.push({ field: 'type', message: 'type is required and must be exactly "anime", "movie", "tv", "game", or "all".' });
  } else if (!validType) {
    details.push({ field: 'type', message: 'type must be exactly "anime", "movie", "tv", "game", or "all".' });
  }

  let trimmedQuery;
  if (!hasSingleValue('q') && !Object.hasOwn(searchQuery, 'q')) {
    details.push({ field: 'q', message: 'q is required.' });
  } else if (hasSingleValue('q') && typeof searchQuery.q === 'string') {
    trimmedQuery = searchQuery.q.trim();
    if (trimmedQuery.length < 1 || trimmedQuery.length > 100) {
      details.push({ field: 'q', message: 'q must contain between 1 and 100 characters after trimming.' });
    }
  } else if (hasSingleValue('q')) {
    details.push({ field: 'q', message: 'q must contain between 1 and 100 characters after trimming.' });
  }

  const parsePositiveInteger = (field, defaultValue, maximum) => {
    if (!Object.hasOwn(searchQuery, field)) return defaultValue;
    if (!hasSingleValue(field) || typeof searchQuery[field] !== 'string' || !/^[1-9]\d*$/.test(searchQuery[field])) {
      details.push({ field, message: `${field} must be a positive decimal integer from 1 to ${maximum}.` });
      return undefined;
    }
    const value = Number(searchQuery[field]);
    if (value > maximum) {
      details.push({ field, message: `${field} must be a positive decimal integer from 1 to ${maximum}.` });
      return undefined;
    }
    return value;
  };

  const page = parsePositiveInteger('page', 1, 100);
  const perPage = parsePositiveInteger('perPage', 12, 24);

  let includeAdult = true;
  if (Object.hasOwn(searchQuery, 'includeAdult')) {
    if (!hasSingleValue('includeAdult') || typeof searchQuery.includeAdult !== 'string' || !['true', 'false'].includes(searchQuery.includeAdult)) {
      details.push({ field: 'includeAdult', message: 'includeAdult must be true or false.' });
    } else {
      includeAdult = searchQuery.includeAdult === 'true';
    }
  }

  let provider;
  if (Object.hasOwn(searchQuery, 'provider')) {
    if (searchQuery.type === 'all') {
      details.push({ field: 'provider', message: 'provider cannot be used with type "all".' });
    } else {
      const providers = getProvidersForType(searchQuery.type, 'search');
      if (!hasSingleValue('provider') || !providers.includes(searchQuery.provider)) {
        details.push({ field: 'provider', message: `provider must be ${providers.join(' or ')}.` });
      } else {
        provider = searchQuery.provider;
      }
    }
  }

  let cursor;
  if (Object.hasOwn(searchQuery, 'cursor')) {
    if (searchQuery.type !== 'all') {
      details.push({ field: 'cursor', message: 'cursor is only supported for type "all".' });
    } else if (!hasSingleValue('cursor') || typeof searchQuery.cursor !== 'string' || !searchQuery.cursor) {
      details.push({ field: 'cursor', message: 'cursor must be a non-empty continuation value.' });
    } else {
      cursor = searchQuery.cursor;
    }
  }

  let retryProvider;
  if (Object.hasOwn(searchQuery, 'retryProvider')) {
    if (searchQuery.type !== 'all') {
      details.push({ field: 'retryProvider', message: 'retryProvider is only supported for type "all".' });
    } else if (!hasSingleValue('retryProvider') || !['anilist', 'myanimelist', 'tmdb', 'thegamesdb', 'rawg'].includes(searchQuery.retryProvider)) {
      details.push({ field: 'retryProvider', message: 'retryProvider must be anilist, myanimelist, tmdb, thegamesdb, or rawg.' });
    } else {
      retryProvider = searchQuery.retryProvider;
    }
  }

  if (retryProvider && !cursor) {
    details.push({ field: 'retryProvider', message: 'retryProvider requires cursor.' });
  }

  if (details.length > 0) return validationError(details);
  return {
    query: trimmedQuery,
    page,
    perPage,
    includeAdult,
    type: searchQuery.type,
    provider,
    cursor,
    retryProvider
  };
}

function validateMediaDetailsRequest(params, query, { includePagination = false } = {}) {
  const details = [];
  const detailQuery = query && typeof query === 'object' ? query : {};
  const allowedFields = includePagination
    ? new Set(['includeAdult', 'page', 'perPage'])
    : MEDIA_DETAIL_QUERY_FIELDS;

  for (const [field, value] of Object.entries(detailQuery)) {
    if (!allowedFields.has(field)) {
      details.push({ field, message: 'Unknown query parameter.' });
    }
    if (Array.isArray(value)) {
      details.push({ field, message: 'Query parameters may only appear once.' });
    }
  }

  const provider = params?.provider;
  const type = params?.type;
  const providerKnown = typeof provider === 'string' && Object.hasOwn(PROVIDER_CAPABILITY_MATRIX, provider);
  const typeKnown = typeof type === 'string' && MEDIA_DETAIL_TYPES.has(type);

  if (!providerKnown) {
    details.push({ field: 'provider', message: 'provider must be a supported Provider.' });
  }
  if (!typeKnown) {
    details.push({ field: 'type', message: 'type must be exactly "anime", "movie", "tv", or "game".' });
  }
  if (providerKnown && typeKnown && !PROVIDER_CAPABILITY_MATRIX[provider][type]) {
    details.push({ field: 'provider', message: `provider does not support type "${type}".` });
  }

  const providerId = params?.id;
  if (typeof providerId !== 'string' || !/^[1-9]\d*$/.test(providerId)) {
    details.push({ field: 'id', message: 'id must be a positive decimal Provider ID.' });
  }

  let includeAdult = true;
  if (Object.hasOwn(detailQuery, 'includeAdult') && !Array.isArray(detailQuery.includeAdult)) {
    if (!['true', 'false'].includes(detailQuery.includeAdult)) {
      details.push({ field: 'includeAdult', message: 'includeAdult must be true or false.' });
    } else {
      includeAdult = detailQuery.includeAdult === 'true';
    }
  }

  let page = 1;
  let perPage = 12;
  if (includePagination) {
    const parsePositiveInteger = (field, defaultValue, maximum) => {
      if (!Object.hasOwn(detailQuery, field)) return defaultValue;
      if (Array.isArray(detailQuery[field])) return undefined;
      if (typeof detailQuery[field] !== 'string' || !/^[1-9]\d*$/.test(detailQuery[field])) {
        details.push({ field, message: `${field} must be a positive decimal integer from 1 to ${maximum}.` });
        return undefined;
      }
      const value = Number(detailQuery[field]);
      if (value > maximum) {
        details.push({ field, message: `${field} must be a positive decimal integer from 1 to ${maximum}.` });
        return undefined;
      }
      return value;
    };
    page = parsePositiveInteger('page', 1, 100);
    perPage = parsePositiveInteger('perPage', 12, 24);
  }

  if (details.length > 0) return validationError(details);
  return includePagination
    ? { provider, type, providerId, page, perPage, includeAdult }
    : { provider, type, providerId, includeAdult };
}

function validateMediaDiscoveryQuery(query) {
  const details = [];
  const discoveryQuery = query && typeof query === 'object' ? query : {};

  for (const [field, value] of Object.entries(discoveryQuery)) {
    if (!MEDIA_DISCOVERY_QUERY_FIELDS.has(field)) {
      details.push({ field, message: 'Unknown query parameter.' });
    }
    if (Array.isArray(value)) {
      details.push({ field, message: 'Query parameters may only appear once.' });
    }
  }

  const hasSingleValue = (field) => Object.hasOwn(discoveryQuery, field) && !Array.isArray(discoveryQuery[field]);
  const type = discoveryQuery.type;
  if (!hasSingleValue('type') || !MEDIA_DETAIL_TYPES.has(type)) {
    details.push({ field: 'type', message: 'type must be exactly "anime", "movie", "tv", or "game".' });
  }

  const parsePositiveInteger = (field, defaultValue, maximum) => {
    if (!Object.hasOwn(discoveryQuery, field)) return defaultValue;
    if (Array.isArray(discoveryQuery[field])) return undefined;
    if (typeof discoveryQuery[field] !== 'string' || !/^[1-9]\d*$/.test(discoveryQuery[field])) {
      details.push({ field, message: `${field} must be a positive decimal integer from 1 to ${maximum}.` });
      return undefined;
    }
    const value = Number(discoveryQuery[field]);
    if (value > maximum) {
      details.push({ field, message: `${field} must be a positive decimal integer from 1 to ${maximum}.` });
      return undefined;
    }
    return value;
  };

  const page = parsePositiveInteger('page', 1, 100);
  const perPage = parsePositiveInteger('perPage', 12, 24);

  let includeAdult = true;
  if (Object.hasOwn(discoveryQuery, 'includeAdult')) {
    if (!hasSingleValue('includeAdult') || typeof discoveryQuery.includeAdult !== 'string' || !['true', 'false'].includes(discoveryQuery.includeAdult)) {
      details.push({ field: 'includeAdult', message: 'includeAdult must be true or false.' });
    } else {
      includeAdult = discoveryQuery.includeAdult === 'true';
    }
  }

  let provider;
  if (Object.hasOwn(discoveryQuery, 'provider')) {
    const providers = MEDIA_DETAIL_TYPES.has(type) ? getProvidersForType(type, 'search') : [];
    if (!hasSingleValue('provider') || !providers.includes(discoveryQuery.provider)) {
      details.push({ field: 'provider', message: `provider must be ${providers.join(' or ')}.` });
    } else {
      provider = discoveryQuery.provider;
    }
  } else if (MEDIA_DETAIL_TYPES.has(type)) {
    provider = DEFAULT_DISCOVERY_PROVIDERS[type];
  }

  if (details.length > 0) return validationError(details);
  return { type, provider, page, perPage, includeAdult };
}

function sendErrorResponse(response, status, error) {
  response.status(status).json({ error: { ...error, details: [] } });
}

function providerFailureResponse(response, error, provider) {
  sendErrorResponse(response, 503, formatProviderFailure(error, provider));
}

function combinedFailureResponse(response, type) {
  sendErrorResponse(response, 503, providersUnavailable(type));
}

function discoveryFailureResponse(response, error, provider) {
  if (error instanceof MediaDiscoveryCapabilityError || error?.code === CAPABILITY_UNSUPPORTED_CODE) {
    sendErrorResponse(response, 501, {
      code: CAPABILITY_UNSUPPORTED_CODE,
      message: 'This Provider does not support the requested operation.'
    });
    return;
  }
  if (error?.code === 'PROVIDER_NOT_FOUND') {
    sendErrorResponse(response, 404, NOT_FOUND_ERROR);
    return;
  }
  providerFailureResponse(response, error, provider);
}

export function createApp({
  enableTestErrorRoute = false,
  databasePool = null,
  authService = databasePool ? createAuthService({ pool: databasePool }) : null,
  libraryRepository = databasePool ? createLibraryRepository({ pool: databasePool }) : null,
  tagsCollectionsRepository = databasePool ? createTagsCollectionsRepository({ pool: databasePool }) : null,
  appOrigin = process.env.APP_ORIGIN ?? DEFAULT_APP_ORIGIN,
  secureCookies = process.env.NODE_ENV === 'production',
  trustProxy = undefined,
  rateLimit = {},
  rateLimiter = null,
  runtimeSignals = null,
  onRuntimeEvent = null,
  anilistAdapter = createAniListAdapter(),
  myanimelistAdapter = createMyAnimeListAdapter(),
  tmdbAdapter = createTMDBAdapter(),
  thegamesdbAdapter = createTheGamesDBAdapter(),
  rawgAdapter = createRAWGAdapter(),
  mediaDetailsService = null,
  mediaDiscoveryService = null,
  mediaMetadataCache = null
} = {}) {
  const app = express();
  const signals = runtimeSignals ?? createRuntimeSignals({ onEvent: onRuntimeEvent ?? undefined });
  const recordCacheEvent = (...args) => {
    try {
      if (typeof signals.recordCacheEvent === 'function') signals.recordCacheEvent(...args);
    } catch {
      // Observability must never change request behavior.
    }
  };
  const recordProviderRequest = (...args) => {
    try {
      if (typeof signals.recordProviderRequest === 'function') signals.recordProviderRequest(...args);
    } catch {
      // Observability must never change Provider behavior.
    }
  };
  const recordRateLimitRejection = typeof signals.recordRateLimitRejection === 'function'
    ? signals.recordRateLimitRejection.bind(signals)
    : () => {};
  const requestMiddleware = typeof signals.requestMiddleware === 'function'
    ? signals.requestMiddleware.bind(signals)
    : (_request, _response, next) => next();
  const configuredTrustProxy = trustProxy === undefined ? readTrustProxy(process.env.TRUST_PROXY) : trustProxy;
  const configuredRateLimit = {
    ...readApplicationRateLimitConfig(),
    ...(rateLimit ?? {})
  };
  const applicationRateLimiter = rateLimiter ?? createApplicationRateLimiter({
    ...configuredRateLimit,
    resolveKey: configuredRateLimit.resolveKey ?? resolveClientIp,
    onRejection: recordRateLimitRejection
  });
  const mediaDiscoveryWasInjected = mediaDiscoveryService !== null;
  const mediaDetailsWasInjected = mediaDetailsService !== null;
  const cache = mediaMetadataCache ?? createMediaMetadataCache({ onEvent: recordCacheEvent });
  const mediaSearch = createMediaSearchService({
    anilistAdapter,
    myanimelistAdapter,
    tmdbAdapter,
    thegamesdbAdapter,
    rawgAdapter,
    onProviderRequest: recordProviderRequest
  });
  const mediaDetails = mediaDetailsService ?? createMediaDetailsService({
    anilistAdapter,
    myanimelistAdapter,
    tmdbAdapter,
    thegamesdbAdapter,
    rawgAdapter,
    onProviderRequest: recordProviderRequest
  });
  const mediaDiscovery = mediaDiscoveryService ?? createMediaDiscoveryService({
    anilistAdapter,
    myanimelistAdapter,
    tmdbAdapter,
    thegamesdbAdapter,
    rawgAdapter,
    onProviderRequest: recordProviderRequest
  });
  const cachedMediaResponse = ({ providerRequestFallback = false, ...context }) => cache.getOrSet({
    ...context,
    load: providerRequestFallback
      ? async () => {
        recordProviderRequest({ provider: context.provider, operation: context.operation });
        return context.load();
      }
      : context.load
  });

  app.disable('x-powered-by');
  app.set('trust proxy', configuredTrustProxy);
  app.locals.runtimeSignals = signals;
  app.locals.applicationRateLimiter = applicationRateLimiter;
  app.use('/api', createMutationOriginMiddleware({ appOrigin }));
  app.use(express.json());

  app.use('/api/auth', createAuthRouter({ authService, secureCookies }));
  app.use('/api/library', createLibraryRouter({ libraryRepository, authService }));
  app.use('/api', createTagsCollectionsRouter({ tagsCollectionsRepository, authService }));

  app.get('/api/health', (_request, response) => {
    response.status(200).json({
      status: 'ok',
      service: 'goraku-base-api'
    });
  });

  app.use('/api/media', requestMiddleware);
  app.use('/api/media', typeof applicationRateLimiter === 'function'
    ? applicationRateLimiter
    : applicationRateLimiter.middleware);

  app.get('/api/media/search', async (request, response) => {
    const validated = validateMediaSearchQuery(request.query);
    if (validated.status) {
      response.status(validated.status).json(validated.body);
      return;
    }

    try {
      const cacheProvider = validated.provider ?? DEFAULT_DISCOVERY_PROVIDERS[validated.type] ?? 'combined';
      const result = await cachedMediaResponse({
        provider: cacheProvider,
        type: validated.type,
        operation: 'search',
        request: validated,
        load: () => mediaSearch.search(validated)
      });
      response.status(200).json(result);
    } catch (error) {
      if (error?.validationDetails) {
        const validation = validationError(error.validationDetails);
        response.status(validation.status).json(validation.body);
        return;
      }
      if (error?.combined) {
        combinedFailureResponse(response, error.mediaType ?? validated.type);
        return;
      }
      const defaultProvider = validated.type === 'anime' ? 'anilist' : validated.type === 'game' ? 'thegamesdb' : 'tmdb';
      providerFailureResponse(response, error, error?.provider ?? validated.provider ?? defaultProvider);
    }
  });

  const handleDiscoveryRequest = async (operation, request, response) => {
    const validated = validateMediaDiscoveryQuery(request.query);
    if (validated.status) {
      response.status(validated.status).json(validated.body);
      return;
    }

    try {
      const cacheOperation = operation.replace(/^get/, '').toLowerCase();
      const result = await cachedMediaResponse({
        provider: validated.provider,
        type: validated.type,
        operation: cacheOperation,
        request: validated,
        providerRequestFallback: mediaDiscoveryWasInjected,
        load: () => mediaDiscovery[operation](validated)
      });
      response.status(200).json(result);
    } catch (error) {
      discoveryFailureResponse(response, error, validated.provider);
    }
  };

  app.get('/api/media/trending', (request, response) => handleDiscoveryRequest('getTrending', request, response));
  app.get('/api/media/popular', (request, response) => handleDiscoveryRequest('getPopular', request, response));
  app.get('/api/media/latest', (request, response) => handleDiscoveryRequest('getLatest', request, response));

  app.get('/api/media/:provider/:type/:id/recommendations', async (request, response) => {
    const validated = validateMediaDetailsRequest(request.params, request.query, { includePagination: true });
    if (validated.status) {
      response.status(validated.status).json(validated.body);
      return;
    }

    try {
      const result = await cachedMediaResponse({
        provider: validated.provider,
        type: validated.type,
        operation: 'recommendations',
        request: validated,
        providerRequestFallback: mediaDiscoveryWasInjected,
        load: () => mediaDiscovery.getRecommendations(validated)
      });
      response.status(200).json(result);
    } catch (error) {
      discoveryFailureResponse(response, error, validated.provider);
    }
  });

  app.get('/api/media/:provider/:type/:id', async (request, response) => {
    const validated = validateMediaDetailsRequest(request.params, request.query);
    if (validated.status) {
      response.status(validated.status).json(validated.body);
      return;
    }

    try {
      const result = await cachedMediaResponse({
        provider: validated.provider,
        type: validated.type,
        operation: 'details',
        request: validated,
        providerRequestFallback: mediaDetailsWasInjected,
        load: () => mediaDetails.getDetails(validated)
      });
      response.status(200).json(result);
    } catch (error) {
      if (error instanceof MediaCapabilityError || error?.code === CAPABILITY_UNSUPPORTED_CODE) {
        sendErrorResponse(response, 501, {
          code: CAPABILITY_UNSUPPORTED_CODE,
          message: 'This Provider does not support the requested operation.'
        });
        return;
      }
      if (error?.code === 'PROVIDER_NOT_FOUND') {
        sendErrorResponse(response, 404, NOT_FOUND_ERROR);
        return;
      }
      providerFailureResponse(response, error, validated.provider);
    }
  });

  if (enableTestErrorRoute) {
    app.get('/api/test/unexpected', () => {
      throw new Error('intentional test failure with diagnostic details');
    });
  }

  app.use((_request, _response, next) => {
    const error = new Error(NOT_FOUND_ERROR.message);
    error.status = 404;
    error.code = NOT_FOUND_ERROR.code;
    next(error);
  });

  app.use((error, _request, response, _next) => {
    if (error?.type === 'entity.parse.failed' || (error instanceof SyntaxError && error.status === 400)) {
      sendErrorResponse(response, 400, {
        code: 'VALIDATION_ERROR',
        message: 'The request body must contain valid JSON.',
        details: []
      });
      return;
    }

    if (error.status === 404) {
      response.status(404).json({ error: NOT_FOUND_ERROR });
      return;
    }

    console.error('[server] unexpected request error', error);
    response.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected server error occurred.',
        details: []
      }
    });
  });

  return app;
}

function readTrustProxy(value) {
  if (value === undefined || value === '') return false;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false' || value === '0') return false;
  if (/^\d+$/.test(String(value))) return Number(value);
  const entries = String(value).split(',').map((entry) => entry.trim()).filter(Boolean);
  return entries.length > 0 ? entries : false;
}
