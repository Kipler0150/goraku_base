import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listMediaEpisodes, listWatchedEpisodes, setWatchedEpisodes } from '../api/mediaEpisodes.js';
import { useMediaEpisodes } from './useMediaEpisodes.js';

vi.mock('../api/mediaEpisodes.js', () => ({
  listMediaEpisodes: vi.fn(),
  listWatchedEpisodes: vi.fn(),
  setWatchedEpisodes: vi.fn()
}));

const media = {
  provider: 'tmdb',
  providerId: '1002',
  type: 'TV',
  metadata: { seasonCount: 2, episodeCount: 4 }
};
const season = {
  provider: 'tmdb',
  providerId: '1002',
  type: 'TV',
  season: 1,
  episodes: [
    { number: 1, title: 'Pilot', airDate: { year: 2024, month: 1, day: 1 }, runtimeMinutes: 45, image: null },
    { number: 2, title: 'Second', airDate: { year: 2024, month: 1, day: 8 }, runtimeMinutes: 45, image: null }
  ]
};
const animeMedia = {
  provider: 'myanimelist',
  providerId: '1535',
  type: 'ANIME',
  metadata: { episodeCount: 2 }
};
const animeSeason = {
  provider: 'myanimelist',
  providerId: '1535',
  type: 'ANIME',
  season: 1,
  episodes: [
    { number: 1, title: 'Episode 1', airDate: null, runtimeMinutes: null, image: null },
    { number: 2, title: 'Episode 2', airDate: null, runtimeMinutes: null, image: null }
  ]
};

describe('useMediaEpisodes', () => {
  afterEach(() => vi.clearAllMocks());

  it('does not restart episode requests when the authentication callback identity changes', () => {
    listWatchedEpisodes.mockImplementation(() => new Promise(() => {}));
    listMediaEpisodes.mockImplementation(() => new Promise(() => {}));
    const initialAuthHandler = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ authHandler }) => useMediaEpisodes({
        media,
        libraryItemId: 'library-item-1',
        enabled: true,
        onAuthenticationRequired: authHandler
      }),
      { initialProps: { authHandler: initialAuthHandler } }
    );

    expect(listWatchedEpisodes).toHaveBeenCalledTimes(1);
    expect(listMediaEpisodes).toHaveBeenCalledTimes(1);

    rerender({ authHandler: vi.fn() });

    expect(listWatchedEpisodes).toHaveBeenCalledTimes(1);
    expect(listMediaEpisodes).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('loads one season and persists individual and bulk watched changes', async () => {
    listWatchedEpisodes.mockResolvedValue({ watched: [{ season: 1, episode: 1 }] });
    listMediaEpisodes.mockResolvedValue(season);
    setWatchedEpisodes
      .mockResolvedValueOnce({ watched: [{ season: 1, episode: 1 }, { season: 1, episode: 2 }] })
      .mockResolvedValueOnce({ watched: [] });
    const { result } = renderHook(() => useMediaEpisodes({ media, libraryItemId: 'library-item-1', enabled: true }));

    await waitFor(() => expect(result.current.episodeStatus).toBe('success'));
    expect(result.current.watchedCount).toBe(1);
    expect(result.current.seasonOptions).toEqual([1, 2]);

    await act(async () => { await result.current.toggleEpisode(2, true); });
    expect(result.current.watchedCount).toBe(2);
    expect(setWatchedEpisodes).toHaveBeenNthCalledWith(1, 'library-item-1', [{ season: 1, episode: 2, watched: true }]);

    await act(async () => { await result.current.markAll(false); });
    expect(result.current.watchedCount).toBe(0);
    expect(setWatchedEpisodes).toHaveBeenNthCalledWith(2, 'library-item-1', [
      { season: 1, episode: 1, watched: false },
      { season: 1, episode: 2, watched: false }
    ]);
  });

  it('loads AniList-backed anime episode progression', async () => {
    listWatchedEpisodes.mockResolvedValue({ watched: [{ season: 1, episode: 1 }] });
    listMediaEpisodes.mockResolvedValue(animeSeason);
    const { result } = renderHook(() => useMediaEpisodes({ media: animeMedia, libraryItemId: 'anime-item-1', enabled: true }));

    await waitFor(() => expect(result.current.episodeStatus).toBe('success'));
    expect(result.current.watchedCount).toBe(1);
    expect(listMediaEpisodes).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'myanimelist',
      type: 'anime',
      providerId: '1535',
      season: 1
    }));
  });
});
