import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { getMediaDetails } from '../api/mediaDetails.js';
import { mediaIdentity } from '../mediaIdentity.js';
import { useLibraryMedia } from './useLibraryMedia.js';

vi.mock('../api/mediaDetails.js', () => ({ getMediaDetails: vi.fn() }));
const item = { provider: 'tmdb', type: 'MOVIE', providerId: '42' };
const movie = { ...item, title: 'Arrival', image: 'https://example.com/arrival.jpg' };
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('enriches restored references only while Library is selected and reuses cached covers', async () => {
  getMediaDetails.mockResolvedValue(movie);
  const { result, rerender } = renderHook(({ enabled }) => useLibraryMedia([item], { enabled, userId: 'one' }), { initialProps: { enabled: false } });
  expect(getMediaDetails).not.toHaveBeenCalled();
  rerender({ enabled: true });
  await waitFor(() => expect(result.current.entries[mediaIdentity(item)]?.media).toEqual(movie));
  rerender({ enabled: false });
  rerender({ enabled: true });
  expect(getMediaDetails).toHaveBeenCalledTimes(1);
});

it('exposes a retryable artwork failure without modifying Library tracking', async () => {
  getMediaDetails.mockRejectedValueOnce(new Error('Provider offline')).mockResolvedValueOnce(movie);
  const { result } = renderHook(() => useLibraryMedia([item], { enabled: true, userId: 'one' }));
  await waitFor(() => expect(result.current.entries[mediaIdentity(item)]?.status).toBe('error'));
  act(() => result.current.retry(item));
  await waitFor(() => expect(result.current.entries[mediaIdentity(item)]?.media.title).toBe('Arrival'));
  expect(item).toEqual({ provider: 'tmdb', type: 'MOVIE', providerId: '42' });
});

it('keeps same-id media types separate and clears presentation data on user change', () => {
  const tv = { ...movie, type: 'TV', title: 'Different show' };
  const { result, rerender } = renderHook(({ userId }) => useLibraryMedia([], { enabled: false, userId }), { initialProps: { userId: 'one' } });
  act(() => { result.current.remember(movie); result.current.remember(tv); });
  expect(result.current.entries[mediaIdentity(movie)].media.title).toBe('Arrival');
  expect(result.current.entries[mediaIdentity(tv)].media.title).toBe('Different show');
  rerender({ userId: 'two' });
  expect(result.current.entries).toEqual({});
});

it('aborts an in-flight lookup when leaving Library', () => {
  getMediaDetails.mockImplementation(() => new Promise(() => {}));
  const { rerender } = renderHook(({ enabled }) => useLibraryMedia([item], { enabled, userId: 'one' }), { initialProps: { enabled: true } });
  const signal = getMediaDetails.mock.calls[0][0].signal;
  rerender({ enabled: false });
  expect(signal.aborted).toBe(true);
});
