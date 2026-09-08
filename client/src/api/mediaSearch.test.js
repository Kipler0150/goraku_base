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
    expect(isValidMediaSearchPayload({ results: [], source: 'rawg', pagination: {}, providerErrors: [] })).toBe(false);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] })
    }));

    await expect(searchMedia({ type: 'tv', query: 'broken' })).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });
  });
});
