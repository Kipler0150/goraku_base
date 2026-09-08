import { useCallback, useEffect, useRef, useState } from 'react';
import { searchMedia } from '../api/mediaSearch.js';

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_TYPES = new Set(['anime', 'movie', 'tv']);

const initialSearchState = {
  status: 'initial',
  query: '',
  results: [],
  source: null,
  pagination: null,
  error: null,
  loadingPage: null,
  pageError: null
};

function emptySearchState(query = '') {
  return {
    ...initialSearchState,
    query
  };
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

  const runSearch = useCallback((nextQuery, nextIncludeAdult, page = 1, provider, requestedType = mediaType) => {
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
        pageError: null
      }));
    }

    searchMedia({
      type: requestedType,
      query: trimmedQuery,
      page,
      includeAdult: nextIncludeAdult,
      provider: provider ?? (requestedType === 'anime' ? undefined : 'tmdb'),
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
              error: null,
              loadingPage: null,
              pageError: null
            };
          }
          return {
            ...current,
            status: 'success',
            results: [...current.results, ...payload.results],
            source: payload.source,
            pagination: payload.pagination,
            loadingPage: null,
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
            pageError: { page, error }
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
    runSearch(query, includeAdult, 1, undefined, nextType);
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
      runSearch(nextQuery, includeAdult, 1);
    }, SEARCH_DEBOUNCE_MS);
  }, [cancelPendingWork, includeAdult, runSearch]);

  const submitSearch = useCallback(() => {
    cancelPendingWork();
    runSearch(query, includeAdult, 1);
  }, [cancelPendingWork, includeAdult, query, runSearch]);

  const retrySearch = useCallback(() => {
    runSearch(latestSubmittedQueryRef.current, includeAdult, 1);
  }, [includeAdult, runSearch]);

  const loadMore = useCallback(() => {
    if (!state.pagination?.hasMore || state.loadingPage) return;
    runSearch(latestSubmittedQueryRef.current, includeAdult, state.pagination.page + 1, state.source);
  }, [includeAdult, runSearch, state.loadingPage, state.pagination, state.source]);

  const retryPage = useCallback(() => {
    if (!state.pageError?.page) return;
    runSearch(latestSubmittedQueryRef.current, includeAdult, state.pageError.page, state.source);
  }, [includeAdult, runSearch, state.pageError, state.source]);

  const toggleIncludeAdult = useCallback((nextValue) => {
    setIncludeAdult(nextValue);
    if (!query.trim()) {
      setState(emptySearchState());
      return;
    }
    cancelPendingWork();
    runSearch(query, nextValue, 1);
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
    isBusy: state.status === 'loading' || state.loadingPage !== null
  };
}
