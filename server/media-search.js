import { ProviderError, PROVIDER_ERROR_CODES } from './providers/errors.js';

export const PROVIDERS_UNAVAILABLE_CODE = 'PROVIDERS_UNAVAILABLE';
export const MIN_PROVIDER_QUERY_LENGTH = 3;
export const MEDIA_SEARCH_TYPES = Object.freeze(['anime', 'movie', 'tv', 'game']);

const PROVIDER_CODES = new Set(Object.values(PROVIDER_ERROR_CODES));
const PROVIDER_LABELS = Object.freeze({ anilist: 'AniList', myanimelist: 'MyAnimeList', tmdb: 'TMDB', rawg: 'RAWG' });
const DEFAULT_PROVIDERS = Object.freeze({ anime: 'anilist', movie: 'tmdb', tv: 'tmdb', game: 'rawg' });

export function formatProviderFailure(error, provider) {
  const code = error instanceof ProviderError && PROVIDER_CODES.has(error.code)
    ? error.code
    : PROVIDER_ERROR_CODES.ERROR;
  const label = PROVIDER_LABELS[provider] ?? 'Provider';
  const messages = {
    [PROVIDER_ERROR_CODES.TIMEOUT]: `${label} did not respond within the allowed time.`,
    [PROVIDER_ERROR_CODES.RATE_LIMITED]: `${label} rate limit reached.`,
    [PROVIDER_ERROR_CODES.INVALID_RESPONSE]: `${label} returned an invalid response.`,
    [PROVIDER_ERROR_CODES.UNAVAILABLE]: `${label} is currently unavailable.`,
    [PROVIDER_ERROR_CODES.ERROR]: `${label} request failed.`
  };
  return { code, message: messages[code] };
}

export function providersUnavailable(type = 'anime') {
  const label = type === 'anime' ? 'anime' : type === 'movie' ? 'movie' : 'TV';
  return {
    code: PROVIDERS_UNAVAILABLE_CODE,
    message: `The configured ${label} providers are currently unavailable.`
  };
}

function providerFailureEntry(error, provider) {
  const failure = formatProviderFailure(error, provider);
  return { provider, code: failure.code, message: failure.message };
}

function isProviderUnavailable(error) {
  return error instanceof ProviderError && error.code === PROVIDER_ERROR_CODES.UNAVAILABLE;
}

function isDisabled(adapter) {
  return adapter?.enabled === false;
}

async function callProvider(adapter, validated, provider = validated.provider) {
  if (isDisabled(adapter)) throw new ProviderError(PROVIDER_ERROR_CODES.UNAVAILABLE);
  const { provider: _provider, type, ...sharedOptions } = validated;
  const providerOptions = provider === 'tmdb' ? { type, ...sharedOptions } : sharedOptions;
  const search = adapter?.searchMedia ?? adapter?.searchAnime;
  if (typeof search !== 'function') throw new ProviderError(PROVIDER_ERROR_CODES.UNAVAILABLE);
  return search.call(adapter, providerOptions);
}

function normalizeSearchResponse(result, source, providerErrors = []) {
  if (!result || typeof result !== 'object' || Array.isArray(result) || !Array.isArray(result.results)) {
    throw new ProviderError(PROVIDER_ERROR_CODES.INVALID_RESPONSE);
  }
  if (!result.pagination || typeof result.pagination !== 'object' || Array.isArray(result.pagination)) {
    throw new ProviderError(PROVIDER_ERROR_CODES.INVALID_RESPONSE);
  }
  const { page, perPage, hasMore } = result.pagination;
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(perPage) || perPage < 1 || typeof hasMore !== 'boolean') {
    throw new ProviderError(PROVIDER_ERROR_CODES.INVALID_RESPONSE);
  }
  if (!['anilist', 'myanimelist', 'tmdb', 'rawg'].includes(source)) {
    throw new ProviderError(PROVIDER_ERROR_CODES.INVALID_RESPONSE);
  }
  return {
    results: result.results,
    source,
    pagination: { page, perPage, hasMore },
    providerErrors
  };
}

function combinedFailure(type = 'anime') {
  return Object.assign(new Error(providersUnavailable(type).message), { combined: true, mediaType: type });
}

/**
 * Coordinate one provider-owned media page without merging provider results.
 * HTTP status and error-envelope concerns stay in the Express route layer.
 */
export function createMediaSearchService({ anilistAdapter, myanimelistAdapter, tmdbAdapter, rawgAdapter }) {
  const adapters = { anilist: anilistAdapter, myanimelist: myanimelistAdapter, tmdb: tmdbAdapter, rawg: rawgAdapter };

  return {
    async search(validated) {
      const type = validated.type ?? 'anime';
      const defaultProvider = DEFAULT_PROVIDERS[type] ?? 'anilist';

      if (validated.query.length < MIN_PROVIDER_QUERY_LENGTH) {
        return normalizeSearchResponse({
          results: [],
          pagination: { page: validated.page, perPage: validated.perPage, hasMore: false }
        }, validated.provider ?? defaultProvider);
      }

      if (type !== 'anime') {
        const provider = validated.provider ?? defaultProvider;
        try {
          return normalizeSearchResponse(await callProvider(adapters[provider], validated, provider), provider);
        } catch (error) {
          throw Object.assign(error, { provider });
        }
      }

      if (validated.provider) {
        const adapter = adapters[validated.provider];
        try {
          return normalizeSearchResponse(await callProvider(adapter, validated, validated.provider), validated.provider);
        } catch {
          throw combinedFailure(type);
        }
      }

      try {
        return normalizeSearchResponse(await callProvider(anilistAdapter, validated, 'anilist'), 'anilist');
      } catch (anilistError) {
        if (!isProviderUnavailable(anilistError) || isDisabled(myanimelistAdapter)) {
          if (isProviderUnavailable(anilistError)) throw combinedFailure(type);
          throw Object.assign(anilistError, { provider: 'anilist' });
        }

        try {
          return normalizeSearchResponse(
            await callProvider(myanimelistAdapter, { ...validated, provider: 'myanimelist' }, 'myanimelist'),
            'myanimelist',
            [providerFailureEntry(anilistError, 'anilist')]
          );
        } catch {
          throw combinedFailure(type);
        }
      }
    }
  };
}
