import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMediaDetails, isValidMediaDetailsPayload } from './mediaDetails.js';

const detail = {
  provider: 'tmdb',
  providerId: '550',
  type: 'MOVIE',
  id: 'tmdb:MOVIE:550',
  title: 'Fight Club',
  originalTitle: null,
  alternativeTitles: [],
  description: 'A normalized description.',
  image: null,
  bannerImage: null,
  releaseDate: { year: 1999, month: 10, day: 15 },
  genres: ['Drama'],
  providerRating: { value: 8.4, max: 10, normalized: 8.4 },
  releaseStatus: 'RELEASED',
  creators: [],
  isAdult: false,
  metadata: { runtimeMinutes: 139 }
};

describe('media details API', () => {
  afterEach(() => vi.restoreAllMocks());

  it('requests a typed Provider-owned detail and accepts normalized Media', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => detail
    }));

    await expect(getMediaDetails({
      provider: 'tmdb',
      type: 'movie',
      providerId: '550',
      includeAdult: false
    })).resolves.toEqual(detail);

    expect(fetch).toHaveBeenCalledWith(
      '/api/media/tmdb/movie/550?includeAdult=false',
      expect.objectContaining({ headers: { Accept: 'application/json' } })
    );
  });

  it('rejects malformed or mismatched detail payloads', async () => {
    expect(isValidMediaDetailsPayload(detail, { provider: 'tmdb', type: 'movie', providerId: '550' })).toBe(true);
    expect(isValidMediaDetailsPayload({ ...detail, provider: 'rawg' }, { provider: 'tmdb', type: 'movie', providerId: '550' })).toBe(false);
    expect(isValidMediaDetailsPayload({ results: [] }, { provider: 'tmdb', type: 'movie', providerId: '550' })).toBe(false);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] })
    }));

    await expect(getMediaDetails({
      provider: 'tmdb',
      type: 'movie',
      providerId: '550'
    })).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });
  });

  it('passes caller cancellation through', async () => {
    const externalController = new AbortController();
    vi.stubGlobal('fetch', vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    })));
    const pending = getMediaDetails({
      provider: 'tmdb',
      type: 'movie',
      providerId: '550',
      signal: externalController.signal
    });

    externalController.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
