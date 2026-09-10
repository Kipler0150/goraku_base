/**
 * Operations exposed by the Provider-owned Media interface.
 *
 * The matrix is deliberately explicit. A missing or false entry means the
 * operation is unsupported; it does not mean that the Provider returned an
 * empty result.
 */
export const MEDIA_OPERATIONS = Object.freeze([
  'search',
  'details',
  'trending',
  'popular',
  'recommendations'
]);

const capabilities = {
  anilist: {
    anime: { search: true, details: true, trending: true, popular: true, recommendations: true }
  },
  myanimelist: {
    anime: { search: true, details: true, trending: false, popular: true, recommendations: true }
  },
  tmdb: {
    movie: { search: true, details: true, trending: true, popular: true, recommendations: true },
    tv: { search: true, details: true, trending: true, popular: true, recommendations: true }
  },
  thegamesdb: {
    game: { search: true, details: true, trending: false, popular: false, recommendations: false }
  },
  rawg: {
    game: { search: true, details: true, trending: false, popular: true, recommendations: true }
  }
};

for (const providerCapabilities of Object.values(capabilities)) {
  Object.freeze(providerCapabilities);
  for (const providerTypeCapabilities of Object.values(providerCapabilities)) {
    Object.freeze(providerTypeCapabilities);
  }
}

/**
 * The source of truth for supported Provider/type/operation combinations.
 */
export const PROVIDER_CAPABILITY_MATRIX = Object.freeze(capabilities);

/**
 * Return a defensive copy so callers cannot mutate the capability matrix.
 *
 * @param {string} provider
 * @param {string} type
 * @returns {Readonly<Record<string, boolean>>|null}
 */
export function getProviderCapabilities(provider, type) {
  const providerCapabilities = PROVIDER_CAPABILITY_MATRIX[provider];
  const result = providerCapabilities?.[type];
  return result ? { ...result } : null;
}

/**
 * Check a capability without treating an unknown Provider/type as supported.
 *
 * @param {string} provider
 * @param {string} type
 * @param {string} operation
 * @returns {boolean}
 */
export function supportsProviderCapability(provider, type, operation) {
  return PROVIDER_CAPABILITY_MATRIX[provider]?.[type]?.[operation] === true;
}

/**
 * List Providers that can perform an operation for a public media type.
 *
 * @param {string} type
 * @param {string} operation
 * @returns {string[]}
 */
export function getProvidersForType(type, operation) {
  return Object.entries(PROVIDER_CAPABILITY_MATRIX)
    .filter(([, providerCapabilities]) => providerCapabilities[type]?.[operation] === true)
    .map(([provider]) => provider);
}
