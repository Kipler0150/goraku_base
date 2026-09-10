import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createCollection,
  createTag,
  listCollections,
  listTags,
  removeCollection,
  removeTag,
  updateCollection,
  updateTag
} from '../api/tagsCollections.js';

const emptyState = {
  status: 'idle',
  tags: [],
  collections: [],
  tagPagination: null,
  collectionPagination: null,
  loadingMore: { tag: false, collection: false },
  pageErrors: { tag: null, collection: null },
  error: null,
  action: null,
  actions: {},
  actionErrors: {}
};

function resourceSort(a, b) {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id);
}

function resourceKey(kind, id) {
  return `${kind}:${id}`;
}

export function useTaxonomy({ enabled = false, onAuthenticationRequired } = {}) {
  const [state, setState] = useState(emptyState);
  const requestRef = useRef(null);
  const requestIdRef = useRef(0);
  const pageRequestsRef = useRef(new Map());

  const cancel = useCallback(() => {
    requestRef.current?.controller.abort();
    requestRef.current = null;
    for (const { controller } of pageRequestsRef.current.values()) controller.abort();
    pageRequestsRef.current.clear();
    requestIdRef.current += 1;
  }, []);

  const load = useCallback(() => {
    if (!enabled) return;
    cancel();
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    requestRef.current = { controller, requestId };
    setState((current) => ({
      ...current,
      status: 'loading',
      loadingMore: { tag: false, collection: false },
      pageErrors: { tag: null, collection: null },
      error: null
    }));
    Promise.all([
      listTags({ page: 1, perPage: 50, signal: controller.signal }),
      listCollections({ page: 1, perPage: 50, signal: controller.signal })
    ])
      .then(([tags, collections]) => {
        if (requestRef.current?.requestId !== requestId) return;
        requestRef.current = null;
        setState((current) => ({
          ...current,
          status: 'success',
          tags: [...tags.results].sort(resourceSort),
          collections: [...collections.results].sort(resourceSort),
          tagPagination: tags.pagination,
          collectionPagination: collections.pagination,
          loadingMore: { tag: false, collection: false },
          pageErrors: { tag: null, collection: null },
          error: null
        }));
      })
      .catch((error) => {
        if (controller.signal.aborted || requestRef.current?.requestId !== requestId) return;
        requestRef.current = null;
        if (error.status === 401) onAuthenticationRequired?.();
        setState((current) => ({
          ...current,
          status: 'error',
          loadingMore: { tag: false, collection: false },
          error
        }));
      });
  }, [cancel, enabled, onAuthenticationRequired]);

  useEffect(() => {
    if (enabled) {
      load();
      return () => cancel();
    }
    cancel();
    setState(emptyState);
    return undefined;
  }, [cancel, enabled, load]);

  const loadMore = useCallback((kind, requestedPage) => {
    if (!enabled || (kind !== 'tag' && kind !== 'collection')) return;
    const pagination = kind === 'tag' ? state.tagPagination : state.collectionPagination;
    const page = requestedPage ?? (pagination ? pagination.page + 1 : null);
    if (!pagination?.hasMore || !page || state.loadingMore[kind] || pageRequestsRef.current.has(kind)) return;

    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    pageRequestsRef.current.set(kind, { controller, requestId });
    const request = kind === 'tag' ? listTags : listCollections;
    const resourceField = kind === 'tag' ? 'tags' : 'collections';
    const paginationField = kind === 'tag' ? 'tagPagination' : 'collectionPagination';
    setState((current) => ({
      ...current,
      error: null,
      loadingMore: { ...current.loadingMore, [kind]: true },
      pageErrors: { ...current.pageErrors, [kind]: null }
    }));

    request({ page, perPage: pagination.perPage, signal: controller.signal })
      .then((payload) => {
        if (pageRequestsRef.current.get(kind)?.requestId !== requestId) return;
        pageRequestsRef.current.delete(kind);
        setState((current) => ({
          ...current,
          [resourceField]: [
            ...current[resourceField],
            ...payload.results.filter((resource) => !current[resourceField].some((existing) => existing.id === resource.id))
          ].sort(resourceSort),
          [paginationField]: payload.pagination,
          loadingMore: { ...current.loadingMore, [kind]: false },
          pageErrors: { ...current.pageErrors, [kind]: null }
        }));
      })
      .catch((error) => {
        if (controller.signal.aborted || pageRequestsRef.current.get(kind)?.requestId !== requestId) return;
        pageRequestsRef.current.delete(kind);
        if (error.status === 401) onAuthenticationRequired?.();
        setState((current) => ({
          ...current,
          loadingMore: { ...current.loadingMore, [kind]: false },
          pageErrors: { ...current.pageErrors, [kind]: { page, error } }
        }));
      });
  }, [enabled, onAuthenticationRequired, state.collectionPagination, state.loadingMore, state.tagPagination]);

  const retryPage = useCallback((kind) => {
    const page = state.pageErrors[kind]?.page;
    if (page) loadMore(kind, page);
  }, [loadMore, state.pageErrors]);

  const beginAction = useCallback((key, action) => {
    setState((current) => {
      const { [key]: ignored, ...actionErrors } = current.actionErrors;
      return {
        ...current,
        error: null,
        action: { ...action, key },
        actions: { ...current.actions, [key]: action },
        actionErrors
      };
    });
  }, []);

  const finishAction = useCallback((key, update) => {
    setState((current) => {
      const { [key]: ignored, ...actions } = current.actions;
      return update({
        ...current,
        actions,
        action: current.action?.key === key ? null : current.action
      });
    });
  }, []);

  const failAction = useCallback((key, error) => {
    setState((current) => {
      const { [key]: ignored, ...actions } = current.actions;
      return {
        ...current,
        error,
        actions,
        action: current.action?.key === key ? null : current.action,
        actionErrors: { ...current.actionErrors, [key]: error }
      };
    });
  }, []);

  const create = useCallback(async (kind, name) => {
    if (!enabled) return null;
    const key = resourceKey(kind, 'create');
    beginAction(key, { type: 'create', kind });
    const request = kind === 'tag' ? createTag : createCollection;
    try {
      const resource = await request(name);
      finishAction(key, (current) => ({
        ...current,
        [kind === 'tag' ? 'tags' : 'collections']: [...current[kind === 'tag' ? 'tags' : 'collections'], resource].sort(resourceSort),
        error: null
      }));
      return resource;
    } catch (error) {
      if (error.status === 401) onAuthenticationRequired?.();
      failAction(key, error);
      return null;
    }
  }, [beginAction, enabled, failAction, finishAction, onAuthenticationRequired]);

  const update = useCallback(async (kind, id, name) => {
    if (!enabled) return null;
    const key = resourceKey(kind, id);
    beginAction(key, { type: 'rename', kind, id });
    const request = kind === 'tag' ? updateTag : updateCollection;
    try {
      const resource = await request(id, name);
      finishAction(key, (current) => ({
        ...current,
        [kind === 'tag' ? 'tags' : 'collections']: current[kind === 'tag' ? 'tags' : 'collections']
          .map((existing) => existing.id === id ? resource : existing)
          .sort(resourceSort),
        error: null
      }));
      return resource;
    } catch (error) {
      if (error.status === 401) onAuthenticationRequired?.();
      failAction(key, error);
      return null;
    }
  }, [beginAction, enabled, failAction, finishAction, onAuthenticationRequired]);

  const remove = useCallback(async (kind, id) => {
    if (!enabled) return false;
    const key = resourceKey(kind, id);
    beginAction(key, { type: 'remove', kind, id });
    const request = kind === 'tag' ? removeTag : removeCollection;
    try {
      await request(id);
      finishAction(key, (current) => ({
        ...current,
        [kind === 'tag' ? 'tags' : 'collections']: current[kind === 'tag' ? 'tags' : 'collections'].filter((resource) => resource.id !== id),
        error: null
      }));
      return true;
    } catch (error) {
      if (error.status === 401) onAuthenticationRequired?.();
      failAction(key, error);
      return false;
    }
  }, [beginAction, enabled, failAction, finishAction, onAuthenticationRequired]);

  const getError = useCallback((kind, id = 'create') => state.actionErrors[resourceKey(kind, id)] ?? null, [state.actionErrors]);
  const isActionBusy = useCallback((kind, id = 'create') => Boolean(state.actions[resourceKey(kind, id)]), [state.actions]);

  return {
    ...state,
    load,
    retry: load,
    loadMore,
    retryPage,
    create,
    update,
    remove,
    getError,
    isActionBusy,
    isBusy: state.status === 'loading'
      || Object.values(state.loadingMore).some(Boolean)
      || Object.keys(state.actions).length > 0
  };
}
