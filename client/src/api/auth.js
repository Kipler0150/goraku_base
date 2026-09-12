import { requestJson } from './request.js';

function invalidUserPayload() {
  const error = new Error('The API returned an invalid User payload.');
  error.code = 'INVALID_PAYLOAD';
  return error;
}

export function isValidUserPayload(payload) {
  return Boolean(
    payload &&
    typeof payload === 'object' &&
    typeof payload.id === 'string' &&
    payload.id.length > 0 &&
    typeof payload.username === 'string' &&
    payload.username.length > 0 &&
    typeof payload.email === 'string' &&
    payload.email.length > 0 &&
    (!Object.hasOwn(payload, 'avatarUpdatedAt') || payload.avatarUpdatedAt === null || typeof payload.avatarUpdatedAt === 'string')
  );
}

async function userRequest(url, options) {
  const payload = await requestJson(url, options);
  if (!isValidUserPayload(payload)) throw invalidUserPayload();
  return payload;
}

export function isVerificationRequiredPayload(payload) {
  return Boolean(
    payload &&
    typeof payload === 'object' &&
    payload.code === 'EMAIL_VERIFICATION_REQUIRED' &&
    typeof payload.email === 'string' &&
    payload.email.length > 0
  );
}

function credentialRequest(url, credentials, options) {
  return userRequest(url, {
    method: 'POST',
    body: JSON.stringify(credentials),
    ...options
  });
}

export function getCurrentUser(options) {
  return userRequest('/api/auth/me', options);
}

export function register(credentials, options) {
  return requestJson('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(credentials),
    ...options
  }).then((payload) => {
    if (isValidUserPayload(payload) || isVerificationRequiredPayload(payload)) return payload;
    throw invalidUserPayload();
  });
}

export function login(credentials, options) {
  return credentialRequest('/api/auth/login', credentials, options);
}

export function logout(options) {
  return requestJson('/api/auth/logout', { method: 'POST', allowEmpty: true, ...options });
}

export function uploadAvatar(file, options = {}) {
  return userRequest('/api/auth/avatar', {
    ...options,
    method: 'PUT',
    headers: {
      'Content-Type': file?.type || 'application/octet-stream',
      ...(options.headers ?? {})
    },
    body: file
  });
}

export function removeAvatar(options) {
  return userRequest('/api/auth/avatar', { method: 'DELETE', ...options });
}

export function resendVerification(email, options) {
  return requestJson('/api/auth/resend-verification', {
    method: 'POST',
    body: JSON.stringify({ email }),
    ...options
  });
}

export function requestPasswordReset(email, options) {
  return requestJson('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
    ...options
  });
}

export function resetPassword(token, password, options) {
  return requestJson('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
    ...options
  });
}
