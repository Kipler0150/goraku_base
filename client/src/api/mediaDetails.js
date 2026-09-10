import { requestJson } from './request.js';
import { invalidMediaPayload, isValidMediaPayload } from './mediaPayload.js';

const MEDIA_TYPES = new Set(['anime', 'movie', 'tv', 'game']);

function validateDetailOptions({ provider, type, providerId }) {
  if (typeof provider !== 'string' || !provider) throw new TypeError('provider is required.');
  if (!MEDIA_TYPES.has(type)) throw new TypeError('type must be anime, movie, tv, or game.');
  if (!/^[1-9]\d*$/.test(String(providerId))) throw new TypeError('providerId must be a positive Provider ID.');
}

export function isValidMediaDetailsPayload(payload, expected) {
  return isValidMediaPayload(payload, expected);
}

export async function getMediaDetails({
  provider,
  type,
  providerId,
  includeAdult = true,
  signal
} = {}) {
  validateDetailOptions({ provider, type, providerId });
  const encodedPath = [provider, type, providerId].map((part) => encodeURIComponent(String(part))).join('/');
  const params = new URLSearchParams({ includeAdult: String(includeAdult) });
  const payload = await requestJson(`/api/media/${encodedPath}?${params.toString()}`, { signal });
  if (!isValidMediaDetailsPayload(payload, { provider, type, providerId })) throw invalidMediaPayload();
  return payload;
}

export const fetchMediaDetails = getMediaDetails;
