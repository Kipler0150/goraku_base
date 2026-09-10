import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLibraryItem,
  isValidLibraryItem,
  listLibrary,
  removeLibraryItem,
  updateLibraryItem
} from './library.js';

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
  personalRating: null,
  note: null,
  progress: null,
  tags: [],
  collections: [],
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

  it('lists with every focused filter, updates, and removes a User-owned Library Item', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ results: [item], pagination: { page: 1, perPage: 20, hasMore: false } }))
      .mockResolvedValueOnce(response({ ...item, favorite: true }, 200))
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => { throw new Error('no body'); } }));

    await expect(listLibrary({
      page: 2,
      perPage: 5,
      libraryStatus: 'COMPLETED',
      favorite: false,
      tagId: '00000000-0000-4000-8000-000000000010',
      collectionId: '00000000-0000-4000-8000-000000000011'
    })).resolves.toMatchObject({ results: [item] });
    await expect(updateLibraryItem(item.id, { favorite: true })).resolves.toMatchObject({ favorite: true });
    await expect(removeLibraryItem(item.id)).resolves.toBeNull();
    expect(fetch).toHaveBeenNthCalledWith(1, '/api/library?page=2&perPage=5&libraryStatus=completed&favorite=false&tagId=00000000-0000-4000-8000-000000000010&collectionId=00000000-0000-4000-8000-000000000011', expect.objectContaining({
      credentials: 'same-origin'
    }));
    expect(fetch).toHaveBeenNthCalledWith(2, `/api/library/${item.id}`, expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ favorite: true })
    }));
  });

  it('requires the enriched Library Item response shape at the browser boundary', () => {
    expect(isValidLibraryItem(item)).toBe(true);
    expect(isValidLibraryItem({ ...item, type: 'GAME', progress: { hoursPlayed: 1.1 } })).toBe(true);
    expect(isValidLibraryItem({ ...item, type: 'GAME', progress: { hoursPlayed: 1.15 } })).toBe(true);
    expect(isValidLibraryItem({ ...item, tags: undefined })).toBe(false);
    expect(isValidLibraryItem({ ...item, personalRating: 8.1 })).toBe(false);
    expect(isValidLibraryItem({ ...item, tags: [{ id: 'tag-1' }] })).toBe(false);
  });
});
