import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMediaDetails } from '../api/mediaDetails.js';
import { useMediaDetails } from './useMediaDetails.js';

vi.mock('../api/mediaDetails.js', () => ({
  getMediaDetails: vi.fn()
}));

const selectedMedia = { provider: 'tmdb', type: 'MOVIE', providerId: '550', title: 'Fight Club' };
const detail = { ...selectedMedia, description: 'A detail.' };

describe('useMediaDetails', () => {
  afterEach(() => vi.clearAllMocks());

  it('exposes loading and successful detail states for a selected Media', async () => {
    getMediaDetails.mockResolvedValue(detail);
    const { result } = renderHook(() => useMediaDetails({ includeAdult: false }));

    act(() => result.current.open(selectedMedia));
    expect(result.current.state).toMatchObject({ status: 'loading', selectedMedia });

    await waitFor(() => expect(result.current.state).toMatchObject({ status: 'success', media: detail }));
    expect(getMediaDetails).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'tmdb', type: 'movie', providerId: '550', includeAdult: false, signal: expect.any(AbortSignal)
    }));
  });

  it('cancels the previous request when another Media is selected', async () => {
    const requests = [];
    getMediaDetails.mockImplementation(({ signal }) => new Promise((resolve, reject) => {
      requests.push({ signal, resolve, reject });
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    const { result } = renderHook(() => useMediaDetails());
    const nextMedia = { ...selectedMedia, providerId: '551', title: 'Second detail' };

    act(() => result.current.open(selectedMedia));
    act(() => result.current.open(nextMedia));

    expect(requests[0].signal.aborted).toBe(true);
    expect(result.current.state.selectedMedia).toEqual(nextMedia);
    expect(result.current.state.status).toBe('loading');
  });

  it('returns to the idle state and cancels when closed', () => {
    let requestSignal;
    getMediaDetails.mockImplementation(({ signal }) => {
      requestSignal = signal;
      return new Promise(() => {});
    });
    const { result } = renderHook(() => useMediaDetails());

    act(() => result.current.open(selectedMedia));
    act(() => result.current.close());

    expect(result.current.state).toEqual({ status: 'idle', selectedMedia: null, media: null, error: null });
    expect(requestSignal.aborted).toBe(true);
  });
});
