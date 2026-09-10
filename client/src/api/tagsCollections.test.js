import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachCollection,
  attachTag,
  createCollection,
  createTag,
  detachCollection,
  detachTag,
  isValidResourcePayload,
  listCollections,
  listTags,
  removeCollection,
  removeTag,
  updateCollection,
  updateTag
} from './tagsCollections.js';

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const TAG = {
  id: '00000000-0000-4000-8000-000000000010',
  name: 'Favorites',
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:00.000Z'
};

const COLLECTION = {
  id: '00000000-0000-4000-8000-000000000011',
  name: 'Weekend queue',
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:00.000Z'
};

const PAGINATION = { page: 1, perPage: 50, hasMore: false };

describe('Tags and Collections browser API', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists, creates, and renames private resources through their public routes', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ results: [TAG], pagination: PAGINATION }))
      .mockResolvedValueOnce(response(TAG, 201))
      .mockResolvedValueOnce(response({ ...TAG, name: 'Keepers' })));

    await expect(listTags({ page: 1, perPage: 50 })).resolves.toEqual({ results: [TAG], pagination: PAGINATION });
    await expect(createTag('Favorites')).resolves.toEqual(TAG);
    await expect(updateTag(TAG.id, 'Keepers')).resolves.toMatchObject({ name: 'Keepers' });

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/tags?page=1&perPage=50', expect.objectContaining({ credentials: 'same-origin' }));
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/tags', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'Favorites' })
    }));
    expect(fetch).toHaveBeenNthCalledWith(3, `/api/tags/${TAG.id}`, expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ name: 'Keepers' })
    }));
  });

  it('supports Collection routes, idempotent membership routes, and empty delete responses', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ results: [COLLECTION], pagination: PAGINATION }))
      .mockResolvedValueOnce(response(COLLECTION, 201))
      .mockResolvedValueOnce(response({ ...COLLECTION, name: 'Queue' }))
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => null })
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => null })
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => null })
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => null })
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => null }));

    await expect(listCollections()).resolves.toMatchObject({ results: [COLLECTION] });
    await expect(createCollection('Weekend queue')).resolves.toEqual(COLLECTION);
    await expect(updateCollection(COLLECTION.id, 'Queue')).resolves.toMatchObject({ name: 'Queue' });
    await expect(attachCollection('library-1', COLLECTION.id)).resolves.toBeNull();
    await expect(detachCollection('library-1', COLLECTION.id)).resolves.toBeNull();
    await expect(attachTag('library-1', TAG.id)).resolves.toBeNull();
    await expect(detachTag('library-1', TAG.id)).resolves.toBeNull();
    await expect(removeCollection(COLLECTION.id)).resolves.toBeNull();

    expect(fetch).toHaveBeenNthCalledWith(3, `/api/collections/${COLLECTION.id}`, expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ name: 'Queue' })
    }));
    expect(fetch).toHaveBeenNthCalledWith(4, `/api/library/library-1/collections/${COLLECTION.id}`, expect.objectContaining({ method: 'PUT' }));
    expect(fetch).toHaveBeenNthCalledWith(5, `/api/library/library-1/collections/${COLLECTION.id}`, expect.objectContaining({ method: 'DELETE' }));
    expect(fetch).toHaveBeenNthCalledWith(6, `/api/library/library-1/tags/${TAG.id}`, expect.objectContaining({ method: 'PUT' }));
    expect(fetch).toHaveBeenNthCalledWith(7, `/api/library/library-1/tags/${TAG.id}`, expect.objectContaining({ method: 'DELETE' }));
    expect(fetch).toHaveBeenNthCalledWith(8, `/api/collections/${COLLECTION.id}`, expect.objectContaining({ method: 'DELETE' }));
  });

  it('rejects malformed resource list payloads at the browser boundary', () => {
    expect(isValidResourcePayload({ results: [TAG], pagination: PAGINATION })).toBe(true);
    expect(isValidResourcePayload({ results: [{ ...TAG, name: '' }], pagination: PAGINATION })).toBe(false);
    expect(isValidResourcePayload({ results: [TAG], pagination: { ...PAGINATION, hasMore: 'no' } })).toBe(false);
  });
});
