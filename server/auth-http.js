import express from 'express';
import {
  AuthConflictError,
  AuthValidationError,
  AuthTokenError,
  AuthVerificationRequiredError,
  SESSION_TTL_MS
} from './auth.js';
import { PROFILE_AVATAR_MAX_BYTES } from './profile.js';
import { createApplicationRateLimiter, resolveClientIp } from './rate-limit.js';

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
  message: 'The email, username, or password is invalid.',
  details: []
};

const EMAIL_NOT_VERIFIED = {
  code: 'EMAIL_NOT_VERIFIED',
  message: 'Verify your email address before signing in.',
  details: []
};

const AUTH_RATE_LIMIT_ERROR = {
  code: 'AUTH_RATE_LIMITED',
  message: 'Too many account requests. Please retry later.',
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

function validateCredentialBody(body, { requireUsername = false } = {}) {
  if (!isPlainObject(body)) {
    return { details: [{ field: 'body', message: 'The body must be a JSON object.' }] };
  }

  const details = [];
  const allowedFields = new Set(requireUsername ? ['username', 'email', 'password'] : ['identifier', 'email', 'password']);
  for (const field of Object.keys(body)) {
    if (!allowedFields.has(field)) {
      details.push({ field, message: 'Unknown field.' });
    }
  }
  if (requireUsername) {
    for (const field of ['username', 'email', 'password']) {
      if (!Object.hasOwn(body, field)) {
        details.push({ field, message: 'This field is required.' });
      } else if (typeof body[field] !== 'string') {
        details.push({ field, message: 'This field must be a string.' });
      }
    }
    return details.length > 0 ? { details } : { value: body };
  }

  const hasIdentifier = Object.hasOwn(body, 'identifier');
  const hasLegacyEmail = Object.hasOwn(body, 'email');
  if (!hasIdentifier && !hasLegacyEmail) {
    details.push({ field: 'identifier', message: 'This field is required.' });
  }
  if (hasIdentifier && hasLegacyEmail) {
    details.push({ field: 'identifier', message: 'Use identifier or email, not both.' });
  }
  for (const field of ['identifier', 'email', 'password']) {
    if (Object.hasOwn(body, field) && typeof body[field] !== 'string') {
      details.push({ field, message: 'This field must be a string.' });
    }
  }

  return details.length > 0
    ? { details }
    : { value: { identifier: hasIdentifier ? body.identifier : body.email, password: body.password } };
}

function validateEmailBody(body) {
  if (!isPlainObject(body)) return { details: [{ field: 'body', message: 'The body must be a JSON object.' }] };
  const details = [];
  for (const field of Object.keys(body)) {
    if (field !== 'email') details.push({ field, message: 'Unknown field.' });
  }
  if (!Object.hasOwn(body, 'email')) details.push({ field: 'email', message: 'This field is required.' });
  else if (typeof body.email !== 'string') details.push({ field: 'email', message: 'This field must be a string.' });
  return details.length > 0 ? { details } : { value: { email: body.email } };
}

function validatePasswordResetBody(body) {
  if (!isPlainObject(body)) return { details: [{ field: 'body', message: 'The body must be a JSON object.' }] };
  const details = [];
  for (const field of Object.keys(body)) {
    if (!['token', 'password'].includes(field)) details.push({ field, message: 'Unknown field.' });
  }
  for (const field of ['token', 'password']) {
    if (!Object.hasOwn(body, field)) details.push({ field, message: 'This field is required.' });
    else if (typeof body[field] !== 'string') details.push({ field, message: 'This field must be a string.' });
  }
  return details.length > 0 ? { details } : { value: { token: body.token, password: body.password } };
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
  if (!user || typeof user.id !== 'string' || typeof user.username !== 'string' || typeof user.email !== 'string') return null;
  const result = { id: user.id, username: user.username, email: user.email };
  if (Object.hasOwn(user, 'avatarUpdatedAt')) result.avatarUpdatedAt = user.avatarUpdatedAt ?? null;
  return result;
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
    sendValidationError(response, error.details, error.message);
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
  if (error instanceof AuthTokenError || error?.code === 'AUTH_TOKEN_INVALID') {
    sendError(response, 400, {
      code: 'AUTH_TOKEN_INVALID',
      message: 'This authentication link is invalid or expired.',
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
 * @param {{ authService?: ReturnType<import('./auth.js').createAuthService>, cookieName?: string, secureCookies?: boolean, appOrigin?: string, authRateLimit?: object }} options
 */
export function createAuthRouter({
  authService,
  cookieName = SESSION_COOKIE_NAME,
  secureCookies = process.env.NODE_ENV === 'production',
  appOrigin = process.env.APP_ORIGIN ?? DEFAULT_APP_ORIGIN,
  authRateLimit = {}
} = {}) {
  const router = express.Router();
  const resolvedAppOrigin = resolveAppOrigin(appOrigin);
  const cookieOptions = { cookieName, secure: secureCookies };
  const requireSession = createRequireSessionMiddleware({ authService, cookieName });
  const authRateLimiter = createApplicationRateLimiter({
    tokensPerMinute: 30,
    burstCapacity: 10,
    resolveKey: (request) => `${resolveClientIp(request)}:${request.path}`,
    error: AUTH_RATE_LIMIT_ERROR,
    ...authRateLimit
  });

  router.post('/register', authRateLimiter.middleware, async (request, response) => {
    if (unavailableIfMissingService(response, authService, 'register')) return;

    const validation = validateCredentialBody(request.body, { requireUsername: true });
    if (validation.details) {
      sendValidationError(response, validation.details);
      return;
    }

    try {
      const result = await authService.register(validation.value);
      const context = sessionContext(result);
      if (context && typeof result.session.token === 'string') {
        setSessionCookie(response, result.session.token, cookieOptions);
        response.location('/api/auth/me').status(201).json(context.user);
        return;
      }
      if (result?.verificationRequired === true && typeof result.email === 'string') {
        response.status(202).json({
          code: 'EMAIL_VERIFICATION_REQUIRED',
          message: 'Check your email to verify your account before signing in.',
          email: result.email
        });
        return;
      }
      sendError(response, 503, AUTHENTICATION_UNAVAILABLE);
    } catch (error) {
      handleServiceError(response, error);
    }
  });

  router.post('/login', authRateLimiter.middleware, async (request, response) => {
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
      if (error instanceof AuthVerificationRequiredError || error?.code === 'EMAIL_NOT_VERIFIED') {
        sendError(response, 403, EMAIL_NOT_VERIFIED);
        return;
      }
      if (isAuthValidationError(error)) {
        sendError(response, 401, INVALID_CREDENTIALS);
        return;
      }
      sendError(response, 503, AUTHENTICATION_UNAVAILABLE);
    }
  });

  router.post('/resend-verification', authRateLimiter.middleware, async (request, response) => {
    if (unavailableIfMissingService(response, authService, 'resendVerification')) return;
    const validation = validateEmailBody(request.body);
    if (validation.details) {
      sendValidationError(response, validation.details);
      return;
    }
    try {
      await authService.resendVerification(validation.value);
      response.status(202).json({
        message: 'If that account is waiting for verification, a new email has been sent.'
      });
    } catch (error) {
      handleServiceError(response, error);
    }
  });

  router.post('/forgot-password', authRateLimiter.middleware, async (request, response) => {
    if (unavailableIfMissingService(response, authService, 'requestPasswordReset')) return;
    const validation = validateEmailBody(request.body);
    if (validation.details) {
      sendValidationError(response, validation.details);
      return;
    }
    try {
      await authService.requestPasswordReset(validation.value);
      response.status(202).json({
        message: 'If a verified account exists for that email, a password reset email has been sent.'
      });
    } catch (error) {
      handleServiceError(response, error);
    }
  });

  router.get('/verify-email', async (request, response) => {
    if (unavailableIfMissingService(response, authService, 'verifyEmail')) return;
    const token = typeof request.query.token === 'string' ? request.query.token : '';
    if (!token) {
      sendError(response, 400, {
        code: 'AUTH_TOKEN_INVALID',
        message: 'This authentication link is invalid or expired.',
        details: []
      });
      return;
    }
    try {
      const result = await authService.verifyEmail(token);
      if (!result || typeof result.session?.token !== 'string') {
        throw new AuthTokenError();
      }
      setSessionCookie(response, result.session.token, cookieOptions);
      const redirect = new URL(resolvedAppOrigin);
      redirect.searchParams.set('emailVerified', '1');
      response.redirect(303, redirect.toString());
    } catch (error) {
      handleServiceError(response, error);
    }
  });

  router.get('/reset-password', (request, response) => {
    const token = typeof request.query.token === 'string' ? request.query.token : '';
    if (!token) {
      sendError(response, 400, {
        code: 'AUTH_TOKEN_INVALID',
        message: 'This authentication link is invalid or expired.',
        details: []
      });
      return;
    }
    const redirect = new URL(resolvedAppOrigin);
    redirect.searchParams.set('resetToken', token);
    response.redirect(303, redirect.toString());
  });

  router.post('/reset-password', authRateLimiter.middleware, async (request, response) => {
    if (unavailableIfMissingService(response, authService, 'resetPassword')) return;
    const validation = validatePasswordResetBody(request.body);
    if (validation.details) {
      sendValidationError(response, validation.details);
      return;
    }
    try {
      await authService.resetPassword(validation.value);
      response.status(200).json({ message: 'Your password was reset. You can now sign in.' });
    } catch (error) {
      handleServiceError(response, error);
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

  router.get('/avatar', requireSession, async (request, response) => {
    if (unavailableIfMissingService(response, authService, 'getAvatar')) return;

    try {
      const avatar = await authService.getAvatar(request.user.id);
      if (!avatar) {
        sendError(response, 404, {
          code: 'AVATAR_NOT_FOUND',
          message: 'This User is using the Goraku logo.',
          details: []
        });
        return;
      }
      response.setHeader('Cache-Control', 'private, no-store');
      response.type(avatar.contentType).status(200).send(avatar.data);
    } catch {
      sendError(response, 503, AUTHENTICATION_UNAVAILABLE);
    }
  });

  router.put(
    '/avatar',
    requireSession,
    express.raw({ type: () => true, limit: `${PROFILE_AVATAR_MAX_BYTES}b` }),
    async (request, response) => {
      if (unavailableIfMissingService(response, authService, 'updateAvatar')) return;

      try {
        const user = await authService.updateAvatar({
          userId: request.user.id,
          data: request.body,
          contentType: request.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
        });
        const payload = publicUser(user);
        if (!payload) {
          sendError(response, 503, AUTHENTICATION_UNAVAILABLE);
          return;
        }
        response.status(200).json(payload);
      } catch (error) {
        handleServiceError(response, error);
      }
    }
  );

  router.delete('/avatar', requireSession, async (request, response) => {
    if (unavailableIfMissingService(response, authService, 'removeAvatar')) return;

    try {
      const payload = publicUser(await authService.removeAvatar(request.user.id));
      if (!payload) {
        sendError(response, 503, AUTHENTICATION_UNAVAILABLE);
        return;
      }
      response.status(200).json(payload);
    } catch (error) {
      handleServiceError(response, error);
    }
  });

  return router;
}
