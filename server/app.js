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
import { createLibraryRouter } from './library-http.js';
import { createTagsCollectionsRouter } from './tags-collections-http.js';

const NOT_FOUND_ERROR = {
  code: 'NOT_FOUND',
  message: 'The requested resource was not found.',
  details: []
};

const SEARCH_QUERY_FIELDS = new Set(['type', 'q', 'page', 'perPage', 'includeAdult', 'provider', 'cursor', 'retryProvider']);
const MEDIA_DETAIL_QUERY_FIELDS = new Set(['includeAdult']);
const MEDIA_DETAIL_TYPES = new Set(['anime', 'movie', 'tv', 'game']);

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

function validateMediaDetailsRequest(params, query) {
  const details = [];
  const detailQuery = query && typeof query === 'object' ? query : {};

  for (const [field, value] of Object.entries(detailQuery)) {
    if (!MEDIA_DETAIL_QUERY_FIELDS.has(field)) {
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

  if (details.length > 0) return validationError(details);
  return { provider, type, providerId, includeAdult };
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

export function createApp({
  enableTestErrorRoute = false,
  databasePool = null,
  authService = databasePool ? createAuthService({ pool: databasePool }) : null,
  libraryRepository = databasePool ? createLibraryRepository({ pool: databasePool }) : null,
  tagsCollectionsRepository = databasePool ? createTagsCollectionsRepository({ pool: databasePool }) : null,
  appOrigin = process.env.APP_ORIGIN ?? DEFAULT_APP_ORIGIN,
  secureCookies = process.env.NODE_ENV === 'production',
  anilistAdapter = createAniListAdapter(),
  myanimelistAdapter = createMyAnimeListAdapter(),
  tmdbAdapter = createTMDBAdapter(),
  thegamesdbAdapter = createTheGamesDBAdapter(),
  rawgAdapter = createRAWGAdapter(),
  mediaDetailsService = null
} = {}) {
  const app = express();
  const mediaSearch = createMediaSearchService({ anilistAdapter, myanimelistAdapter, tmdbAdapter, thegamesdbAdapter, rawgAdapter });
  const mediaDetails = mediaDetailsService ?? createMediaDetailsService({
    anilistAdapter,
    myanimelistAdapter,
    tmdbAdapter,
    thegamesdbAdapter,
    rawgAdapter
  });

  app.disable('x-powered-by');
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

  app.get('/api/media/search', async (request, response) => {
    const validated = validateMediaSearchQuery(request.query);
    if (validated.status) {
      response.status(validated.status).json(validated.body);
      return;
    }

    try {
      const result = await mediaSearch.search(validated);
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

  app.get('/api/media/:provider/:type/:id', async (request, response) => {
    const validated = validateMediaDetailsRequest(request.params, request.query);
    if (validated.status) {
      response.status(validated.status).json(validated.body);
      return;
    }

    try {
      const result = await mediaDetails.getDetails(validated);
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
