import { afterEach, describe, expect, it, vi } from 'vitest';
import { isValidMediaSearchPayload, searchMedia } from './mediaSearch.js';

describe('typed media search API', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses the typed relative search route and forwards shared options', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [],
        source: 'tmdb',
        pagination: { page: 2, perPage: 24, hasMore: false },
        providerErrors: []
      })
    }));

    await searchMedia({
      type: 'movie',
      query: '  arrival  ',
      page: 2,
      perPage: 24,
      includeAdult: false,
      provider: 'tmdb'
    });

    expect(fetch).toHaveBeenCalledWith(
      '/api/media/search?type=movie&q=arrival&page=2&perPage=24&includeAdult=false&provider=tmdb',
      expect.objectContaining({ headers: { Accept: 'application/json' } })
    );
  });

  it('accepts supported provider sources and rejects malformed payloads', async () => {
    expect(isValidMediaSearchPayload({
      results: [], source: 'tmdb', pagination: { page: 1, perPage: 12, hasMore: false }, providerErrors: []
    })).toBe(true);
    expect(isValidMediaSearchPayload({
      results: [],
      source: 'rawg',
      pagination: { page: 1, perPage: 12, hasMore: false },
      providerErrors: []
    })).toBe(true);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] })
    }));

    await expect(searchMedia({ type: 'tv', query: 'broken' })).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });
  });

  it('supports game searches and RAWG payloads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [],
        source: 'rawg',
        pagination: { page: 1, perPage: 12, hasMore: false },
        providerErrors: []
      })
    }));

    await expect(searchMedia({ type: 'game', query: 'zelda', provider: 'rawg' })).resolves.toMatchObject({
      source: 'rawg'
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/media/search?type=game&q=zelda&page=1&perPage=12&includeAdult=true&provider=rawg',
      expect.objectContaining({ headers: { Accept: 'application/json' } })
    );
  });

  it('accepts Combined Search pagination and forwards its opaque continuation options', async () => {
    const payload = {
      results: [],
      source: 'combined',
      pagination: {
        page: 2,
        hasMore: true,
        providers: {
          anilist: { page: 2, perPage: 12, hasMore: true },
          rawg: { page: 1, perPage: 20, hasMore: false }
        },
        continuation: 'opaque-cursor'
      },
      providerErrors: []
    };
    expect(isValidMediaSearchPayload(payload)).toBe(true);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload
    }));

    await searchMedia({
      type: 'all',
      query: 'zelda',
      page: 2,
      includeAdult: false,
      cursor: 'opaque-cursor',
      retryProvider: 'rawg'
    });

    expect(fetch).toHaveBeenCalledWith(
      '/api/media/search?type=all&q=zelda&page=2&perPage=12&includeAdult=false&cursor=opaque-cursor&retryProvider=rawg',
      expect.objectContaining({ headers: { Accept: 'application/json' } })
    );
  });
});
