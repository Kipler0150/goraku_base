import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMediaDiscovery } from '../api/mediaDiscovery.js';
import { useMediaDiscovery } from './useMediaDiscovery.js';

vi.mock('../api/mediaDiscovery.js', () => ({
  getMediaDiscovery: vi.fn()
}));

const payload = {
  results: [],
  source: 'tmdb',
  pagination: { page: 1, perPage: 12, hasMore: false },
  providerErrors: []
};

describe('useMediaDiscovery', () => {
  afterEach(() => vi.clearAllMocks());

  it('loads an explicit Discovery operation and preserves its request state', async () => {
    getMediaDiscovery.mockResolvedValue(payload);
    const { result } = renderHook(() => useMediaDiscovery({ includeAdult: false }));

    act(() => result.current.load({ operation: 'popular', type: 'movie', provider: 'tmdb' }));
    expect(result.current.state.status).toBe('loading');

    await waitFor(() => expect(result.current.state).toMatchObject({ status: 'success', source: 'tmdb', results: [] }));
    expect(getMediaDiscovery).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'popular', type: 'movie', provider: 'tmdb', includeAdult: false, signal: expect.any(AbortSignal)
    }));
  });

  it('exposes retryable API failures and cancels stale Discovery requests', async () => {
    const first = new Promise((_resolve, reject) => {
      getMediaDiscovery.mockImplementationOnce(({ signal }) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
        return first;
      });
    });
    getMediaDiscovery.mockRejectedValueOnce(Object.assign(new Error('rate limit'), { code: 'PROVIDER_RATE_LIMITED', status: 503 }));
    const { result } = renderHook(() => useMediaDiscovery());

    act(() => result.current.load({ operation: 'trending', type: 'anime', provider: 'anilist' }));
    act(() => result.current.load({ operation: 'popular', type: 'movie', provider: 'tmdb' }));
    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(result.current.state.error).toMatchObject({ code: 'PROVIDER_RATE_LIMITED' });
    expect(getMediaDiscovery).toHaveBeenCalledTimes(2);
  });
});
