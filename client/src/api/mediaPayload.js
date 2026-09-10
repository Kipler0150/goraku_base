const MEDIA_TYPES = new Set(['ANIME', 'MOVIE', 'TV', 'GAME']);
const RELEASE_STATUSES = new Set(['ANNOUNCED', 'ONGOING', 'RELEASED', 'CANCELLED', 'UNKNOWN']);
const SUPPORTED_PROVIDERS = new Set(['anilist', 'myanimelist', 'tmdb', 'thegamesdb', 'rawg']);

function isNullableString(value) {
  return value === null || typeof value === 'string';
}

function isReleaseDate(value) {
  return value === null || (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Number.isInteger(value.year) &&
    (value.month === null || Number.isInteger(value.month)) &&
    (value.day === null || Number.isInteger(value.day))
  );
}

function isProviderRating(value) {
  return value === null || (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Number.isFinite(value.value) &&
    Number.isFinite(value.max) &&
    Number.isFinite(value.normalized)
  );
}

function isCreator(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.name === 'string' &&
    typeof value.role === 'string'
  );
}

/**
 * Validate the normalized Media contract at the browser boundary.
 *
 * @param {unknown} value
 * @param {{provider?: string, type?: string, providerId?: string|number}} expected
 * @returns {boolean}
 */
export function isValidMediaPayload(value, expected = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (typeof value.provider !== 'string' || !SUPPORTED_PROVIDERS.has(value.provider)) return false;
  if (typeof value.providerId !== 'string' || !value.providerId) return false;
  if (!MEDIA_TYPES.has(value.type) || typeof value.id !== 'string' || !value.id) return false;
  if (expected.provider !== undefined && value.provider !== expected.provider) return false;
  if (expected.type !== undefined && value.type !== String(expected.type).toUpperCase()) return false;
  if (expected.providerId !== undefined && value.providerId !== String(expected.providerId)) return false;
  if (!isNullableString(value.title) || !isNullableString(value.originalTitle)) return false;
  if (!Array.isArray(value.alternativeTitles) || value.alternativeTitles.some((title) => typeof title !== 'string')) return false;
  if (!isNullableString(value.description) || !isNullableString(value.image) || !isNullableString(value.bannerImage)) return false;
  if (!isReleaseDate(value.releaseDate) || !Array.isArray(value.genres) || value.genres.some((genre) => typeof genre !== 'string')) return false;
  if (!isProviderRating(value.providerRating) || !RELEASE_STATUSES.has(value.releaseStatus)) return false;
  if (!Array.isArray(value.creators) || value.creators.some((creator) => !isCreator(creator))) return false;
  if (value.isAdult !== null && typeof value.isAdult !== 'boolean') return false;
  return Boolean(value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata));
}

export function invalidMediaPayload(message = 'The API returned an invalid media payload.') {
  const error = new Error(message);
  error.code = 'INVALID_PAYLOAD';
  return error;
}

export function isValidMediaListPayload(value, expected = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!Array.isArray(value.results)) return false;
  if (typeof value.source !== 'string' || !SUPPORTED_PROVIDERS.has(value.source)) return false;
  if (expected.provider && value.source !== expected.provider) return false;
  if (!value.pagination || typeof value.pagination !== 'object' || Array.isArray(value.pagination)) return false;
  if (!Number.isInteger(value.pagination.page) || value.pagination.page < 1) return false;
  if (!Number.isInteger(value.pagination.perPage) || value.pagination.perPage < 1) return false;
  if (typeof value.pagination.hasMore !== 'boolean' || !Array.isArray(value.providerErrors)) return false;

  return value.results.every((media) => isValidMediaPayload(media, {
    ...expected,
    provider: expected.provider ?? value.source
  }));
}
