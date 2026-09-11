import { useCallback, useEffect, useRef, useState } from 'react';
import { getMediaDetails } from '../api/mediaDetails.js';
import { mediaIdentity } from '../mediaIdentity.js';

// Presentation enrichment is independent of private Library CRUD. Pace detail
// requests below the public API's default rate limit and never persist metadata.
export function useLibraryMedia(items, { enabled, userId } = {}) {
  const [entries, setEntries] = useState({});
  const [revision, setRevision] = useState(0);
  const entriesRef = useRef({});
  const itemsRef = useRef(items);
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
    if (!enabled) return undefined;
    const controller = new AbortController();
    let timer;
    let finishPause;
    async function load() {
      for (const item of itemsRef.current) {
        if (controller.signal.aborted) return;
        const identity = mediaIdentity(item);
        const existing = entriesRef.current[identity];
        if (existing && (existing.status === 'error' || existing.expiresAt > Date.now())) continue;
        try {
          const media = await getMediaDetails({ provider: item.provider, type: item.type.toLowerCase(), providerId: item.providerId, signal: controller.signal });
          if (controller.signal.aborted) return;
          put(identity, { status: 'success', media, expiresAt: Date.now() + 300000 });
        } catch (error) {
          if (controller.signal.aborted) return;
          put(identity, { status: 'error' });
        }
        await new Promise((resolve) => { finishPause = resolve; timer = setTimeout(resolve, 1100); });
      }
    }
    load();
    return () => { controller.abort(); clearTimeout(timer); finishPause?.(); };
  }, [enabled, userId, identities, revision, put]);

  const remember = useCallback((media) => put(mediaIdentity(media), { status: 'success', media, expiresAt: Date.now() + 300000 }), [put]);
  const retry = useCallback((item) => {
    const next = { ...entriesRef.current };
    delete next[mediaIdentity(item)];
    entriesRef.current = next;
    setEntries(next);
    setRevision((value) => value + 1);
  }, []);
  return { entries, remember, retry };
}
