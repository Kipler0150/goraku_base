import express from 'express';
import { createAniListAdapter } from './providers/anilist.js';
import { createMyAnimeListAdapter } from './providers/myanimelist.js';
import { createTMDBAdapter } from './providers/tmdb.js';
import { createRAWGAdapter } from './providers/rawg.js';
import {
  createMediaSearchService,
  formatProviderFailure,
  MEDIA_SEARCH_TYPES,
  providersUnavailable
} from './media-search.js';

const NOT_FOUND_ERROR = {
  code: 'NOT_FOUND',
  message: 'The requested resource was not found.',
  details: []
};

const SEARCH_QUERY_FIELDS = new Set(['type', 'q', 'page', 'perPage', 'includeAdult', 'provider']);

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
    details.push({ field: 'type', message: 'type is required and must be exactly "anime", "movie", "tv", or "game".' });
  } else if (!validType) {
    details.push({ field: 'type', message: 'type must be exactly "anime", "movie", "tv", or "game".' });
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
    const providers = searchQuery.type === 'anime'
      ? ['anilist', 'myanimelist']
      : searchQuery.type === 'game' ? ['rawg'] : ['tmdb'];
    if (!hasSingleValue('provider') || !providers.includes(searchQuery.provider)) {
      details.push({ field: 'provider', message: `provider must be ${providers.join(' or ')}.` });
    } else {
      provider = searchQuery.provider;
    }
  }

  if (details.length > 0) return validationError(details);
  return {
    query: trimmedQuery,
    page,
    perPage,
    includeAdult,
    type: searchQuery.type,
    provider
  };
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
  anilistAdapter = createAniListAdapter(),
  myanimelistAdapter = createMyAnimeListAdapter(),
  tmdbAdapter = createTMDBAdapter(),
  rawgAdapter = createRAWGAdapter()
} = {}) {
  const app = express();
  const mediaSearch = createMediaSearchService({ anilistAdapter, myanimelistAdapter, tmdbAdapter, rawgAdapter });

  app.disable('x-powered-by');
  app.use(express.json());

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
      if (error?.combined) {
        combinedFailureResponse(response, error.mediaType ?? validated.type);
        return;
      }
      const defaultProvider = validated.type === 'anime' ? 'anilist' : validated.type === 'game' ? 'rawg' : 'tmdb';
      providerFailureResponse(response, error, error?.provider ?? validated.provider ?? defaultProvider);
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
