import { createMedia } from '../shared/media.js';
import {
  PROVIDER_CAPABILITY_MATRIX,
  supportsProviderCapability
} from './media-capabilities.js';
import { ProviderError, PROVIDER_ERROR_CODES } from './providers/errors.js';

export const CAPABILITY_UNSUPPORTED_CODE = 'CAPABILITY_UNSUPPORTED';

export class MediaDiscoveryCapabilityError extends Error {
  constructor(message = 'This Provider does not support the requested operation.') {
    super(message);
    this.name = 'MediaDiscoveryCapabilityError';
    this.code = CAPABILITY_UNSUPPORTED_CODE;
  }
}

function expectedMediaType(type) {
  return type.toUpperCase();
}

function normalizeMediaResult(value, { provider, type }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProviderError(PROVIDER_ERROR_CODES.INVALID_RESPONSE);
  }

  try {
    const media = createMedia({
      provider: value.provider,
      providerId: value.providerId,
      type: value.type,
      title: value.title,
      originalTitle: value.originalTitle,
      alternativeTitles: value.alternativeTitles,
      description: value.description,
      image: value.image,
      bannerImage: value.bannerImage,
      releaseDate: value.releaseDate,
      genres: value.genres,
      providerRating: value.providerRating == null
        ? null
        : { value: value.providerRating.value, max: value.providerRating.max },
      releaseStatus: value.releaseStatus,
      creators: value.creators,
      isAdult: value.isAdult,
      metadata: value.metadata
    });
    if (media.provider !== provider || media.type !== expectedMediaType(type)) {
      throw new TypeError('Provider or media type did not match the request.');
    }
    return media;
  } catch {
    throw new ProviderError(PROVIDER_ERROR_CODES.INVALID_RESPONSE);
  }
}

function normalizeListResult(result, { provider, type, includeAdult }) {
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

  const results = result.results
    .map((value) => normalizeMediaResult(value, { provider, type }))
    .filter((media) => includeAdult || media.isAdult !== true);

  return {
    results,
    source: provider,
    pagination: { page, perPage, hasMore },
    providerErrors: []
  };
}

function adapterMethod(adapter, operation) {
  const names = {
    trending: ['getTrending', 'getTrendingMedia'],
    popular: ['getPopular', 'getPopularMedia'],
    recommendations: ['getRecommendations', 'getMediaRecommendations']
  }[operation];
  return names.map((name) => adapter?.[name]).find((method) => typeof method === 'function');
}

function isValidProviderType(provider, type) {
  return Boolean(PROVIDER_CAPABILITY_MATRIX[provider]?.[type]);
}

function createListService(adapters, operation) {
  return async (options) => {
    const { provider, type, includeAdult = true } = options;
    if (!isValidProviderType(provider, type) || !supportsProviderCapability(provider, type, operation)) {
      throw new MediaDiscoveryCapabilityError();
    }

    const adapter = adapters[provider];
    if (adapter?.enabled === false) throw new ProviderError(PROVIDER_ERROR_CODES.UNAVAILABLE);
    const method = adapterMethod(adapter, operation);
    if (!method) throw new MediaDiscoveryCapabilityError();

    const result = await method.call(adapter, options);
    return normalizeListResult(result, { provider, type, includeAdult });
  };
}

/**
 * Coordinate explicit Provider-owned Discovery and Recommendation pages.
 * This service never merges Providers or applies fallback behavior.
 */
export function createMediaDiscoveryService({ anilistAdapter, myanimelistAdapter, tmdbAdapter, thegamesdbAdapter, rawgAdapter }) {
  const adapters = {
    anilist: anilistAdapter,
    myanimelist: myanimelistAdapter,
    tmdb: tmdbAdapter,
    thegamesdb: thegamesdbAdapter,
    rawg: rawgAdapter
  };

  return {
    getTrending: createListService(adapters, 'trending'),
    getPopular: createListService(adapters, 'popular'),
    async getRecommendations(options) {
      const { provider, type, providerId, includeAdult = true } = options;
      if (!isValidProviderType(provider, type) || !supportsProviderCapability(provider, type, 'recommendations')) {
        throw new MediaDiscoveryCapabilityError();
      }
      if (typeof providerId !== 'string' || !/^[1-9]\d*$/.test(providerId)) {
        throw new ProviderError(PROVIDER_ERROR_CODES.INVALID_RESPONSE);
      }

      const adapter = adapters[provider];
      if (adapter?.enabled === false) throw new ProviderError(PROVIDER_ERROR_CODES.UNAVAILABLE);
      const method = adapterMethod(adapter, 'recommendations');
      if (!method) throw new MediaDiscoveryCapabilityError();

      const result = await method.call(adapter, options);
      return normalizeListResult(result, { provider, type, includeAdult });
    }
  };
}
