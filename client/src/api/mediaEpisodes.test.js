import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isValidMediaEpisodesPayload,
  listMediaEpisodes,
  listWatchedEpisodes,
  setWatchedEpisodes
} from './mediaEpisodes.js';

const payload = {
  provider: 'tmdb',
  providerId: '1002',
  type: 'TV',
  season: 2,
  episodes: [{
    number: 1,
    title: 'The Return',
    airDate: { year: 2024, month: 2, day: 1 },
    runtimeMinutes: 46,
    image: null
  }]
};

const animePayload = {
  provider: 'anilist',
  providerId: '86',
  type: 'ANIME',
  season: 1,
  episodes: [{
    number: 1,
    title: 'Episode 1',
    airDate: null,
    runtimeMinutes: null,
    image: null
  }]
};

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('media episodes API', () => {
  afterEach(() => vi.restoreAllMocks());

  it('requests one TMDB TV season and validates normalized metadata', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(payload)));

    await expect(listMediaEpisodes({ providerId: '1002', season: 2 })).resolves.toEqual(payload);
    expect(fetch).toHaveBeenCalledWith('/api/media/tmdb/tv/1002/episodes?season=2', expect.objectContaining({ method: 'GET' }));
    expect(isValidMediaEpisodesPayload(payload)).toBe(true);
    expect(isValidMediaEpisodesPayload({ ...payload, episodes: [{ ...payload.episodes[0], title: '' }] })).toBe(false);
  });

  it('accepts AniList-backed anime episode metadata', () => {
    expect(isValidMediaEpisodesPayload(animePayload)).toBe(true);
    expect(isValidMediaEpisodesPayload({ ...animePayload, provider: 'myanimelist' })).toBe(true);
    expect(isValidMediaEpisodesPayload({ ...animePayload, type: 'TV' })).toBe(false);
  });

  it('reads and updates user-owned watched episode state', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ watched: [{ season: 1, episode: 1 }] }))
      .mockResolvedValueOnce(response({ watched: [{ season: 1, episode: 1 }, { season: 1, episode: 2 }] })));

    await expect(listWatchedEpisodes('library-item-1')).resolves.toEqual({ watched: [{ season: 1, episode: 1 }] });
    await expect(setWatchedEpisodes('library-item-1', [{ season: 1, episode: 2, watched: true }])).resolves.toEqual({
      watched: [{ season: 1, episode: 1 }, { season: 1, episode: 2 }]
    });
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/library/library-item-1/episodes', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ episodes: [{ season: 1, episode: 2, watched: true }] })
    }));
  });
});
