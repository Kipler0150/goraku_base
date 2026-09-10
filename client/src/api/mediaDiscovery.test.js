import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getMediaDiscovery,
  getMediaRecommendations,
  isValidMediaListPayload
} from './mediaDiscovery.js';

const media = {
  provider: 'tmdb',
  providerId: '550',
  type: 'MOVIE',
  id: 'tmdb:MOVIE:550',
  title: 'Fight Club',
  originalTitle: null,
  alternativeTitles: [],
  description: null,
  image: null,
  bannerImage: null,
  releaseDate: { year: 1999, month: 10, day: 15 },
  genres: [],
  providerRating: null,
  releaseStatus: 'RELEASED',
  creators: [],
  isAdult: false,
  metadata: { runtimeMinutes: 139 }
};

const list = {
  results: [media],
  source: 'tmdb',
  pagination: { page: 2, perPage: 12, hasMore: true },
  providerErrors: []
};

describe('media Discovery API', () => {
  afterEach(() => vi.restoreAllMocks());

  it('requests an attributed paginated Discovery page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => list
    }));

    await expect(getMediaDiscovery({
      operation: 'popular',
      type: 'movie',
      provider: 'tmdb',
      page: 2,
      perPage: 12,
      includeAdult: false
    })).resolves.toEqual(list);

    expect(fetch).toHaveBeenCalledWith(
      '/api/media/popular?type=movie&page=2&perPage=12&includeAdult=false&provider=tmdb',
      expect.objectContaining({ headers: { Accept: 'application/json' } })
    );
    expect(isValidMediaListPayload(list, { type: 'movie', provider: 'tmdb' })).toBe(true);
  });

  it('requests Provider-owned Recommendations through the anchor route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...list, pagination: { page: 1, perPage: 12, hasMore: false } })
    }));

    await getMediaRecommendations({
      provider: 'tmdb',
      type: 'movie',
      providerId: '550',
      includeAdult: false
    });

    expect(fetch).toHaveBeenCalledWith(
      '/api/media/tmdb/movie/550/recommendations?page=1&perPage=12&includeAdult=false',
      expect.objectContaining({ headers: { Accept: 'application/json' } })
    );
  });

  it('rejects invalid list payloads with an explicit client error', async () => {
    expect(isValidMediaListPayload({ ...list, results: [{ ...media, provider: 'rawg' }] }, { type: 'movie', provider: 'tmdb' })).toBe(false);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [], source: 'tmdb' })
    }));

    await expect(getMediaDiscovery({ type: 'movie', provider: 'tmdb' })).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });
  });
});
