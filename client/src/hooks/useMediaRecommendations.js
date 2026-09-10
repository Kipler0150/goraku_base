import { useCallback, useEffect, useRef, useState } from 'react';
import { getMediaRecommendations } from '../api/mediaDiscovery.js';
import { mediaIdentity } from '../mediaIdentity.js';

const INITIAL_STATE = Object.freeze({
  status: 'idle',
  anchor: null,
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

export function useMediaRecommendations({ includeAdult = true } = {}) {
  const [state, setState] = useState(INITIAL_STATE);
  const requestRef = useRef(null);
  const latestOptionsRef = useRef(null);
  const includeAdultRef = useRef(includeAdult);

  const cancel = useCallback(() => {
    requestRef.current?.controller.abort();
    requestRef.current = null;
  }, []);

  const run = useCallback((anchor, { page = 1, append = false } = {}) => {
    cancel();
    const options = {
      provider: anchor?.provider,
      type: typeof anchor?.type === 'string' ? anchor.type.toLowerCase() : anchor?.type,
      providerId: anchor?.providerId,
      page,
      perPage: 12,
      includeAdult
    };
    latestOptionsRef.current = { anchor, options };
    const controller = new AbortController();
    const request = { controller };
    requestRef.current = request;
    setState((current) => append
      ? { ...current, status: 'loading', loadingPage: page, error: null }
      : { ...INITIAL_STATE, status: 'loading', anchor });

    getMediaRecommendations({ ...options, signal: controller.signal })
      .then((payload) => {
        if (requestRef.current !== request) return;
        requestRef.current = null;
        setState((current) => ({
          ...current,
          status: 'success',
          anchor,
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
        setState((current) => ({ ...current, status: 'error', error, loadingPage: null }));
      });
  }, [cancel, includeAdult]);

  const load = useCallback((anchor) => run(anchor), [run]);
  const retry = useCallback(() => {
    if (latestOptionsRef.current) run(latestOptionsRef.current.anchor, latestOptionsRef.current.options);
  }, [run]);
  const loadMore = useCallback(() => {
    const latest = latestOptionsRef.current;
    if (!latest || !state.pagination?.hasMore || state.loadingPage) return;
    run(latest.anchor, { page: state.pagination.page + 1, append: true });
  }, [run, state.loadingPage, state.pagination]);
  const clear = useCallback(() => {
    cancel();
    latestOptionsRef.current = null;
    setState(INITIAL_STATE);
  }, [cancel]);

  useEffect(() => () => cancel(), [cancel]);
  useEffect(() => {
    if (includeAdultRef.current === includeAdult) return;
    includeAdultRef.current = includeAdult;
    if (latestOptionsRef.current?.anchor) run(latestOptionsRef.current.anchor);
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
