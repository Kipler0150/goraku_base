import { ProviderError, PROVIDER_ERROR_CODES } from './providers/errors.js';
import {
  PROVIDER_CAPABILITY_MATRIX,
  supportsProviderCapability
} from './media-capabilities.js';
import { MediaCapabilityError } from './media-details.js';

function isValidProviderType(provider, type) {
  return Boolean(PROVIDER_CAPABILITY_MATRIX[provider]?.[type]);
}

function normalizeEpisodeResult(result, { provider, type, providerId, season }) {
  if (!result || typeof result !== 'object' || Array.isArray(result) ||
      result.provider !== provider || result.type !== type.toUpperCase() ||
      result.providerId !== providerId || result.season !== season || !Array.isArray(result.episodes)) {
    throw new ProviderError(PROVIDER_ERROR_CODES.INVALID_RESPONSE);
  }
  return result;
}

/**
 * Coordinate provider-owned released episode requests. The service keeps
 * provider episode metadata separate from the authenticated watched-state API.
 */
export function createMediaEpisodesService({
  anilistAdapter,
  myanimelistAdapter,
  tmdbAdapter,
  thegamesdbAdapter,
  rawgAdapter,
  onProviderRequest = () => {}
} = {}) {
  const adapters = { anilistAdapter, myanimelistAdapter, tmdbAdapter, thegamesdbAdapter, rawgAdapter };

  return {
    async getEpisodes({ provider, type, providerId, season } = {}) {
      if (!isValidProviderType(provider, type) || !supportsProviderCapability(provider, type, 'episodes')) {
        throw new MediaCapabilityError();
      }

      const adapter = type === 'anime' ? anilistAdapter : adapters[`${provider}Adapter`];
      if (adapter?.enabled === false) throw new ProviderError(PROVIDER_ERROR_CODES.UNAVAILABLE);
      if (typeof adapter?.getSeasonEpisodes !== 'function') throw new MediaCapabilityError();

      try {
        onProviderRequest({ provider: type === 'anime' ? 'anilist' : provider, operation: 'episodes' });
      } catch {
        // Observability must never change Provider behavior.
      }
      const result = await adapter.getSeasonEpisodes({ provider, providerId, season });
      return normalizeEpisodeResult(result, { provider, type, providerId, season });
    }
  };
}
