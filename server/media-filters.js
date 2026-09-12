import { ProviderError, PROVIDER_ERROR_CODES } from './providers/errors.js';

export const FILTERABLE_MEDIA_TYPES = Object.freeze(['anime', 'movie', 'tv', 'game']);

export const FILTER_PROVIDER_BY_TYPE = Object.freeze({
  anime: 'anilist',
  movie: 'tmdb',
  tv: 'tmdb',
  game: 'rawg'
});

export function hasSearchFilters(filters) {
  return Boolean(
    filters && (
      (Array.isArray(filters.genres) && filters.genres.length > 0) ||
      (typeof filters.creator === 'string' && filters.creator) ||
      Number.isFinite(filters.minRating) ||
      Number.isFinite(filters.minMetacritic)
    )
  );
}

export function filteredProviderForType(type) {
  return FILTER_PROVIDER_BY_TYPE[type] ?? null;
}

function unavailable() {
  return new ProviderError(PROVIDER_ERROR_CODES.UNAVAILABLE);
}

function isDisabled(adapter) {
  return adapter?.enabled === false;
}

/**
 * Load dynamic, provider-owned search options. Filtered search intentionally
 * has its own provider route, so options and results use the same catalog.
 */
export function createMediaFilterService({
  anilistAdapter,
  tmdbAdapter,
  rawgAdapter,
  onProviderRequest = () => {}
}) {
  const adapters = { anilist: anilistAdapter, tmdb: tmdbAdapter, rawg: rawgAdapter };

  return {
    async getOptions({ type, creatorQuery = '', includeAdult = true } = {}) {
      const provider = filteredProviderForType(type);
      if (!provider || typeof creatorQuery !== 'string' || typeof includeAdult !== 'boolean') {
        throw unavailable();
      }

      const adapter = adapters[provider];
      if (isDisabled(adapter) || typeof adapter?.getFilterOptions !== 'function') throw unavailable();
      try {
        onProviderRequest({ provider, operation: 'filter-options' });
      } catch {
        // Observability must never change Provider behavior.
      }
      return adapter.getFilterOptions({ type, creatorQuery: creatorQuery.trim(), includeAdult });
    }
  };
}
