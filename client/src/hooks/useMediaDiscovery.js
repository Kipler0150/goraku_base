import { useCallback, useEffect, useRef, useState } from 'react';
import { getMediaDiscovery } from '../api/mediaDiscovery.js';
import { mediaIdentity } from '../mediaIdentity.js';

const INITIAL_STATE = Object.freeze({
  status: 'initial',
  operation: null,
  type: null,
  provider: null,
  results: [],
  source: null,
  pagination: null,
  providerErrors: [],
  error: null,
  loadingPage: null
});

function mergeResults(current, next) {
  const existingIds = new Set(current.map(mediaIdentity));
  return [...current, ...next.filter((media) => !existingIds.has(mediaIdentity(media)))];
}

export function useMediaDiscovery({ includeAdult = true } = {}) {
  const [state, setState] = useState(INITIAL_STATE);
  const requestRef = useRef(null);
  const latestOptionsRef = useRef(null);
  const appendRef = useRef(false);
  const includeAdultRef = useRef(includeAdult);

  const cancel = useCallback(() => {
    requestRef.current?.controller.abort();
    requestRef.current = null;
  }, []);

  const run = useCallback((options, { append = false } = {}) => {
    cancel();
    const requestOptions = { ...options, includeAdult, page: options.page ?? 1 };
    latestOptionsRef.current = requestOptions;
    appendRef.current = append;
    const controller = new AbortController();
    const request = { controller };
    requestRef.current = request;
    setState((current) => append
      ? { ...current, status: 'loading', loadingPage: requestOptions.page, error: null }
      : {
        ...INITIAL_STATE,
        status: 'loading',
        operation: requestOptions.operation,
        type: requestOptions.type,
        provider: requestOptions.provider ?? null
      });

    getMediaDiscovery({ ...requestOptions, signal: controller.signal })
      .then((payload) => {
        if (requestRef.current !== request) return;
        requestRef.current = null;
        setState((current) => ({
          ...current,
          status: 'success',
          operation: requestOptions.operation,
          type: requestOptions.type,
          provider: payload.source,
          results: append ? mergeResults(current.results, payload.results) : payload.results,
          source: payload.source,
          pagination: payload.pagination,
          providerErrors: payload.providerErrors,
          error: null,
          loadingPage: null
        }));
      })
      .catch((error) => {
        if (controller.signal.aborted || requestRef.current !== request) return;
        requestRef.current = null;
        setState((current) => ({
          ...current,
          status: 'error',
          error,
          loadingPage: null
        }));
      });
  }, [cancel, includeAdult]);

  const load = useCallback((options) => run(options), [run]);

  const retry = useCallback(() => {
    if (latestOptionsRef.current) run(latestOptionsRef.current, { append: appendRef.current });
  }, [run]);

  const loadMore = useCallback(() => {
    const options = latestOptionsRef.current;
    if (requestRef.current || !options || !state.pagination?.hasMore || state.loadingPage) return;
    run({ ...options, page: state.pagination.page + 1 }, { append: true });
  }, [run, state.loadingPage, state.pagination]);

  const clear = useCallback(() => {
    cancel();
    latestOptionsRef.current = null;
    appendRef.current = false;
    setState(INITIAL_STATE);
  }, [cancel]);

  useEffect(() => () => cancel(), [cancel]);
  useEffect(() => {
    if (includeAdultRef.current === includeAdult) return;
    includeAdultRef.current = includeAdult;
    if (latestOptionsRef.current) run({ ...latestOptionsRef.current, page: 1 });
  }, [includeAdult, run]);

  return {
    ...state,
    state,
    load,
    retry,
    loadMore,
    clear,
    isBusy: state.status === 'loading'
  };
}
