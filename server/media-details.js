import { createMedia } from '../shared/media.js';
import { ProviderError, PROVIDER_ERROR_CODES } from './providers/errors.js';
import {
  PROVIDER_CAPABILITY_MATRIX,
  supportsProviderCapability
} from './media-capabilities.js';

export const CAPABILITY_UNSUPPORTED_CODE = 'CAPABILITY_UNSUPPORTED';

export class MediaCapabilityError extends Error {
  constructor(message = 'This Provider does not support the requested operation.') {
    super(message);
    this.name = 'MediaCapabilityError';
    this.code = CAPABILITY_UNSUPPORTED_CODE;
  }
}

function expectedMediaType(type) {
  return type.toUpperCase();
}

function isValidProviderType(provider, type) {
  return Boolean(PROVIDER_CAPABILITY_MATRIX[provider]?.[type]);
}

function normalizeDetailResult(result, { provider, type, providerId }) {
  let media;
  try {
    media = createMedia(result);
  } catch {
    throw new ProviderError(PROVIDER_ERROR_CODES.INVALID_RESPONSE);
  }

  if (media.provider !== provider || media.type !== expectedMediaType(type) || media.providerId !== providerId) {
    throw new ProviderError(PROVIDER_ERROR_CODES.INVALID_RESPONSE);
  }
  return media;
}

/**
 * Coordinate one explicit Provider-owned Media details request.
 *
 * The service has no fallback policy: the Provider in the request remains the
 * Provider used for the request, even when another Provider could serve the
 * same media type.
 */
export function createMediaDetailsService({
  anilistAdapter,
  myanimelistAdapter,
  tmdbAdapter,
  thegamesdbAdapter,
  rawgAdapter,
  onProviderRequest = () => {}
}) {
  const adapters = {
    anilist: anilistAdapter,
    myanimelist: myanimelistAdapter,
    tmdb: tmdbAdapter,
    thegamesdb: thegamesdbAdapter,
    rawg: rawgAdapter
  };

  return {
    async getDetails({ provider, type, providerId, includeAdult = true }) {
      if (!isValidProviderType(provider, type) || !supportsProviderCapability(provider, type, 'details')) {
        throw new MediaCapabilityError();
      }

      const adapter = adapters[provider];
      if (adapter?.enabled === false) {
        throw new ProviderError(PROVIDER_ERROR_CODES.UNAVAILABLE);
      }

      const getDetails = adapter?.getMediaDetails ?? adapter?.getDetails;
      if (typeof getDetails !== 'function') {
        throw new MediaCapabilityError();
      }

      try {
        onProviderRequest({ provider, operation: 'details' });
      } catch {
        // Observability must never change Provider behavior.
      }
      const result = await getDetails.call(adapter, { type, providerId, includeAdult });
      const media = normalizeDetailResult(result, { provider, type, providerId });
      if (!includeAdult && media.isAdult === true) {
        throw new ProviderError(PROVIDER_ERROR_CODES.NOT_FOUND);
      }
      return media;
    }
  };
}
