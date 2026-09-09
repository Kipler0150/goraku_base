import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLibraryItem, listLibrary, removeLibraryItem, updateLibraryItem } from './library.js';

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const item = {
  id: '00000000-0000-4000-8000-000000000001',
  provider: 'tmdb',
  type: 'MOVIE',
  providerId: '10',
  libraryStatus: 'PLANNING',
  favorite: false,
  createdAt: '2026-09-09T00:00:00.000Z',
  updatedAt: '2026-09-09T00:00:00.000Z'
};

describe('library API', () => {
  afterEach(() => vi.restoreAllMocks());

  it('maps a Media identity to the reference-only create request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(item, 201)));
    const media = { provider: 'tmdb', type: 'MOVIE', providerId: '10', title: 'Arrival' };

    await expect(createLibraryItem(media)).resolves.toEqual(item);
    expect(fetch).toHaveBeenCalledWith('/api/library', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ provider: 'tmdb', type: 'movie', providerId: '10' })
    }));
  });

  it('lists, updates, and removes a User-owned Library Item', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ results: [item], pagination: { page: 1, perPage: 20, hasMore: false } }))
      .mockResolvedValueOnce(response({ ...item, favorite: true }, 200))
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => { throw new Error('no body'); } }));

    await expect(listLibrary()).resolves.toMatchObject({ results: [item] });
    await expect(updateLibraryItem(item.id, { favorite: true })).resolves.toMatchObject({ favorite: true });
    await expect(removeLibraryItem(item.id)).resolves.toBeNull();
    expect(fetch).toHaveBeenNthCalledWith(2, `/api/library/${item.id}`, expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ favorite: true })
    }));
  });
});
