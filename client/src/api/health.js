import { requestJson } from './request.js';

export function isValidHealthPayload(payload) {
  return Boolean(
    payload &&
    typeof payload === 'object' &&
    payload.status === 'ok' &&
    payload.service === 'goraku-base-api'
  );
}

export async function fetchHealth(options) {
  const payload = await requestJson('/api/health', options);
  if (!isValidHealthPayload(payload)) {
    const error = new Error('The API returned an invalid health payload.');
    error.code = 'INVALID_PAYLOAD';
    throw error;
  }
  return payload;
}
