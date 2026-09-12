import { useCallback, useEffect, useRef, useState } from 'react';
import {
  attachCollection,
  attachTag,
  detachCollection,
  detachTag
} from '../api/tagsCollections.js';
import { createLibraryItem, listLibrary, removeLibraryItem, updateLibraryItem } from '../api/library.js';
import { mediaIdentity } from '../mediaIdentity.js';

const DEFAULT_FILTERS = Object.freeze({
  libraryStatus: undefined,
  favorite: undefined,
  tagId: undefined,
  collectionId: undefined
});

const emptyState = {
  status: 'idle',
  results: [],
  pagination: null,
  error: null,
  pageError: null,
  loadingPage: false,
  savedIdentities: [],
  action: null,
  actions: {},
  actionErrors: {},
  filters: DEFAULT_FILTERS
};

function normalizeFilters(filters = {}) {
  return {
    libraryStatus: filters.libraryStatus || undefined,
    favorite: filters.favorite === undefined || filters.favorite === '' ? undefined : filters.favorite,
    tagId: filters.tagId || undefined,
    collectionId: filters.collectionId || undefined
  };
}

function matchesFilters(item, filters) {
  return (filters.libraryStatus === undefined || item.libraryStatus === filters.libraryStatus)
    && (filters.favorite === undefined || item.favorite === filters.favorite)
    && (filters.tagId === undefined || item.tags.some((tag) => tag.id === filters.tagId))
    && (filters.collectionId === undefined || item.collections.some((collection) => collection.id === filters.collectionId));
}

function addOrReplaceItem(results, item, filters) {
  const withoutItem = results.filter((existing) => existing.id !== item.id);
  return matchesFilters(item, filters) ? [item, ...withoutItem] : withoutItem;
}

function updateItemInResults(results, item, filters) {
  if (!item || !matchesFilters(item, filters)) return results.filter((existing) => existing.id !== item?.id);
  return results.map((existing) => existing.id === item.id ? item : existing);
}

function actionFor(id, field) {
  return `${id}:${field}`;
}

export function useLibrary({ enabled = false, onAuthenticationRequired } = {}) {
  const [state, setState] = useState(emptyState);
  const listRequestRef = useRef(null);
  const listRequestIdRef = useRef(0);
  const filtersRef = useRef(DEFAULT_FILTERS);
  const itemMutationQueuesRef = useRef(new Map());

  const cancelList = useCallback(() => {
    listRequestRef.current?.controller.abort();
    listRequestRef.current = null;
    listRequestIdRef.current += 1;
  }, []);

  const load = useCallback(({ page = 1, append = false, filters = filtersRef.current } = {}) => {
    if (!enabled) return;
    cancelList();
    const controller = new AbortController();
    const requestId = ++listRequestIdRef.current;
    listRequestRef.current = { controller, requestId };
    setState((current) => ({
      ...current,
      status: append ? current.status : 'loading',
      loadingPage: append,
      error: null,
      pageError: append ? null : current.pageError,
      filters
    }));

    listLibrary({ page, perPage: 20, ...filters, signal: controller.signal })
      .then((payload) => {
        if (listRequestRef.current?.requestId !== requestId) return;
        listRequestRef.current = null;
        setState((current) => {
          const results = append
            ? [...current.results, ...payload.results.filter((item) => !current.results.some((existing) => existing.id === item.id))]
            : payload.results;
          const savedIdentities = [...new Set([
            ...current.savedIdentities,
            ...payload.results.map((item) => mediaIdentity(item))
          ])];
          return {
            ...current,
            status: 'success',
            results,
            pagination: payload.pagination,
            savedIdentities,
            error: null,
            pageError: null,
            loadingPage: false,
            filters
          };
        });
      })
      .catch((error) => {
        if (controller.signal.aborted || listRequestRef.current?.requestId !== requestId) return;
        listRequestRef.current = null;
        if (error.status === 401) onAuthenticationRequired?.();
        setState((current) => ({
          ...current,
          status: append && current.results.length > 0 ? 'success' : 'error',
          error,
          pageError: append ? { page, error } : null,
          loadingPage: false
        }));
      });
  }, [cancelList, enabled, onAuthenticationRequired]);

  useEffect(() => {
    if (enabled) {
      load();
      return () => cancelList();
    }
    cancelList();
    filtersRef.current = DEFAULT_FILTERS;
    setState(emptyState);
    return undefined;
  }, [cancelList, enabled, load]);

  const applyFilters = useCallback((nextFilters) => {
    const filters = normalizeFilters(nextFilters);
    filtersRef.current = filters;
    load({ page: 1, filters });
  }, [load]);

  const loadMore = useCallback(() => {
    if (state.loadingPage || !state.pagination?.hasMore || listRequestRef.current) return;
    load({ page: state.pagination.page + 1, append: true });
  }, [load, state.loadingPage, state.pagination]);

  const retryPage = useCallback(() => {
    if (!state.pageError) return;
    load({ page: state.pageError.page, append: true });
  }, [load, state.pageError]);

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
      const next = {
        ...current,
        actions,
        action: current.action?.key === key ? null : current.action
      };
      return update(next);
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

  const enqueueItemMutation = useCallback((id, operation) => {
    const previous = itemMutationQueuesRef.current.get(id) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    itemMutationQueuesRef.current.set(id, current);
    current.then(
      () => { if (itemMutationQueuesRef.current.get(id) === current) itemMutationQueuesRef.current.delete(id); },
      () => { if (itemMutationQueuesRef.current.get(id) === current) itemMutationQueuesRef.current.delete(id); }
    );
    return current;
  }, []);

  const save = useCallback(async (media) => {
    if (!enabled) return null;
    const identity = mediaIdentity(media);
    const key = `save:${identity}`;
    beginAction(key, { type: 'save', key: identity });
    try {
      const item = await createLibraryItem(media);
      finishAction(key, (current) => ({
        ...current,
        status: current.status === 'idle' ? 'success' : current.status,
        results: addOrReplaceItem(current.results, item, current.filters),
        savedIdentities: current.savedIdentities.includes(identity)
          ? current.savedIdentities
          : [...current.savedIdentities, identity],
        error: null
      }));
      return item;
    } catch (error) {
      if (error.status === 401) onAuthenticationRequired?.();
      if (error.status === 409 || error.code === 'CONFLICT') {
        finishAction(key, (current) => ({
          ...current,
          savedIdentities: current.savedIdentities.includes(identity)
            ? current.savedIdentities
            : [...current.savedIdentities, identity],
          error: null
        }));
        return null;
      }
      failAction(key, error);
      return null;
    }
  }, [beginAction, enabled, failAction, finishAction, onAuthenticationRequired]);

  const update = useCallback(async (id, changes, { actionKey = Object.keys(changes)[0] ?? 'update' } = {}) => {
    if (!enabled) return null;
    const key = actionFor(id, actionKey);
    beginAction(key, { type: 'update', id, field: actionKey });
    return enqueueItemMutation(id, async () => {
      try {
        const item = await updateLibraryItem(id, changes);
        finishAction(key, (current) => ({
          ...current,
          results: updateItemInResults(current.results, item, current.filters),
          error: null
        }));
        return item;
      } catch (error) {
        if (error.status === 401) onAuthenticationRequired?.();
        failAction(key, error);
        return null;
      }
    });
  }, [beginAction, enabled, enqueueItemMutation, failAction, finishAction, onAuthenticationRequired]);

  const remove = useCallback(async (id) => {
    if (!enabled) return null;
    const key = actionFor(id, 'remove');
    beginAction(key, { type: 'remove', id });
    return enqueueItemMutation(id, async () => {
      try {
        await removeLibraryItem(id);
        finishAction(key, (current) => {
          const removedItem = current.results.find((item) => item.id === id);
          const removedIdentity = removedItem ? mediaIdentity(removedItem) : null;
          return {
            ...current,
            results: current.results.filter((item) => item.id !== id),
            savedIdentities: removedIdentity
              ? current.savedIdentities.filter((identity) => identity !== removedIdentity)
              : current.savedIdentities,
            error: null
          };
        });
        return true;
      } catch (error) {
        if (error.status === 401) onAuthenticationRequired?.();
        failAction(key, error);
        return false;
      }
    });
  }, [beginAction, enabled, enqueueItemMutation, failAction, finishAction, onAuthenticationRequired]);

  const findSavedItem = useCallback((media) => {
    const identity = mediaIdentity(media);
    return state.results.find((item) => mediaIdentity(item) === identity);
  }, [state.results]);

  const removeMedia = useCallback((media) => {
    const item = findSavedItem(media);
    return item ? remove(item.id) : null;
  }, [findSavedItem, remove]);

  const changeMembership = useCallback(async (kind, libraryItemId, resource, attached) => {
    if (!enabled) return false;
    const resourceId = resource.id;
    const field = `${kind}:${resourceId}`;
    const key = actionFor(libraryItemId, field);
    beginAction(key, { type: attached ? 'attach' : 'detach', id: libraryItemId, field });
    const request = kind === 'tag'
      ? (attached ? attachTag : detachTag)
      : (attached ? attachCollection : detachCollection);
    return enqueueItemMutation(libraryItemId, async () => {
      try {
        await request(libraryItemId, resourceId);
        finishAction(key, (current) => {
          const item = current.results.find((existing) => existing.id === libraryItemId);
          if (!item) return current;
          const fieldName = kind === 'tag' ? 'tags' : 'collections';
          const relationships = attached
            ? [...item[fieldName].filter((entry) => entry.id !== resourceId), resource]
            : item[fieldName].filter((entry) => entry.id !== resourceId);
          return {
            ...current,
            results: updateItemInResults(current.results, { ...item, [fieldName]: relationships }, current.filters),
            error: null
          };
        });
        return true;
      } catch (error) {
        if (error.status === 401) onAuthenticationRequired?.();
        failAction(key, error);
        return false;
      }
    });
  }, [beginAction, enabled, enqueueItemMutation, failAction, finishAction, onAuthenticationRequired]);

  const getItemError = useCallback((id) => Object.entries(state.actionErrors)
    .find(([key]) => key.startsWith(`${id}:`))?.[1] ?? null, [state.actionErrors]);

  const isSaved = useCallback((media) => state.savedIdentities.includes(mediaIdentity(media)), [state.savedIdentities]);
  const isSaveBusy = useCallback((identity) => Boolean(state.actions[`save:${identity}`]), [state.actions]);
  const isRemoveBusy = useCallback((media) => {
    const item = findSavedItem(media);
    return item ? Boolean(state.actions[actionFor(item.id, 'remove')]) : false;
  }, [findSavedItem, state.actions]);
  const isActionBusy = useCallback((id, field) => Boolean(state.actions[actionFor(id, field)]), [state.actions]);
  const isItemBusy = useCallback((id) => Object.keys(state.actions).some((key) => key.startsWith(`${id}:`)), [state.actions]);

  return {
    ...state,
    load,
    retry: load,
    retryPage,
    loadMore,
    applyFilters,
    save,
    update,
    remove,
    removeMedia,
    findSavedItem,
    attach: (id, kind, resource) => changeMembership(kind, id, resource, true),
    detach: (id, kind, resource) => changeMembership(kind, id, resource, false),
    getItemError,
    isSaved,
    isSaveBusy,
    isRemoveBusy,
    isActionBusy,
    isItemBusy,
    isBusy: state.status === 'loading' || state.loadingPage || Object.keys(state.actions).length > 0
  };
}
