/**
 * @typedef {'ANIME'|'MANGA'|'MOVIE'|'TV'|'GAME'|'COMIC'} MediaType
 * @typedef {'ANNOUNCED'|'ONGOING'|'RELEASED'|'CANCELLED'|'UNKNOWN'} ReleaseStatus
 * @typedef {{year: number, month: number|null, day: number|null}} ReleaseDate
 * @typedef {{value: number, max: number, normalized: number}} ProviderRating
 * @typedef {{name: string, role: string}} Creator
 * @typedef {{provider: string, providerId: string, type: MediaType, id: string, title: string|null, originalTitle: string|null, alternativeTitles: string[], description: string|null, image: string|null, bannerImage: string|null, releaseDate: ReleaseDate|null, genres: string[], providerRating: ProviderRating|null, releaseStatus: ReleaseStatus, creators: Creator[], isAdult: boolean|null, metadata: object}} Media
 */

export const MEDIA_TYPES = Object.freeze(['ANIME', 'MANGA', 'MOVIE', 'TV', 'GAME', 'COMIC']);
export const RELEASE_STATUSES = Object.freeze(['ANNOUNCED', 'ONGOING', 'RELEASED', 'CANCELLED', 'UNKNOWN']);

const mediaTypeMessage = 'type must be one of ANIME, MANGA, MOVIE, TV, GAME, or COMIC.';

/**
 * Build an unambiguous identity from provider, type, and provider ID.
 * Each variable segment is URI encoded before joining with a colon.
 *
 * @param {string} provider
 * @param {MediaType} type
 * @param {string} providerId
 * @returns {string}
 */
export function createStableMediaId(provider, type, providerId) {
  return [provider, type, providerId].map((part) => encodeURIComponent(String(part))).join(':');
}

/**
 * Convert a source score to the shared display scale without discarding its source scale.
 *
 * @param {{value: number, max: number}|null|undefined} rating
 * @returns {ProviderRating|null}
 */
export function normalizeProviderRating(rating) {
  if (rating == null) return null;
  if (!Number.isFinite(rating.value) || !Number.isFinite(rating.max)) {
    throw new TypeError('Provider rating value and max must be finite numbers.');
  }
  if (rating.max <= 0) {
    throw new RangeError('Provider rating max must be a positive finite maximum.');
  }
  if (rating.value < 0 || rating.value > rating.max) {
    throw new RangeError('Provider rating value must be between 0 and max.');
  }

  return {
    value: rating.value,
    max: rating.max,
    normalized: (rating.value / rating.max) * 10
  };
}

function normalizeReleaseDate(date) {
  if (date == null) return null;
  if (!date || typeof date !== 'object' || Array.isArray(date)) {
    throw new TypeError('releaseDate must be an object or null.');
  }

  const year = date.year;
  const month = date.month ?? null;
  const day = date.day ?? null;

  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw new RangeError('releaseDate year must be an integer from 1 to 9999.');
  }
  if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) {
    throw new RangeError('releaseDate month must be an integer from 1 to 12.');
  }
  if (day !== null && month === null) {
    throw new RangeError('releaseDate month is required when day is supplied.');
  }
  if (day !== null && (!Number.isInteger(day) || day < 1 || day > 31)) {
    throw new RangeError('releaseDate day must be an integer from 1 to 31.');
  }
  if (month !== null && day !== null) {
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (day > daysInMonth) {
      throw new RangeError('releaseDate must be a valid calendar date.');
    }
  }

  return { year, month, day };
}

function normalizeText(value) {
  if (value == null) return null;
  if (typeof value !== 'string') throw new TypeError('Text fields must be strings or null.');
  const text = value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return text || null;
}

function normalizeDescription(value) {
  if (value == null) return null;
  if (typeof value !== 'string') throw new TypeError('Text fields must be strings or null.');
  const text = value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || null;
}

function normalizeAdultClassification(value) {
  if (value == null) return null;
  if (typeof value !== 'boolean') throw new TypeError('isAdult must be a boolean or null.');
  return value;
}

function normalizeStringList(value, fieldName) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new TypeError(`${fieldName} must be an array of strings.`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function normalizeCreators(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError('creators must be an array.');
  return value.map((creator) => {
    if (!creator || typeof creator.name !== 'string' || typeof creator.role !== 'string') {
      throw new TypeError('Each creator must include a name and role.');
    }
    return { name: creator.name.trim(), role: creator.role.trim() };
  }).filter((creator) => creator.name && creator.role);
}

function normalizeNonNegativeInteger(value, fieldName) {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${fieldName} must be a non-negative integer or null.`);
  }
  return value;
}

function normalizeMetadata(type, metadata = {}) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new TypeError('metadata must be an object.');
  }

  if (type === 'ANIME') {
    return {
      episodeCount: normalizeNonNegativeInteger(metadata.episodeCount, 'episodeCount'),
      episodeDurationMinutes: normalizeNonNegativeInteger(metadata.episodeDurationMinutes, 'episodeDurationMinutes')
    };
  }
  if (type === 'MOVIE') {
    return { runtimeMinutes: normalizeNonNegativeInteger(metadata.runtimeMinutes, 'runtimeMinutes') };
  }
  if (type === 'TV') {
    return {
      seasonCount: normalizeNonNegativeInteger(metadata.seasonCount, 'seasonCount'),
      episodeCount: normalizeNonNegativeInteger(metadata.episodeCount, 'episodeCount')
    };
  }
  if (type === 'GAME') {
    return {
      platforms: normalizeStringList(metadata.platforms, 'platforms'),
      developers: normalizeStringList(metadata.developers, 'developers'),
      publishers: normalizeStringList(metadata.publishers, 'publishers')
    };
  }
  return {};
}

/**
 * Validate public Media input without constructing a Media value.
 *
 * @param {unknown} input
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateMedia(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, errors: ['Media input must be an object.'] };
  }
  if (typeof input.provider !== 'string' || !input.provider.trim()) {
    errors.push('provider must be a non-empty string.');
  }
  if (typeof input.providerId !== 'string' || !input.providerId.trim()) {
    errors.push('providerId must be a non-empty string.');
  }
  if (!MEDIA_TYPES.includes(input.type)) {
    errors.push(mediaTypeMessage);
  }
  if (errors.length > 0) return { valid: false, errors };

  const releaseStatus = input.releaseStatus ?? 'UNKNOWN';
  if (!RELEASE_STATUSES.includes(releaseStatus)) {
    errors.push(`releaseStatus must be one of ${RELEASE_STATUSES.join(', ')}.`);
  }

  const normalizers = [
    () => normalizeText(input.title),
    () => normalizeText(input.originalTitle),
    () => normalizeStringList(input.alternativeTitles, 'alternativeTitles'),
    () => normalizeDescription(input.description),
    () => normalizeText(input.image),
    () => normalizeText(input.bannerImage),
    () => normalizeReleaseDate(input.releaseDate),
    () => normalizeStringList(input.genres, 'genres'),
    () => normalizeProviderRating(input.providerRating),
    () => normalizeCreators(input.creators),
    () => normalizeAdultClassification(input.isAdult),
    () => normalizeMetadata(input.type, input.metadata)
  ];

  for (const normalize of normalizers) {
    try {
      normalize();
    } catch (error) {
      errors.push(error.message);
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Normalize provider metadata into the shared Media contract.
 *
 * @param {object} input
 * @returns {Media}
 */
export function createMedia(input) {
  const validation = validateMedia(input);
  if (!validation.valid) throw new TypeError(validation.errors.join(' '));

  const provider = input.provider.trim();
  const providerId = input.providerId.trim();
  const type = input.type;
  const releaseStatus = input.releaseStatus ?? 'UNKNOWN';

  return {
    provider,
    providerId,
    type,
    id: createStableMediaId(provider, type, providerId),
    title: normalizeText(input.title),
    originalTitle: normalizeText(input.originalTitle),
    alternativeTitles: normalizeStringList(input.alternativeTitles, 'alternativeTitles'),
    description: normalizeDescription(input.description),
    image: normalizeText(input.image),
    bannerImage: normalizeText(input.bannerImage),
    releaseDate: normalizeReleaseDate(input.releaseDate),
    genres: normalizeStringList(input.genres, 'genres'),
    providerRating: normalizeProviderRating(input.providerRating),
    releaseStatus,
    creators: normalizeCreators(input.creators),
    isAdult: normalizeAdultClassification(input.isAdult),
    metadata: normalizeMetadata(type, input.metadata)
  };
}
