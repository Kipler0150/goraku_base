import express from 'express';
import { createRequireSessionMiddleware } from './auth-http.js';
import {
  LibraryConflictError,
  LibraryValidationError,
  LIBRARY_STATUS_VALUES,
  normalizeNote,
  normalizePersonalRating
} from './library.js';

const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 50;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SUPPORTED_TYPES = Object.freeze({
  anilist: new Set(['anime']),
  myanimelist: new Set(['anime']),
  tmdb: new Set(['movie', 'tv']),
  thegamesdb: new Set(['game']),
  rawg: new Set(['game'])
});

const LIBRARY_UNAVAILABLE = {
  code: 'LIBRARY_UNAVAILABLE',
  message: 'Library storage is currently unavailable.',
  details: []
};

function sendError(response, status, error) {
  response.status(status).json({
    error: {
      code: error.code,
      message: error.message,
      details: Array.isArray(error.details) ? error.details : []
    }
  });
}

function sendValidationError(response, details, message = 'The request body is invalid.') {
  sendError(response, 400, {
    code: 'VALIDATION_ERROR',
    message,
    details
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unknownFields(body, allowedFields) {
  return Object.keys(body)
    .filter((field) => !allowedFields.has(field))
    .map((field) => ({ field, message: 'Unknown field.' }));
}

function validateLibraryIdentityBody(body) {
  if (!isPlainObject(body)) {
    return { details: [{ field: 'body', message: 'The body must be a JSON object.' }] };
  }

  const details = unknownFields(body, new Set(['provider', 'type', 'providerId']));
  for (const field of ['provider', 'type', 'providerId']) {
    if (!Object.hasOwn(body, field)) {
      details.push({ field, message: 'This field is required.' });
    }
  }

  const providerIsString = typeof body.provider === 'string';
  const typeIsString = typeof body.type === 'string';
  if (Object.hasOwn(body, 'provider') && (!providerIsString || !Object.hasOwn(SUPPORTED_TYPES, body.provider))) {
    details.push({ field: 'provider', message: 'provider must be anilist, myanimelist, tmdb, thegamesdb, or rawg.' });
  }
  if (Object.hasOwn(body, 'type') && (!typeIsString || !['anime', 'movie', 'tv', 'game'].includes(body.type))) {
    details.push({ field: 'type', message: 'type must be anime, movie, tv, or game.' });
  }
  if (providerIsString && typeIsString && Object.hasOwn(SUPPORTED_TYPES, body.provider) && !SUPPORTED_TYPES[body.provider].has(body.type)) {
    details.push({ field: 'type', message: 'type is not supported by the selected provider.' });
  }

  let providerId;
  if (Object.hasOwn(body, 'providerId')) {
    if (typeof body.providerId !== 'string') {
      details.push({ field: 'providerId', message: 'providerId must be a non-empty string of at most 200 characters.' });
    } else {
      providerId = body.providerId.trim();
      if ([...providerId].length < 1 || [...providerId].length > 200) {
        details.push({ field: 'providerId', message: 'providerId must be a non-empty string of at most 200 characters.' });
      }
    }
  }

  if (details.length > 0) return { details };
  return {
    value: {
      provider: body.provider,
      type: body.type.toUpperCase(),
      providerId
    }
  };
}

function validateLibraryPatchBody(body) {
  if (!isPlainObject(body)) {
    return { details: [{ field: 'body', message: 'The body must be a JSON object.' }] };
  }

  const details = unknownFields(body, new Set(['libraryStatus', 'favorite', 'personalRating', 'note', 'progress']));
  if (Object.keys(body).length === 0) {
    details.push({ field: 'body', message: 'At least one editable field is required.' });
  }
  if (Object.hasOwn(body, 'libraryStatus') && !LIBRARY_STATUS_VALUES.includes(body.libraryStatus)) {
    details.push({ field: 'libraryStatus', message: `libraryStatus must be one of ${LIBRARY_STATUS_VALUES.join(', ')}.` });
  }
  if (Object.hasOwn(body, 'favorite') && typeof body.favorite !== 'boolean') {
    details.push({ field: 'favorite', message: 'favorite must be a boolean.' });
  }

  const value = { ...body };
  for (const [field, normalizer] of [['personalRating', normalizePersonalRating], ['note', normalizeNote]]) {
    if (!Object.hasOwn(body, field)) continue;
    try {
      value[field] = normalizer(body[field]);
    } catch (error) {
      details.push(...(error.details ?? [{ field, message: error.message }]));
    }
  }
  if (Object.hasOwn(body, 'progress') && body.progress !== null && (typeof body.progress !== 'object' || Array.isArray(body.progress))) {
    details.push({ field: 'progress', message: 'progress must be null or a typed JSON object.' });
  }

  return details.length > 0 ? { details } : { value };
}

function validatePositiveInteger(query, field, defaultValue, maximum) {
  if (!Object.hasOwn(query, field)) return defaultValue;
  const value = query[field];
  if (Array.isArray(value) || typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || (maximum !== undefined && parsed > maximum)) return undefined;
  return parsed;
}

function validateLibraryListQuery(query) {
  const listQuery = query && typeof query === 'object' ? query : {};
  const details = [];
  for (const [field, value] of Object.entries(listQuery)) {
    if (!['page', 'perPage', 'libraryStatus', 'favorite', 'tagId', 'collectionId'].includes(field)) details.push({ field, message: 'Unknown query parameter.' });
    if (Array.isArray(value)) details.push({ field, message: 'Query parameters may only appear once.' });
  }

  const page = validatePositiveInteger(listQuery, 'page', DEFAULT_PAGE);
  if (page === undefined) details.push({ field: 'page', message: 'page must be a positive decimal integer.' });
  const perPage = validatePositiveInteger(listQuery, 'perPage', DEFAULT_PER_PAGE, MAX_PER_PAGE);
  if (perPage === undefined) details.push({ field: 'perPage', message: `perPage must be a positive decimal integer from 1 to ${MAX_PER_PAGE}.` });

  let libraryStatus;
  if (Object.hasOwn(listQuery, 'libraryStatus')) {
    if (Array.isArray(listQuery.libraryStatus) || !LIBRARY_STATUS_VALUES.includes(listQuery.libraryStatus)) {
      details.push({ field: 'libraryStatus', message: `libraryStatus must be one of ${LIBRARY_STATUS_VALUES.join(', ')}.` });
    } else {
      libraryStatus = listQuery.libraryStatus;
    }
  }

  let favorite;
  if (Object.hasOwn(listQuery, 'favorite')) {
    if (Array.isArray(listQuery.favorite) || !['true', 'false'].includes(listQuery.favorite)) {
      details.push({ field: 'favorite', message: 'favorite must be true or false.' });
    } else {
      favorite = listQuery.favorite === 'true';
    }
  }

  const filters = { tagId: undefined, collectionId: undefined };
  for (const field of ['tagId', 'collectionId']) {
    if (!Object.hasOwn(listQuery, field)) continue;
    if (Array.isArray(listQuery[field]) || typeof listQuery[field] !== 'string' || !UUID_PATTERN.test(listQuery[field])) {
      details.push({ field, message: `${field} must be a valid UUID.` });
    } else {
      filters[field] = listQuery[field];
    }
  }

  if (details.length > 0) return { details };
  const value = { page, perPage };
  if (libraryStatus !== undefined) value.libraryStatus = libraryStatus;
  if (favorite !== undefined) value.favorite = favorite;
  if (filters.tagId !== undefined) value.tagId = filters.tagId;
  if (filters.collectionId !== undefined) value.collectionId = filters.collectionId;
  return { value };
}

function repositoryAvailable(repository, method) {
  return repository && typeof repository[method] === 'function';
}

function handleRepositoryError(response, error) {
  if (error instanceof LibraryConflictError || error?.code === 'CONFLICT') {
    sendError(response, 409, {
      code: 'CONFLICT',
      message: 'The Library Item is already in the library.',
      details: []
    });
    return;
  }
  if (error instanceof LibraryValidationError || error?.code === 'VALIDATION_ERROR') {
    sendValidationError(response, error.details ?? [], error.message);
    return;
  }
  sendError(response, 503, LIBRARY_UNAVAILABLE);
}

function notFound(response) {
  sendError(response, 404, {
    code: 'NOT_FOUND',
    message: 'The requested resource was not found.',
    details: []
  });
}

function validateLibraryId(response, id) {
  if (UUID_PATTERN.test(id)) return false;
  sendValidationError(response, [{ field: 'id', message: 'id must be a valid UUID.' }], 'The request path is invalid.');
  return true;
}

/**
 * Build authenticated Library Item CRUD routes.
 *
 * @param {{ libraryRepository?: object, authService?: object, cookieName?: string }} options
 */
export function createLibraryRouter({ libraryRepository, authService, cookieName } = {}) {
  const router = express.Router();
  router.use(createRequireSessionMiddleware({ authService, cookieName }));

  router.get('/', async (request, response) => {
    if (!repositoryAvailable(libraryRepository, 'list')) {
      sendError(response, 503, LIBRARY_UNAVAILABLE);
      return;
    }
    const validation = validateLibraryListQuery(request.query);
    if (validation.details) {
      sendValidationError(response, validation.details, 'The request query parameters are invalid.');
      return;
    }

    try {
      response.status(200).json(await libraryRepository.list({ userId: request.user.id, ...validation.value }));
    } catch (error) {
      handleRepositoryError(response, error);
    }
  });

  router.post('/', async (request, response) => {
    if (!repositoryAvailable(libraryRepository, 'create')) {
      sendError(response, 503, LIBRARY_UNAVAILABLE);
      return;
    }
    const validation = validateLibraryIdentityBody(request.body);
    if (validation.details) {
      sendValidationError(response, validation.details);
      return;
    }

    try {
      const item = await libraryRepository.create({ userId: request.user.id, ...validation.value });
      response.location(`/api/library/${item.id}`).status(201).json(item);
    } catch (error) {
      handleRepositoryError(response, error);
    }
  });

  router.patch('/:id', async (request, response) => {
    if (validateLibraryId(response, request.params.id)) return;
    if (!repositoryAvailable(libraryRepository, 'update')) {
      sendError(response, 503, LIBRARY_UNAVAILABLE);
      return;
    }
    const validation = validateLibraryPatchBody(request.body);
    if (validation.details) {
      sendValidationError(response, validation.details);
      return;
    }

    try {
      const item = await libraryRepository.update({ userId: request.user.id, id: request.params.id, changes: validation.value });
      if (!item) {
        notFound(response);
        return;
      }
      response.status(200).json(item);
    } catch (error) {
      handleRepositoryError(response, error);
    }
  });

  router.delete('/:id', async (request, response) => {
    if (validateLibraryId(response, request.params.id)) return;
    if (!repositoryAvailable(libraryRepository, 'remove')) {
      sendError(response, 503, LIBRARY_UNAVAILABLE);
      return;
    }

    try {
      const removed = await libraryRepository.remove({ userId: request.user.id, id: request.params.id });
      if (!removed) {
        notFound(response);
        return;
      }
      response.status(204).end();
    } catch (error) {
      handleRepositoryError(response, error);
    }
  });

  return router;
}
