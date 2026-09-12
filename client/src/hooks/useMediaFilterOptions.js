import { useCallback, useEffect, useRef, useState } from 'react';
import { getMediaFilterOptions } from '../api/mediaSearch.js';

const FILTERABLE_TYPES = new Set(['anime', 'movie', 'tv', 'game']);

export function useMediaFilterOptions({ type, includeAdult = true, creatorQuery = '', enabled = true } = {}) {
  const [state, setState] = useState({ status: 'idle', type, source: null, genres: [], creators: [], rating: null, error: null });
  const requestRef = useRef(null);
  const requestIdRef = useRef(0);

  const load = useCallback((nextType = type, nextCreatorQuery = creatorQuery) => {
    if (!FILTERABLE_TYPES.has(nextType)) {
      requestRef.current?.abort();
      setState({ status: 'disabled', type: nextType, source: null, genres: [], creators: [], rating: null, error: null });
      return;
    }

    if (!enabled) return;

    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const requestId = ++requestIdRef.current;
    setState((current) => ({ ...current, status: 'loading', type: nextType, error: null }));
    getMediaFilterOptions({ type: nextType, creatorQuery: nextCreatorQuery, includeAdult, signal: controller.signal })
      .then((payload) => {
        if (requestIdRef.current !== requestId) return;
        requestRef.current = null;
        setState({ status: 'success', type: payload.type, source: payload.source, genres: payload.genres, creators: payload.creators, rating: payload.rating, error: null });
      })
      .catch((error) => {
        if (controller.signal.aborted || requestIdRef.current !== requestId) return;
        requestRef.current = null;
        setState((current) => ({ ...current, status: 'error', type: nextType, error }));
      });
  }, [creatorQuery, enabled, includeAdult, type]);

  useEffect(() => {
    load(type, creatorQuery);
    return () => requestRef.current?.abort();
  }, [load, type]);

  return {
    ...state,
    isBusy: state.status === 'loading',
    retry: () => load(type, creatorQuery)
  };
}
