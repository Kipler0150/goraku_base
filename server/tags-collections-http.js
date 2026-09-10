import express from 'express';
import { createRequireSessionMiddleware } from './auth-http.js';
import {
  LibraryConflictError,
  LibraryValidationError,
  normalizeUserOwnedName
} from './library.js';

const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 50;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TRACKING_UNAVAILABLE = {
  code: 'TRACKING_UNAVAILABLE',
  message: 'Tracking storage is currently unavailable.',
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
  sendError(response, 400, { code: 'VALIDATION_ERROR', message, details });
}

function notFound(response) {
  sendError(response, 404, {
    code: 'NOT_FOUND',
    message: 'The requested resource was not found.',
    details: []
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateNameBody(body) {
  if (!isPlainObject(body)) {
    return { details: [{ field: 'body', message: 'The body must be a JSON object.' }] };
  }

  const details = Object.keys(body)
    .filter((field) => field !== 'name')
    .map((field) => ({ field, message: 'Unknown field.' }));
  if (!Object.hasOwn(body, 'name')) {
    details.push({ field: 'name', message: 'This field is required.' });
  } else {
    try {
      normalizeUserOwnedName(body.name);
    } catch (error) {
      details.push(...(error.details ?? [{ field: 'name', message: error.message }]));
    }
  }

  return details.length > 0 ? { details } : { value: { name: normalizeUserOwnedName(body.name).name } };
}

function validatePagination(query) {
  const listQuery = query && typeof query === 'object' ? query : {};
  const details = [];
  for (const [field, value] of Object.entries(listQuery)) {
    if (!['page', 'perPage'].includes(field)) details.push({ field, message: 'Unknown query parameter.' });
    if (Array.isArray(value)) details.push({ field, message: 'Query parameters may only appear once.' });
  }

  const positiveInteger = (field, defaultValue, maximum) => {
    if (!Object.hasOwn(listQuery, field)) return defaultValue;
    const value = listQuery[field];
    if (Array.isArray(value) || typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return undefined;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || (maximum !== undefined && parsed > maximum)) return undefined;
    return parsed;
  };

  const page = positiveInteger('page', DEFAULT_PAGE);
  const perPage = positiveInteger('perPage', DEFAULT_PER_PAGE, MAX_PER_PAGE);
  if (page === undefined) details.push({ field: 'page', message: 'page must be a positive decimal integer.' });
  if (perPage === undefined) details.push({ field: 'perPage', message: `perPage must be a positive decimal integer from 1 to ${MAX_PER_PAGE}.` });
  return details.length > 0 ? { details } : { value: { page, perPage } };
}

function validatePathId(response, field, id) {
  if (UUID_PATTERN.test(id)) return false;
  sendValidationError(response, [{ field, message: `${field} must be a valid UUID.` }], 'The request path is invalid.');
  return true;
}

function repositoryAvailable(repository, method) {
  return repository && typeof repository[method] === 'function';
}

function handleRepositoryError(response, error, resource = 'resource') {
  if (error instanceof LibraryConflictError || error?.code === 'CONFLICT') {
    sendError(response, 409, {
      code: 'CONFLICT',
      message: `The ${resource} name is already in use.`,
      details: []
    });
    return;
  }
  if (error instanceof LibraryValidationError || error?.code === 'VALIDATION_ERROR') {
    sendValidationError(response, error.details ?? [], error.message);
    return;
  }
  sendError(response, 503, TRACKING_UNAVAILABLE);
}

function validateEmptyBody(request, response) {
  const contentLength = Number.parseInt(request.headers['content-length'] ?? '', 10);
  const hasBody = request.body !== undefined
    || (Number.isSafeInteger(contentLength) && contentLength > 0)
    || typeof request.headers['transfer-encoding'] === 'string';
  if (!hasBody) return false;
  sendValidationError(response, [{ field: 'body', message: 'This route does not accept a request body.' }]);
  return true;
}

function addResourceRoutes(router, { repository, resource, path, label, requireSession }) {
  router.get(`/${path}`, requireSession, async (request, response) => {
    if (!repositoryAvailable(repository, `list${label}s`)) {
      sendError(response, 503, TRACKING_UNAVAILABLE);
      return;
    }
    const validation = validatePagination(request.query);
    if (validation.details) {
      sendValidationError(response, validation.details, 'The request query parameters are invalid.');
      return;
    }
    try {
      response.status(200).json(await repository[`list${label}s`]({ userId: request.user.id, ...validation.value }));
    } catch (error) {
      handleRepositoryError(response, error, resource);
    }
  });

  router.post(`/${path}`, requireSession, async (request, response) => {
    if (!repositoryAvailable(repository, `create${label}`)) {
      sendError(response, 503, TRACKING_UNAVAILABLE);
      return;
    }
    const validation = validateNameBody(request.body);
    if (validation.details) {
      sendValidationError(response, validation.details);
      return;
    }
    try {
      const created = await repository[`create${label}`]({ userId: request.user.id, ...validation.value });
      response.location(`/api/${path}/${created.id}`).status(201).json(created);
    } catch (error) {
      handleRepositoryError(response, error, resource);
    }
  });

  router.patch(`/${path}/:id`, requireSession, async (request, response) => {
    if (validatePathId(response, 'id', request.params.id)) return;
    if (!repositoryAvailable(repository, `update${label}`)) {
      sendError(response, 503, TRACKING_UNAVAILABLE);
      return;
    }
    const validation = validateNameBody(request.body);
    if (validation.details) {
      sendValidationError(response, validation.details);
      return;
    }
    try {
      const updated = await repository[`update${label}`]({ userId: request.user.id, id: request.params.id, ...validation.value });
      if (!updated) {
        notFound(response);
        return;
      }
      response.status(200).json(updated);
    } catch (error) {
      handleRepositoryError(response, error, resource);
    }
  });

  router.delete(`/${path}/:id`, requireSession, async (request, response) => {
    if (validatePathId(response, 'id', request.params.id)) return;
    if (!repositoryAvailable(repository, `remove${label}`)) {
      sendError(response, 503, TRACKING_UNAVAILABLE);
      return;
    }
    try {
      const removed = await repository[`remove${label}`]({ userId: request.user.id, id: request.params.id });
      if (!removed) {
        notFound(response);
        return;
      }
      response.status(204).end();
    } catch (error) {
      handleRepositoryError(response, error, resource);
    }
  });
}

/**
 * Build authenticated routes for private Tags, Collections, and memberships.
 *
 * @param {{ tagsCollectionsRepository?: object, authService?: object, cookieName?: string }} options
 */
export function createTagsCollectionsRouter({ tagsCollectionsRepository, authService, cookieName } = {}) {
  const router = express.Router();
  const requireSession = createRequireSessionMiddleware({ authService, cookieName });

  addResourceRoutes(router, { repository: tagsCollectionsRepository, resource: 'Tag', path: 'tags', label: 'Tag', requireSession });
  addResourceRoutes(router, { repository: tagsCollectionsRepository, resource: 'Collection', path: 'collections', label: 'Collection', requireSession });

  const membershipRoute = (resource, label, path, attachMethod, detachMethod) => {
    router.put(`/library/:libraryItemId/${path}/:${resource}Id`, requireSession, async (request, response) => {
      if (validatePathId(response, 'libraryItemId', request.params.libraryItemId) || validatePathId(response, `${resource}Id`, request.params[`${resource}Id`])) return;
      if (validateEmptyBody(request, response)) return;
      if (!repositoryAvailable(tagsCollectionsRepository, attachMethod)) {
        sendError(response, 503, TRACKING_UNAVAILABLE);
        return;
      }
      try {
        const attached = await tagsCollectionsRepository[attachMethod]({
          userId: request.user.id,
          libraryItemId: request.params.libraryItemId,
          resourceId: request.params[`${resource}Id`]
        });
        if (!attached) {
          notFound(response);
          return;
        }
        response.status(204).end();
      } catch (error) {
        handleRepositoryError(response, error, label);
      }
    });

    router.delete(`/library/:libraryItemId/${path}/:${resource}Id`, requireSession, async (request, response) => {
      if (validatePathId(response, 'libraryItemId', request.params.libraryItemId) || validatePathId(response, `${resource}Id`, request.params[`${resource}Id`])) return;
      if (validateEmptyBody(request, response)) return;
      if (!repositoryAvailable(tagsCollectionsRepository, detachMethod)) {
        sendError(response, 503, TRACKING_UNAVAILABLE);
        return;
      }
      try {
        const detached = await tagsCollectionsRepository[detachMethod]({
          userId: request.user.id,
          libraryItemId: request.params.libraryItemId,
          resourceId: request.params[`${resource}Id`]
        });
        if (!detached) {
          notFound(response);
          return;
        }
        response.status(204).end();
      } catch (error) {
        handleRepositoryError(response, error, label);
      }
    });
  };

  membershipRoute('tag', 'Tag', 'tags', 'attachTag', 'detachTag');
  membershipRoute('collection', 'Collection', 'collections', 'attachCollection', 'detachCollection');

  return router;
}
