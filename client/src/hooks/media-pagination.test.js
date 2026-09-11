import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMediaDiscovery, getMediaRecommendations } from '../api/mediaDiscovery.js';
import { useMediaDiscovery } from './useMediaDiscovery.js';
import { useMediaRecommendations } from './useMediaRecommendations.js';

vi.mock('../api/mediaDiscovery.js', () => ({ getMediaDiscovery: vi.fn(), getMediaRecommendations: vi.fn() }));
const first = { provider: 'tmdb', type: 'MOVIE', providerId: '1' };
const second = { ...first, providerId: '2' };
const payload = (results, page, hasMore) => ({ results, source: 'tmdb', pagination: { page, perPage: 12, hasMore }, providerErrors: [] });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe.each([
  ['Discovery', useMediaDiscovery, getMediaDiscovery, { operation: 'popular', type: 'movie', provider: 'tmdb' }],
  ['Recommendations', useMediaRecommendations, getMediaRecommendations, first]
])('%s pagination', (_name, useHook, request, input) => {
  it('retains earlier cards during loading and failed-page retry, appends without duplicates', async () => {
    let rejectPage;
    request.mockResolvedValueOnce(payload([first], 1, true))
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectPage = reject; }))
      .mockResolvedValueOnce(payload([first, second], 2, false));
    const { result } = renderHook(() => useHook());
    act(() => result.current.load(input));
    await waitFor(() => expect(result.current.status).toBe('success'));
    act(() => { result.current.loadMore(); result.current.loadMore(); });
    expect(request).toHaveBeenCalledTimes(2);
    expect(result.current.results).toEqual([first]);
    expect(result.current.loadingPage).toBe(2);
    await act(async () => rejectPage(new Error('Temporary network failure')));
    expect(result.current.results).toEqual([first]);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.results).toEqual([first, second]));
    expect(request.mock.calls.at(-1)[0].page).toBe(2);
    expect(result.current.pagination.hasMore).toBe(false);
  });
});
