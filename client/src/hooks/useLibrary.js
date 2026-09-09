import { useCallback, useEffect, useRef, useState } from 'react';
import { createLibraryItem, listLibrary, removeLibraryItem, updateLibraryItem } from '../api/library.js';
import { mediaIdentity } from '../mediaIdentity.js';

const emptyState = {
  status: 'idle',
  results: [],
  pagination: null,
  error: null,
  action: null
};

export function useLibrary({ enabled = false, onAuthenticationRequired } = {}) {
  const [state, setState] = useState(emptyState);
  const listRequestRef = useRef(null);
  const listRequestIdRef = useRef(0);

  const cancelList = useCallback(() => {
    listRequestRef.current?.controller.abort();
    listRequestRef.current = null;
    listRequestIdRef.current += 1;
  }, []);

  const load = useCallback(() => {
    if (!enabled) return;
    cancelList();
    const controller = new AbortController();
    const requestId = ++listRequestIdRef.current;
    listRequestRef.current = { controller, requestId };
    setState((current) => ({ ...current, status: 'loading', error: null }));

    listLibrary({ signal: controller.signal })
      .then((payload) => {
        if (listRequestRef.current?.requestId !== requestId) return;
        listRequestRef.current = null;
        setState({ status: 'success', results: payload.results, pagination: payload.pagination, error: null, action: null });
      })
      .catch((error) => {
        if (controller.signal.aborted || listRequestRef.current?.requestId !== requestId) return;
        listRequestRef.current = null;
        if (error.status === 401) onAuthenticationRequired?.();
        setState((current) => ({ ...current, status: 'error', error, action: null }));
      });
  }, [cancelList, enabled, onAuthenticationRequired]);

  useEffect(() => {
    if (enabled) {
      load();
      return () => cancelList();
    }
    cancelList();
    setState(emptyState);
    return undefined;
  }, [cancelList, enabled, load]);

  const save = useCallback(async (media) => {
    if (!enabled) return null;
    const key = mediaIdentity(media);
    setState((current) => ({ ...current, error: null, action: { type: 'save', key } }));
    try {
      const item = await createLibraryItem(media);
      setState((current) => ({
        ...current,
        status: current.status === 'idle' ? 'success' : current.status,
        results: [item, ...current.results.filter((existing) => mediaIdentity(existing) !== mediaIdentity(item))],
        error: null,
        action: null
      }));
      return item;
    } catch (error) {
      if (error.status === 401) onAuthenticationRequired?.();
      setState((current) => ({ ...current, error, action: null }));
      return null;
    }
  }, [enabled, onAuthenticationRequired]);

  const update = useCallback(async (id, changes) => {
    if (!enabled) return null;
    setState((current) => ({ ...current, error: null, action: { type: 'update', id } }));
    try {
      const item = await updateLibraryItem(id, changes);
      setState((current) => ({
        ...current,
        results: current.results.map((existing) => existing.id === item.id ? item : existing),
        error: null,
        action: null
      }));
      return item;
    } catch (error) {
      if (error.status === 401) onAuthenticationRequired?.();
      setState((current) => ({ ...current, error, action: null }));
      return null;
    }
  }, [enabled, onAuthenticationRequired]);

  const remove = useCallback(async (id) => {
    if (!enabled) return null;
    setState((current) => ({ ...current, error: null, action: { type: 'remove', id } }));
    try {
      await removeLibraryItem(id);
      setState((current) => ({
        ...current,
        results: current.results.filter((item) => item.id !== id),
        error: null,
        action: null
      }));
      return true;
    } catch (error) {
      if (error.status === 401) onAuthenticationRequired?.();
      setState((current) => ({ ...current, error, action: null }));
      return false;
    }
  }, [enabled, onAuthenticationRequired]);

  return {
    ...state,
    load,
    retry: load,
    save,
    update,
    remove,
    isBusy: state.status === 'loading' || state.action !== null
  };
}
