import { useCallback, useEffect, useRef, useState } from 'react';
import { searchMedia } from '../api/mediaSearch.js';
import { mediaIdentity } from '../mediaIdentity.js';

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_TYPES = new Set(['anime', 'movie', 'tv', 'game', 'all']);
const FILTERABLE_TYPES = new Set(['anime', 'movie', 'tv', 'game']);

export const EMPTY_SEARCH_FILTERS = Object.freeze({ genres: [], creator: null, minRating: '', minMetacritic: '' });

function normalizeFilters(filters = EMPTY_SEARCH_FILTERS) {
  return {
    genres: Array.isArray(filters.genres) ? [...filters.genres] : [],
    creator: filters.creator ?? null,
    minRating: filters.minRating ?? '',
    minMetacritic: filters.minMetacritic ?? ''
  };
}

export function hasActiveSearchFilters(filters) {
  return Boolean(
    filters && (
      filters.genres?.length > 0 ||
      filters.creator ||
      filters.minRating !== '' && filters.minRating !== null && filters.minRating !== undefined ||
      filters.minMetacritic !== '' && filters.minMetacritic !== null && filters.minMetacritic !== undefined
    )
  );
}

const initialSearchState = {
  status: 'initial',
  query: '',
  results: [],
  source: null,
  pagination: null,
  providerErrors: [],
  error: null,
  loadingPage: null,
  loadingProvider: null,
  pageError: null
};

function emptySearchState(query = '', filters = EMPTY_SEARCH_FILTERS) {
  return {
    ...initialSearchState,
    query,
    filters: normalizeFilters(filters)
  };
}

function defaultProviderForType(type) {
  if (type === 'anime') return undefined;
  if (type === 'game') return undefined;
  return 'tmdb';
}

export function useMediaSearch({ type = 'anime' } = {}) {
  const [mediaType, setMediaType] = useState(type);
  const [query, setQuery] = useState('');
  const [includeAdult, setIncludeAdult] = useState(true);
  const [filters, setFilters] = useState(EMPTY_SEARCH_FILTERS);
  const [formError, setFormError] = useState(null);
  const [state, setState] = useState(initialSearchState);
  const debounceRef = useRef(null);
  const requestRef = useRef(null);
  const requestIdRef = useRef(0);
  const latestSubmittedQueryRef = useRef('');

  const cancelPendingWork = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    requestRef.current?.controller.abort();
    requestRef.current = null;
    requestIdRef.current += 1;
  }, []);

  const runSearch = useCallback((nextQuery, nextIncludeAdult, {
    page = 1,
    provider,
    requestedType = mediaType,
    cursor,
    retryProvider,
    filters: nextFilters = filters
  } = {}) => {
    const trimmedQuery = nextQuery.trim();
    const normalizedFilters = normalizeFilters(nextFilters);
    const filtersActive = hasActiveSearchFilters(normalizedFilters);
    if (requestedType === 'all' && filtersActive) {
      setFormError('Choose a catalog to use advanced filters.');
      return;
    }
    if (filtersActive && ['movie', 'tv'].includes(requestedType) && trimmedQuery) {
      setFormError('Clear the title before using advanced filters for movies or TV.');
      return;
    }
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    requestRef.current?.controller.abort();

    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    const isCombined = requestedType === 'all';
    requestRef.current = { controller, requestId };
    latestSubmittedQueryRef.current = trimmedQuery;
    setFormError(null);

    if (page === 1) {
      setState({
        ...emptySearchState(trimmedQuery, normalizedFilters),
        status: 'loading'
      });
    } else {
      setState((current) => ({
        ...current,
        status: 'success',
        loadingPage: page,
        loadingProvider: isCombined ? retryProvider ?? null : null,
        pageError: null
      }));
    }

    searchMedia({
      type: requestedType,
      query: trimmedQuery,
      page,
      includeAdult: nextIncludeAdult,
      filters: normalizedFilters,
      provider: isCombined ? undefined : provider ?? defaultProviderForType(requestedType),
      cursor: isCombined ? cursor : undefined,
      retryProvider: isCombined ? retryProvider : undefined,
      signal: controller.signal
    })
      .then((payload) => {
        if (requestRef.current?.requestId !== requestId) return;
        requestRef.current = null;
        setState((current) => {
          if (page === 1) {
            return {
              ...current,
              status: 'success',
              query: trimmedQuery,
              filters: normalizedFilters,
              results: payload.results,
              source: payload.source,
              pagination: payload.pagination,
              providerErrors: payload.providerErrors,
              error: null,
              loadingPage: null,
              loadingProvider: null,
              pageError: null
            };
          }

          const existingIds = new Set(current.results.map(mediaIdentity));
          const appendedResults = payload.results.filter((result) => !existingIds.has(mediaIdentity(result)));
          return {
            ...current,
            status: 'success',
            results: [...current.results, ...appendedResults],
            source: payload.source,
            pagination: payload.pagination,
            providerErrors: payload.providerErrors,
            loadingPage: null,
            loadingProvider: null,
            pageError: null
          };
        });
      })
      .catch((error) => {
        if (controller.signal.aborted || requestRef.current?.requestId !== requestId) return;
        requestRef.current = null;
        setState((current) => {
          if (page === 1) {
            return {
              ...emptySearchState(trimmedQuery),
              status: 'error',
              error,
              filters: normalizedFilters
            };
          }
          return {
            ...current,
            status: 'success',
            loadingPage: null,
            loadingProvider: null,
            pageError: { page, error, provider: isCombined ? retryProvider : undefined }
          };
        });
      });
  }, [cancelPendingWork, filters, mediaType]);

  const changeType = useCallback((nextType) => {
    if (!SEARCH_TYPES.has(nextType) || nextType === mediaType) return;

    cancelPendingWork();
    setMediaType(nextType);
    const nextFilters = normalizeFilters();
    setFilters(nextFilters);
    setFormError(null);
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      latestSubmittedQueryRef.current = '';
      setState(emptySearchState('', nextFilters));
      return;
    }

    setState({
      ...emptySearchState(trimmedQuery, nextFilters),
      status: 'loading'
    });
    runSearch(query, includeAdult, { requestedType: nextType, filters: nextFilters });
  }, [cancelPendingWork, includeAdult, mediaType, query, runSearch]);

  const changeQuery = useCallback((nextQuery) => {
    setQuery(nextQuery);
    cancelPendingWork();
    const trimmedQuery = nextQuery.trim();
    if (!trimmedQuery) {
      latestSubmittedQueryRef.current = '';
      setState(emptySearchState());
      return;
    }

    if (hasActiveSearchFilters(filters)) {
      setState(emptySearchState(trimmedQuery, state.filters));
      return;
    }

    setState({
      ...emptySearchState(trimmedQuery),
      status: 'loading'
    });
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      runSearch(nextQuery, includeAdult);
    }, SEARCH_DEBOUNCE_MS);
  }, [cancelPendingWork, includeAdult, filters, runSearch, state.filters]);

  const updateFilters = useCallback((patch) => {
    setFilters((current) => normalizeFilters({ ...current, ...patch }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(normalizeFilters());
    setFormError(null);
  }, []);

  const submitSearch = useCallback(() => {
    cancelPendingWork();
    runSearch(query, includeAdult, { filters });
  }, [cancelPendingWork, filters, includeAdult, query, runSearch]);

  const retrySearch = useCallback(() => {
    runSearch(latestSubmittedQueryRef.current, includeAdult, { filters: state.filters });
  }, [includeAdult, runSearch, state.filters]);

  const loadMore = useCallback(() => {
    if (!state.pagination?.hasMore || state.loadingPage) return;
    const nextPage = state.pagination.page + 1;
    runSearch(latestSubmittedQueryRef.current, includeAdult, {
      page: nextPage,
      provider: state.source,
      cursor: mediaType === 'all' ? state.pagination.continuation : undefined,
      filters: state.filters
    });
  }, [includeAdult, mediaType, runSearch, state.loadingPage, state.pagination, state.source]);

  const retryPage = useCallback(() => {
    if (!state.pageError?.page) return;
    if (mediaType === 'all' && state.pageError.provider) {
      runSearch(latestSubmittedQueryRef.current, includeAdult, {
        page: state.pageError.page,
        cursor: state.pagination?.continuation,
        retryProvider: state.pageError.provider,
        filters: state.filters
      });
      return;
    }
    runSearch(latestSubmittedQueryRef.current, includeAdult, {
      page: state.pageError.page,
      provider: state.source,
      cursor: mediaType === 'all' ? state.pagination?.continuation : undefined,
      filters: state.filters
    });
  }, [includeAdult, mediaType, runSearch, state.pageError, state.pagination, state.source]);

  const retryProvider = useCallback((provider) => {
    if (mediaType !== 'all' || !state.pagination?.continuation || state.loadingPage) return;
    runSearch(latestSubmittedQueryRef.current, includeAdult, {
      page: state.pagination.page + 1,
      cursor: state.pagination.continuation,
      retryProvider: provider,
      filters: state.filters
    });
  }, [includeAdult, mediaType, runSearch, state.loadingPage, state.pagination]);

  const toggleIncludeAdult = useCallback((nextValue) => {
    setIncludeAdult(nextValue);
    if (!query.trim()) {
      setState(emptySearchState());
      return;
    }
    if (hasActiveSearchFilters(filters)) return;
    cancelPendingWork();
    runSearch(query, nextValue);
  }, [cancelPendingWork, filters, query, runSearch]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    requestRef.current?.controller.abort();
  }, []);

  return {
    type: mediaType,
    query,
    changeQuery,
    changeType,
    includeAdult,
    toggleIncludeAdult,
    filters,
    appliedFilters: state.filters ?? EMPTY_SEARCH_FILTERS,
    updateFilters,
    clearFilters,
    formError,
    state,
    submitSearch,
    retrySearch,
    loadMore,
    retryPage,
    retryProvider,
    isBusy: state.status === 'loading' || state.loadingPage !== null
  };
}
