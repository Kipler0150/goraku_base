import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listMediaEpisodes,
  listWatchedEpisodes,
  setWatchedEpisodes
} from '../api/mediaEpisodes.js';

function episodeKey(season, episode) {
  return `${season}:${episode}`;
}

function watchedSet(watched = []) {
  return new Set(watched.map(({ season, episode }) => episodeKey(season, episode)));
}

function isSupported(media) {
  return (media?.provider === 'tmdb' && media?.type === 'TV') ||
    (['anilist', 'myanimelist'].includes(media?.provider) && media?.type === 'ANIME');
}

export function useMediaEpisodes({
  media,
  libraryItemId = null,
  enabled = false,
  onAuthenticationRequired
} = {}) {
  const supported = isSupported(media);
  const initialSeason = Number.isInteger(media?.metadata?.seasonCount) && media.metadata.seasonCount > 0
    ? Math.min(Math.max(Number(media?.progress?.season) || 1, 1), media.metadata.seasonCount)
    : 1;
  const seasonCount = Number.isInteger(media?.metadata?.seasonCount) && media.metadata.seasonCount > 0
    ? media.metadata.seasonCount
    : 1;
  const [season, setSeason] = useState(initialSeason);
  const [episodes, setEpisodes] = useState([]);
  const [watched, setWatched] = useState(() => new Set());
  const [episodeStatus, setEpisodeStatus] = useState('idle');
  const [watchedStatus, setWatchedStatus] = useState('idle');
  const [mutationStatus, setMutationStatus] = useState('idle');
  const [error, setError] = useState(null);
  const requestRef = useRef({ watched: null, episodes: null });
  const authenticationRequiredRef = useRef(onAuthenticationRequired);
  authenticationRequiredRef.current = onAuthenticationRequired;

  useEffect(() => {
    setSeason(initialSeason);
    setEpisodes([]);
    setWatched(new Set());
    setEpisodeStatus(supported ? 'idle' : 'unsupported');
    setWatchedStatus(supported && enabled && libraryItemId ? 'idle' : 'idle');
    setMutationStatus('idle');
    setError(null);
  }, [enabled, initialSeason, libraryItemId, media?.provider, media?.providerId, media?.type, supported]);

  useEffect(() => {
    requestRef.current.watched?.abort();
    requestRef.current.watched = null;
    if (!supported || !enabled || !libraryItemId) {
      setWatchedStatus('idle');
      return undefined;
    }

    const controller = new AbortController();
    requestRef.current.watched = controller;
    setWatchedStatus('loading');
    listWatchedEpisodes(libraryItemId, { signal: controller.signal })
      .then((payload) => {
        if (controller.signal.aborted || requestRef.current.watched !== controller) return;
        requestRef.current.watched = null;
        setWatched(watchedSet(payload.watched));
        setWatchedStatus('success');
      })
      .catch((requestError) => {
        if (controller.signal.aborted || requestRef.current.watched !== controller) return;
        requestRef.current.watched = null;
        if (requestError.status === 401) authenticationRequiredRef.current?.();
        setWatchedStatus('error');
        setError(requestError);
      });

    return () => controller.abort();
  }, [enabled, libraryItemId, supported]);

  useEffect(() => {
    requestRef.current.episodes?.abort();
    requestRef.current.episodes = null;
    if (!supported || !enabled || !libraryItemId) {
      setEpisodeStatus('idle');
      return undefined;
    }

    const controller = new AbortController();
    requestRef.current.episodes = controller;
    setEpisodeStatus('loading');
    listMediaEpisodes({
      provider: media.provider,
      type: media.type.toLowerCase(),
      providerId: media.providerId,
      season,
      signal: controller.signal
    })
      .then((payload) => {
        if (controller.signal.aborted || requestRef.current.episodes !== controller) return;
        requestRef.current.episodes = null;
        setEpisodes(payload.episodes);
        setEpisodeStatus('success');
        setError(null);
      })
      .catch((requestError) => {
        if (controller.signal.aborted || requestRef.current.episodes !== controller) return;
        requestRef.current.episodes = null;
        setEpisodeStatus('error');
        setError(requestError);
      });

    return () => controller.abort();
  }, [enabled, libraryItemId, media?.provider, media?.providerId, season, supported]);

  useEffect(() => () => {
    requestRef.current.watched?.abort();
    requestRef.current.episodes?.abort();
  }, []);

  const persist = useCallback(async (changes, previousWatched, nextWatched) => {
    if (!libraryItemId || mutationStatus === 'loading') return;
    setWatched(nextWatched);
    setMutationStatus('loading');
    setError(null);
    try {
      const payload = await setWatchedEpisodes(libraryItemId, changes);
      setWatched(watchedSet(payload.watched));
      setMutationStatus('success');
    } catch (requestError) {
      if (requestError.status === 401) authenticationRequiredRef.current?.();
      setWatched(previousWatched);
      setMutationStatus('error');
      setError(requestError);
    }
  }, [libraryItemId, mutationStatus]);

  const toggleEpisode = useCallback((episodeNumber, nextWatched) => {
    const key = episodeKey(season, episodeNumber);
    const previousWatched = new Set(watched);
    const next = new Set(watched);
    if (nextWatched) next.add(key);
    else next.delete(key);
    return persist([{ season, episode: episodeNumber, watched: nextWatched }], previousWatched, next);
  }, [persist, season, watched]);

  const markAll = useCallback((nextWatched) => {
    if (episodes.length === 0) return undefined;
    const previousWatched = new Set(watched);
    const next = new Set(watched);
    for (const episode of episodes) {
      const key = episodeKey(season, episode.number);
      if (nextWatched) next.add(key);
      else next.delete(key);
    }
    return persist(
      episodes.map((episode) => ({ season, episode: episode.number, watched: nextWatched })),
      previousWatched,
      next
    );
  }, [episodes, persist, season, watched]);

  const watchedCount = episodes.filter((episode) => watched.has(episodeKey(season, episode.number))).length;
  const isBusy = episodeStatus === 'loading' || watchedStatus === 'loading' || mutationStatus === 'loading';

  return {
    supported,
    season,
    setSeason,
    seasonCount,
    seasonOptions: Array.from({ length: seasonCount }, (_, index) => index + 1),
    episodes,
    watched,
    watchedCount,
    episodeStatus,
    watchedStatus,
    mutationStatus,
    error,
    toggleEpisode,
    markAll,
    isBusy
  };
}
