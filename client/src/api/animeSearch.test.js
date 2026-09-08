import { afterEach, describe, expect, it, vi } from 'vitest';
import { isValidAnimeSearchPayload, searchAnime } from './animeSearch.js';

describe('anime search API', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses the relative Express search route and forwards search options', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [],
        source: 'myanimelist',
        pagination: { page: 2, perPage: 24, hasMore: false },
        providerErrors: []
      })
    }));

    await searchAnime({ query: '  naruto  ', page: 2, perPage: 24, includeAdult: false, provider: 'myanimelist' });

    expect(fetch).toHaveBeenCalledWith(
      '/api/media/search?type=anime&q=naruto&page=2&perPage=24&includeAdult=false&provider=myanimelist',
      expect.objectContaining({ headers: { Accept: 'application/json' } })
    );
  });

  it('rejects malformed search payloads at the client API boundary', async () => {
    expect(isValidAnimeSearchPayload({ results: [], source: 'anilist', pagination: {}, providerErrors: [] })).toBe(false);
    expect(isValidAnimeSearchPayload({ results: [], source: 'tmdb', pagination: { page: 1, perPage: 12, hasMore: false }, providerErrors: [] })).toBe(false);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] })
    }));

    await expect(searchAnime({ query: 'broken' })).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });
  });
});
