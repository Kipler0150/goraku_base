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
    typeof payload.email === 'string' &&
    payload.email.length > 0
  );
}

async function userRequest(url, options) {
  const payload = await requestJson(url, options);
  if (!isValidUserPayload(payload)) throw invalidUserPayload();
  return payload;
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
  return credentialRequest('/api/auth/register', credentials, options);
}

export function login(credentials, options) {
  return credentialRequest('/api/auth/login', credentials, options);
}

export function logout(options) {
  return requestJson('/api/auth/logout', { method: 'POST', allowEmpty: true, ...options });
}
