import { requestJson } from './request.js';
import { invalidMediaPayload, isValidMediaListPayload } from './mediaPayload.js';

const MEDIA_TYPES = new Set(['anime', 'movie', 'tv', 'game']);
const DISCOVERY_OPERATIONS = new Set(['trending', 'popular']);

function invalidListPayload() {
  return invalidMediaPayload('The API returned an invalid media list payload.');
}

function validateDiscoveryOptions({ operation, type }) {
  if (!DISCOVERY_OPERATIONS.has(operation)) throw new TypeError('operation must be trending or popular.');
  if (!MEDIA_TYPES.has(type)) throw new TypeError('type must be anime, movie, tv, or game.');
}

export { isValidMediaListPayload };

export async function getMediaDiscovery({
  operation = 'trending',
  type,
  provider,
  page = 1,
  perPage = 12,
  includeAdult = true,
  signal
} = {}) {
  validateDiscoveryOptions({ operation, type });
  const params = new URLSearchParams({
    type,
    page: String(page),
    perPage: String(perPage),
    includeAdult: String(includeAdult)
  });
  if (provider) params.set('provider', provider);
  const payload = await requestJson(`/api/media/${operation}?${params.toString()}`, { signal });
  if (!isValidMediaListPayload(payload, provider ? { type, provider } : { type })) throw invalidListPayload();
  return payload;
}

export async function getMediaRecommendations({
  provider,
  type,
  providerId,
  page = 1,
  perPage = 12,
  includeAdult = true,
  signal
} = {}) {
  if (typeof provider !== 'string' || !provider) throw new TypeError('provider is required.');
  if (!MEDIA_TYPES.has(type)) throw new TypeError('type must be anime, movie, tv, or game.');
  if (!/^[1-9]\d*$/.test(String(providerId))) throw new TypeError('providerId must be a positive Provider ID.');

  const encodedPath = [provider, type, providerId].map((part) => encodeURIComponent(String(part))).join('/');
  const params = new URLSearchParams({
    page: String(page),
    perPage: String(perPage),
    includeAdult: String(includeAdult)
  });
  const payload = await requestJson(`/api/media/${encodedPath}/recommendations?${params.toString()}`, { signal });
  if (!isValidMediaListPayload(payload, { type, provider })) throw invalidListPayload();
  return payload;
}

export const fetchMediaDiscovery = getMediaDiscovery;
export const fetchMediaRecommendations = getMediaRecommendations;
export const getTrendingMedia = (options = {}) => getMediaDiscovery({ ...options, operation: 'trending' });
export const getPopularMedia = (options = {}) => getMediaDiscovery({ ...options, operation: 'popular' });
