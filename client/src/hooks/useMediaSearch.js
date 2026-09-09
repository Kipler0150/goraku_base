import { useCallback, useEffect, useRef, useState } from 'react';
import { searchMedia } from '../api/mediaSearch.js';
import { mediaIdentity } from '../mediaIdentity.js';

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_TYPES = new Set(['anime', 'movie', 'tv', 'game', 'all']);

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

function emptySearchState(query = '') {
  return {
    ...initialSearchState,
    query
  };
}

function defaultProviderForType(type) {
  if (type === 'anime') return undefined;
  if (type === 'game') return 'rawg';
  return 'tmdb';
}

export function useMediaSearch({ type = 'anime' } = {}) {
  const [mediaType, setMediaType] = useState(type);
  const [query, setQuery] = useState('');
  const [includeAdult, setIncludeAdult] = useState(true);
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
    retryProvider
  } = {}) => {
    const trimmedQuery = nextQuery.trim();
    if (!trimmedQuery) {
      cancelPendingWork();
      latestSubmittedQueryRef.current = '';
      setState(emptySearchState());
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

    if (page === 1) {
      setState({
        ...emptySearchState(trimmedQuery),
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
              error
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
  }, [cancelPendingWork, mediaType]);

  const changeType = useCallback((nextType) => {
    if (!SEARCH_TYPES.has(nextType) || nextType === mediaType) return;

    cancelPendingWork();
    setMediaType(nextType);
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      latestSubmittedQueryRef.current = '';
      setState(emptySearchState());
      return;
    }

    setState({
      ...emptySearchState(trimmedQuery),
      status: 'loading'
    });
    runSearch(query, includeAdult, { requestedType: nextType });
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

    setState({
      ...emptySearchState(trimmedQuery),
      status: 'loading'
    });
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      runSearch(nextQuery, includeAdult);
    }, SEARCH_DEBOUNCE_MS);
  }, [cancelPendingWork, includeAdult, runSearch]);

  const submitSearch = useCallback(() => {
    cancelPendingWork();
    runSearch(query, includeAdult);
  }, [cancelPendingWork, includeAdult, query, runSearch]);

  const retrySearch = useCallback(() => {
    runSearch(latestSubmittedQueryRef.current, includeAdult);
  }, [includeAdult, runSearch]);

  const loadMore = useCallback(() => {
    if (!state.pagination?.hasMore || state.loadingPage) return;
    const nextPage = state.pagination.page + 1;
    runSearch(latestSubmittedQueryRef.current, includeAdult, {
      page: nextPage,
      provider: state.source,
      cursor: mediaType === 'all' ? state.pagination.continuation : undefined
    });
  }, [includeAdult, mediaType, runSearch, state.loadingPage, state.pagination, state.source]);

  const retryPage = useCallback(() => {
    if (!state.pageError?.page) return;
    if (mediaType === 'all' && state.pageError.provider) {
      runSearch(latestSubmittedQueryRef.current, includeAdult, {
        page: state.pageError.page,
        cursor: state.pagination?.continuation,
        retryProvider: state.pageError.provider
      });
      return;
    }
    runSearch(latestSubmittedQueryRef.current, includeAdult, {
      page: state.pageError.page,
      provider: state.source,
      cursor: mediaType === 'all' ? state.pagination?.continuation : undefined
    });
  }, [includeAdult, mediaType, runSearch, state.pageError, state.pagination, state.source]);

  const retryProvider = useCallback((provider) => {
    if (mediaType !== 'all' || !state.pagination?.continuation || state.loadingPage) return;
    runSearch(latestSubmittedQueryRef.current, includeAdult, {
      page: state.pagination.page + 1,
      cursor: state.pagination.continuation,
      retryProvider: provider
    });
  }, [includeAdult, mediaType, runSearch, state.loadingPage, state.pagination]);

  const toggleIncludeAdult = useCallback((nextValue) => {
    setIncludeAdult(nextValue);
    if (!query.trim()) {
      setState(emptySearchState());
      return;
    }
    cancelPendingWork();
    runSearch(query, nextValue);
  }, [cancelPendingWork, query, runSearch]);

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
    state,
    submitSearch,
    retrySearch,
    loadMore,
    retryPage,
    retryProvider,
    isBusy: state.status === 'loading' || state.loadingPage !== null
  };
}
