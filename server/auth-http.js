import express from 'express';
import {
  AuthConflictError,
  AuthValidationError,
  SESSION_TTL_MS
} from './auth.js';

export const DEFAULT_APP_ORIGIN = 'http://localhost:5173';
export const SESSION_COOKIE_NAME = 'goraku_session';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const AUTHENTICATION_UNAVAILABLE = {
  code: 'AUTHENTICATION_UNAVAILABLE',
  message: 'Authentication is currently unavailable.',
  details: []
};

const INVALID_CREDENTIALS = {
  code: 'INVALID_CREDENTIALS',
  message: 'The email or password is invalid.',
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

function sendValidationError(response, details = [], message = 'The request body is invalid.') {
  sendError(response, 400, {
    code: 'VALIDATION_ERROR',
    message,
    details
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateCredentialBody(body) {
  if (!isPlainObject(body)) {
    return { details: [{ field: 'body', message: 'The body must be a JSON object.' }] };
  }

  const details = [];
  for (const field of Object.keys(body)) {
    if (field !== 'email' && field !== 'password') {
      details.push({ field, message: 'Unknown field.' });
    }
  }
  for (const field of ['email', 'password']) {
    if (!Object.hasOwn(body, field)) {
      details.push({ field, message: 'This field is required.' });
    } else if (typeof body[field] !== 'string') {
      details.push({ field, message: 'This field must be a string.' });
    }
  }

  return details.length > 0 ? { details } : { value: body };
}

function resolveAppOrigin(appOrigin) {
  if (typeof appOrigin !== 'string' || appOrigin.trim().length === 0) {
    throw new TypeError('APP_ORIGIN must be an absolute HTTP or HTTPS origin.');
  }

  let parsed;
  try {
    parsed = new URL(appOrigin);
  } catch {
    throw new TypeError('APP_ORIGIN must be an absolute HTTP or HTTPS origin.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
      parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new TypeError('APP_ORIGIN must be an absolute HTTP or HTTPS origin.');
  }
  return parsed.origin;
}

function getCookieValue(cookieHeader, cookieName) {
  if (typeof cookieHeader !== 'string') return null;

  for (const entry of cookieHeader.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0 || entry.slice(0, separator).trim() !== cookieName) continue;
    const value = entry.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value) || null;
    } catch {
      return null;
    }
  }
  return null;
}

function sessionCookieValue(token, { cookieName, secure }) {
  const attributes = [
    `Path=/`,
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    'HttpOnly',
    'SameSite=Lax'
  ];
  if (secure) attributes.push('Secure');
  return `${cookieName}=${encodeURIComponent(token)}; ${attributes.join('; ')}`;
}

function expiredSessionCookieValue({ cookieName, secure }) {
  const attributes = ['Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Lax'];
  if (secure) attributes.push('Secure');
  return `${cookieName}=; ${attributes.join('; ')}`;
}

function setSessionCookie(response, token, options) {
  response.setHeader('Set-Cookie', sessionCookieValue(token, options));
}

function clearSessionCookie(response, options) {
  response.setHeader('Set-Cookie', expiredSessionCookieValue(options));
}

function publicUser(user) {
  if (!user || typeof user.id !== 'string' || typeof user.email !== 'string') return null;
  return { id: user.id, email: user.email };
}

function sessionContext(result) {
  const user = publicUser(result?.user);
  if (!user || !result?.session || typeof result.session !== 'object') return null;

  return {
    user,
    session: {
      id: result.session.id,
      userId: result.session.userId,
      expiresAt: result.session.expiresAt,
      createdAt: result.session.createdAt
    }
  };
}

function isAuthValidationError(error) {
  return error instanceof AuthValidationError || error?.code === 'VALIDATION_ERROR';
}

function isAuthConflictError(error) {
  return error instanceof AuthConflictError || error?.code === 'CONFLICT';
}

function handleServiceError(response, error) {
  if (isAuthValidationError(error)) {
    sendValidationError(response, [], error.message);
    return;
  }
  if (isAuthConflictError(error)) {
    sendError(response, 409, {
      code: 'CONFLICT',
      message: 'Registration could not be completed.',
      details: []
    });
    return;
  }
  sendError(response, 503, AUTHENTICATION_UNAVAILABLE);
}

/**
 * Validate the browser Origin for every API mutation.
 *
 * @param {{ appOrigin?: string }} [options]
 * @returns {import('express').RequestHandler}
 */
export function createMutationOriginMiddleware({ appOrigin = process.env.APP_ORIGIN ?? DEFAULT_APP_ORIGIN } = {}) {
  const expectedOrigin = resolveAppOrigin(appOrigin);

  return (request, response, next) => {
    if (!MUTATION_METHODS.has(request.method)) {
      next();
      return;
    }

    if (request.headers.origin !== expectedOrigin) {
      sendError(response, 403, {
        code: 'ORIGIN_FORBIDDEN',
        message: 'The request Origin is not allowed.',
        details: []
      });
      return;
    }
    next();
  };
}

/**
 * Resolve the authenticated User from the opaque Session cookie.
 * The cookie token is never copied onto the request context supplied to
 * protected route handlers.
 *
 * @param {{ authService?: ReturnType<import('./auth.js').createAuthService>, cookieName?: string }} [options]
 * @returns {import('express').RequestHandler}
 */
export function createRequireSessionMiddleware({ authService, cookieName = SESSION_COOKIE_NAME } = {}) {
  return async (request, response, next) => {
    if (!authService || typeof authService.getSession !== 'function') {
      sendError(response, 503, AUTHENTICATION_UNAVAILABLE);
      return;
    }

    const token = getCookieValue(request.headers.cookie, cookieName);
    if (!token) {
      sendError(response, 401, {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication is required.',
        details: []
      });
      return;
    }

    try {
      const result = sessionContext(await authService.getSession(token));
      if (!result) {
        sendError(response, 401, {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required.',
          details: []
        });
        return;
      }

      request.user = result.user;
      next();
    } catch {
      sendError(response, 503, AUTHENTICATION_UNAVAILABLE);
    }
  };
}

function unavailableIfMissingService(response, authService, method) {
  if (authService && typeof authService[method] === 'function') return false;
  sendError(response, 503, AUTHENTICATION_UNAVAILABLE);
  return true;
}

/**
 * Build the local authentication HTTP routes.
 *
 * @param {{ authService?: ReturnType<import('./auth.js').createAuthService>, cookieName?: string, secureCookies?: boolean }} options
 */
export function createAuthRouter({
  authService,
  cookieName = SESSION_COOKIE_NAME,
  secureCookies = process.env.NODE_ENV === 'production'
} = {}) {
  const router = express.Router();
  const cookieOptions = { cookieName, secure: secureCookies };
  const requireSession = createRequireSessionMiddleware({ authService, cookieName });

  router.post('/register', async (request, response) => {
    if (unavailableIfMissingService(response, authService, 'register')) return;

    const validation = validateCredentialBody(request.body);
    if (validation.details) {
      sendValidationError(response, validation.details);
      return;
    }

    try {
      const result = await authService.register(validation.value);
      const context = sessionContext(result);
      if (!context || typeof result.session.token !== 'string') {
        sendError(response, 503, AUTHENTICATION_UNAVAILABLE);
        return;
      }
      setSessionCookie(response, result.session.token, cookieOptions);
      response.location('/api/auth/me').status(201).json(context.user);
    } catch (error) {
      handleServiceError(response, error);
    }
  });

  router.post('/login', async (request, response) => {
    if (unavailableIfMissingService(response, authService, 'login')) return;

    const validation = validateCredentialBody(request.body);
    if (validation.details) {
      sendValidationError(response, validation.details);
      return;
    }

    try {
      const result = await authService.login(validation.value);
      const context = sessionContext(result);
      if (!context || typeof result.session.token !== 'string') {
        sendError(response, 401, INVALID_CREDENTIALS);
        return;
      }
      setSessionCookie(response, result.session.token, cookieOptions);
      response.status(200).json(context.user);
    } catch (error) {
      if (isAuthValidationError(error)) {
        sendError(response, 401, INVALID_CREDENTIALS);
        return;
      }
      sendError(response, 503, AUTHENTICATION_UNAVAILABLE);
    }
  });

  router.post('/logout', async (request, response) => {
    const token = getCookieValue(request.headers.cookie, cookieName);
    if (token && authService && typeof authService.revokeSession === 'function') {
      try {
        await authService.revokeSession(token);
      } catch {
        sendError(response, 503, AUTHENTICATION_UNAVAILABLE);
        return;
      }
    }

    clearSessionCookie(response, cookieOptions);
    response.status(204).end();
  });

  router.get('/me', requireSession, (request, response) => {
    response.status(200).json(request.user);
  });

  return router;
}
