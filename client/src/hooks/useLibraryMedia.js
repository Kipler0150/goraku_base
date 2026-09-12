import { useCallback, useEffect, useRef, useState } from 'react';
import { getMediaDetails } from '../api/mediaDetails.js';
import { mediaIdentity } from '../mediaIdentity.js';

const MEDIA_CACHE_TTL_MS = 300000;
const MAX_CONCURRENT_LOOKUPS = 4;

// Presentation enrichment is independent of private Library CRUD. Only cards
// near the viewport request metadata, and a small concurrency cap limits
// provider/application pressure while avoiding a serial page stall.
export function useLibraryMedia(items, { enabled, userId } = {}) {
  const [entries, setEntries] = useState({});
  const entriesRef = useRef({});
  const itemsRef = useRef(items);
  const queueRef = useRef([]);
  const requestedRef = useRef(new Set());
  const inFlightRef = useRef(0);
  const controllerRef = useRef(null);
  const generationRef = useRef(0);
  const pumpRef = useRef(null);
  itemsRef.current = items;
  const identities = items.map(mediaIdentity).join('|');

  const put = useCallback((identity, entry) => {
    const next = { ...entriesRef.current, [identity]: entry };
    const keys = Object.keys(next);
    keys.slice(0, Math.max(0, keys.length - 100)).forEach((key) => delete next[key]);
    entriesRef.current = next;
    setEntries(next);
  }, []);

  useEffect(() => {
    entriesRef.current = {};
    setEntries({});
  }, [userId]);

  useEffect(() => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    queueRef.current = [];
    requestedRef.current.clear();
    inFlightRef.current = 0;

    if (!enabled) {
      controllerRef.current = null;
      return undefined;
    }

    const controller = new AbortController();
    const generation = generationRef.current;
    controllerRef.current = controller;

    return () => {
      controller.abort();
      if (generationRef.current === generation) {
        queueRef.current = [];
        requestedRef.current.clear();
        inFlightRef.current = 0;
        controllerRef.current = null;
      }
    };
  }, [enabled, userId]);

  const pump = useCallback(() => {
    if (!enabled || !controllerRef.current || controllerRef.current.signal.aborted) return;

    while (inFlightRef.current < MAX_CONCURRENT_LOOKUPS && queueRef.current.length > 0) {
      const item = queueRef.current.shift();
      const identity = mediaIdentity(item);
      const existing = entriesRef.current[identity];
      if (existing && (existing.status === 'error' || existing.expiresAt > Date.now())) continue;

      const controller = controllerRef.current;
      const generation = generationRef.current;
      inFlightRef.current += 1;

      getMediaDetails({
        provider: item.provider,
        type: item.type.toLowerCase(),
        providerId: item.providerId,
        signal: controller.signal
      })
        .then((media) => {
          if (generationRef.current !== generation || controller.signal.aborted) return;
          put(identity, { status: 'success', media, expiresAt: Date.now() + MEDIA_CACHE_TTL_MS });
        })
        .catch(() => {
          if (generationRef.current !== generation || controller.signal.aborted) return;
          put(identity, { status: 'error' });
        })
        .finally(() => {
          if (generationRef.current !== generation) return;
          inFlightRef.current -= 1;
          pumpRef.current?.();
        });
    }
  }, [enabled, put]);

  pumpRef.current = pump;

  const request = useCallback((item) => {
    if (!enabled || !item) return;
    const identity = mediaIdentity(item);
    const existing = entriesRef.current[identity];
    if (existing && (existing.status === 'error' || existing.expiresAt > Date.now())) return;
    if (requestedRef.current.has(identity)) return;
    requestedRef.current.add(identity);
    queueRef.current.push(item);
    pumpRef.current?.();
  }, [enabled]);

  // IntersectionObserver drives requests in the browser. The fallback keeps
  // the hook usable in non-browser environments and older browsers.
  useEffect(() => {
    if (!enabled || typeof IntersectionObserver !== 'undefined') return undefined;
    itemsRef.current.forEach(request);
    return undefined;
  }, [enabled, identities, request, userId]);

  const remember = useCallback((media) => {
    const identity = mediaIdentity(media);
    requestedRef.current.add(identity);
    put(identity, { status: 'success', media, expiresAt: Date.now() + MEDIA_CACHE_TTL_MS });
  }, [put]);

  const retry = useCallback((item) => {
    const identity = mediaIdentity(item);
    const next = { ...entriesRef.current };
    delete next[identity];
    entriesRef.current = next;
    setEntries(next);
    requestedRef.current.delete(identity);
    queueRef.current.push(item);
    pumpRef.current?.();
  }, []);

  return { entries, remember, request, retry };
}
