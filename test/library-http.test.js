import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { LibraryConflictError, LibraryValidationError } from '../server/library.js';

const APP_ORIGIN = 'http://localhost:5173';
const USER = { id: 'user-1', username: 'reader', email: 'user@example.com' };
const OTHER_USER = { id: 'user-2', username: 'other_reader', email: 'other@example.com' };
const SESSION_COOKIE = 'goraku_session=library-session';
const OTHER_SESSION_COOKIE = 'goraku_session=other-session';
const LIBRARY_ITEM_IDS = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003'
];

function createLibraryFixture() {
  const calls = [];
  const items = new Map();
  const watchedEpisodes = new Map();
  const item = {
    id: LIBRARY_ITEM_IDS[0],
    provider: 'thegamesdb',
    type: 'GAME',
    providerId: '12345',
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

  return {
    repository: {
      async create(input) {
        calls.push(input);
        const created = {
          ...item,
          id: LIBRARY_ITEM_IDS[items.size],
          provider: input.provider,
          type: input.type,
          providerId: input.providerId,
          createdAt: new Date(Date.UTC(2026, 8, 9, 0, items.size)).toISOString(),
          updatedAt: new Date(Date.UTC(2026, 8, 9, 0, items.size)).toISOString()
        };
        items.set(created.id, { ...created, userId: input.userId });
        return created;
      },
      async list(input) {
        calls.push({ method: 'list', ...input });
        const owned = [...items.values()]
          .filter((candidate) => candidate.userId === input.userId)
          .filter((candidate) => input.libraryStatus === undefined || candidate.libraryStatus === input.libraryStatus)
          .filter((candidate) => input.favorite === undefined || candidate.favorite === input.favorite)
          .filter((candidate) => input.tagId === undefined || candidate.tags.some(({ id }) => id === input.tagId))
          .filter((candidate) => input.collectionId === undefined || candidate.collections.some(({ id }) => id === input.collectionId))
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
          .map(({ userId, ...candidate }) => candidate);
        const start = (input.page - 1) * input.perPage;
        return {
          results: owned.slice(start, start + input.perPage),
          pagination: {
            page: input.page,
            perPage: input.perPage,
            hasMore: start + input.perPage < owned.length
          }
        };
      },
      async update(input) {
        calls.push({ method: 'update', ...input });
        const existing = items.get(input.id);
        if (!existing || existing.userId !== input.userId) return null;
        Object.assign(existing, input.changes);
        return { ...existing, userId: undefined };
      },
      async remove(input) {
        calls.push({ method: 'remove', ...input });
        const existing = items.get(input.id);
        if (!existing || existing.userId !== input.userId) return false;
        items.delete(input.id);
        watchedEpisodes.delete(input.id);
        return true;
      },
      async listWatchedEpisodes(input) {
        calls.push({ method: 'listWatchedEpisodes', ...input });
        const existing = items.get(input.id);
        if (!existing || existing.userId !== input.userId) return null;
        if (!['TV', 'ANIME'].includes(existing.type)) throw new LibraryValidationError('Episode tracking is only supported for TV and Anime Library Items.', [{ field: 'episodes', message: 'Episode tracking is only supported for TV and Anime Library Items.' }]);
        return { watched: [...(watchedEpisodes.get(input.id) ?? [])].sort((left, right) => left.season - right.season || left.episode - right.episode) };
      },
      async updateWatchedEpisodes(input) {
        calls.push({ method: 'updateWatchedEpisodes', ...input });
        const existing = items.get(input.id);
        if (!existing || existing.userId !== input.userId) return null;
        if (!['TV', 'ANIME'].includes(existing.type)) throw new LibraryValidationError('Episode tracking is only supported for TV and Anime Library Items.', [{ field: 'episodes', message: 'Episode tracking is only supported for TV and Anime Library Items.' }]);
        const state = watchedEpisodes.get(input.id) ?? [];
        for (const change of input.episodes) {
          const index = state.findIndex((episode) => episode.season === change.season && episode.episode === change.episode);
          if (change.watched && index === -1) state.push({ season: change.season, episode: change.episode });
          if (!change.watched && index !== -1) state.splice(index, 1);
        }
        watchedEpisodes.set(input.id, state);
        return { watched: [...state].sort((left, right) => left.season - right.season || left.episode - right.episode) };
      },
      async duplicate() {
        throw new LibraryConflictError();
      }
    },
    authService: {
      async getSession(token) {
        if (token === 'library-session') return { user: USER, session: { id: 'session-1', userId: USER.id } };
        if (token === 'other-session') return { user: OTHER_USER, session: { id: 'session-2', userId: OTHER_USER.id } };
        return null;
      }
    },
    calls,
    item,
    items,
    watchedEpisodes
  };
}

describe('HTTP library routes', () => {
  it('creates a validated Library Item with user-owned defaults', async () => {
    const fixture = createLibraryFixture();
    const app = createApp({
      authService: fixture.authService,
      libraryRepository: fixture.repository,
      appOrigin: APP_ORIGIN
    });

    const response = await request(app)
      .post('/api/library')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', SESSION_COOKIE)
      .send({ provider: 'thegamesdb', type: 'game', providerId: '12345' });

    assert.equal(response.status, 201);
    assert.equal(response.headers.location, `/api/library/${LIBRARY_ITEM_IDS[0]}`);
    assert.deepEqual(response.body, fixture.item);
    assert.deepEqual(fixture.calls, [{
      userId: USER.id,
      provider: 'thegamesdb',
      type: 'GAME',
      providerId: '12345'
    }]);
  });

  it('lists only the authenticated User\'s Library Items with page defaults and bounds', async () => {
    const fixture = createLibraryFixture();
    const app = createApp({ authService: fixture.authService, libraryRepository: fixture.repository, appOrigin: APP_ORIGIN });
    const first = await request(app)
      .post('/api/library')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', SESSION_COOKIE)
      .send({ provider: 'rawg', type: 'game', providerId: 'rawg-1' });
    await request(app)
      .post('/api/library')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', SESSION_COOKIE)
      .send({ provider: 'rawg', type: 'game', providerId: 'rawg-2' });

    const response = await request(app)
      .get('/api/library')
      .set('Cookie', SESSION_COOKIE);

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.pagination, { page: 1, perPage: 20, hasMore: false });
    assert.equal(response.body.results.length, 2);
    assert.deepEqual(fixture.calls.at(-1), { method: 'list', userId: USER.id, page: 1, perPage: 20 });

    const pageOne = await request(app)
      .get('/api/library?page=1&perPage=1')
      .set('Cookie', SESSION_COOKIE);
    const pageTwo = await request(app)
      .get('/api/library?page=2&perPage=1')
      .set('Cookie', SESSION_COOKIE);
    assert.equal(pageOne.body.pagination.hasMore, true);
    assert.equal(pageTwo.body.pagination.hasMore, false);
    assert.equal(pageOne.body.results[0].providerId, 'rawg-2');
    assert.equal(pageTwo.body.results[0].providerId, first.body.providerId);

    const tooMany = await request(app)
      .get('/api/library?perPage=51')
      .set('Cookie', SESSION_COOKIE);
    assert.equal(tooMany.status, 400);
    assert.equal(tooMany.body.error.code, 'VALIDATION_ERROR');
  });

  it('passes focused Library filters and rejects invalid filter values', async () => {
    const fixture = createLibraryFixture();
    const app = createApp({ authService: fixture.authService, libraryRepository: fixture.repository, appOrigin: APP_ORIGIN });
    const tagId = '00000000-0000-4000-8000-000000000010';
    const collectionId = '00000000-0000-4000-8000-000000000011';

    const filtered = await request(app)
      .get(`/api/library?libraryStatus=COMPLETED&favorite=true&tagId=${tagId}&collectionId=${collectionId}&page=2&perPage=5`)
      .set('Cookie', SESSION_COOKIE);
    const lowercaseStatus = await request(app)
      .get('/api/library?libraryStatus=completed')
      .set('Cookie', SESSION_COOKIE);
    const invalidStatus = await request(app)
      .get('/api/library?libraryStatus=published')
      .set('Cookie', SESSION_COOKIE);
    const invalidFavorite = await request(app)
      .get('/api/library?favorite=yes')
      .set('Cookie', SESSION_COOKIE);
    const invalidTag = await request(app)
      .get('/api/library?tagId=not-a-uuid')
      .set('Cookie', SESSION_COOKIE);

    assert.equal(filtered.status, 200);
    assert.equal(lowercaseStatus.status, 200);
    const listCalls = fixture.calls.filter((call) => call.method === 'list');
    assert.deepEqual(listCalls[0], {
      method: 'list',
      userId: USER.id,
      page: 2,
      perPage: 5,
      libraryStatus: 'COMPLETED',
      favorite: true,
      tagId,
      collectionId
    });
    assert.deepEqual(listCalls[1], {
      method: 'list',
      userId: USER.id,
      page: 1,
      perPage: 20,
      libraryStatus: 'COMPLETED'
    });
    assert.equal(invalidStatus.status, 400);
    assert.equal(invalidFavorite.status, 400);
    assert.equal(invalidTag.status, 400);
    assert.equal(fixture.calls.filter((call) => call.method === 'list').length, 2);
  });

  it('returns empty and combined filtered pages with stable pagination', async () => {
    const fixture = createLibraryFixture();
    const app = createApp({ authService: fixture.authService, libraryRepository: fixture.repository, appOrigin: APP_ORIGIN });
    const focusTagId = '00000000-0000-4000-8000-000000000010';
    const queueCollectionId = '00000000-0000-4000-8000-000000000011';
    const otherCollectionId = '00000000-0000-4000-8000-000000000012';

    const first = await request(app)
      .post('/api/library')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', SESSION_COOKIE)
      .send({ provider: 'tmdb', type: 'movie', providerId: 'first' });
    const second = await request(app)
      .post('/api/library')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', SESSION_COOKIE)
      .send({ provider: 'tmdb', type: 'movie', providerId: 'second' });
    await request(app)
      .post('/api/library')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', SESSION_COOKIE)
      .send({ provider: 'tmdb', type: 'movie', providerId: 'third' });

    Object.assign(fixture.items.get(first.body.id), {
      libraryStatus: 'COMPLETED',
      favorite: true,
      tags: [{ id: focusTagId, name: 'Focus' }, { id: 'other-tag', name: 'Other' }],
      collections: [{ id: queueCollectionId, name: 'Queue' }]
    });
    Object.assign(fixture.items.get(second.body.id), {
      libraryStatus: 'COMPLETED',
      favorite: true,
      tags: [{ id: focusTagId, name: 'Focus' }],
      collections: [{ id: otherCollectionId, name: 'Other queue' }]
    });

    const tagPageOne = await request(app)
      .get(`/api/library?tagId=${focusTagId}&page=1&perPage=1`)
      .set('Cookie', SESSION_COOKIE);
    const tagPageTwo = await request(app)
      .get(`/api/library?tagId=${focusTagId}&page=2&perPage=1`)
      .set('Cookie', SESSION_COOKIE);
    const combined = await request(app)
      .get(`/api/library?libraryStatus=COMPLETED&favorite=true&tagId=${focusTagId}&collectionId=${queueCollectionId}&page=1&perPage=1`)
      .set('Cookie', SESSION_COOKIE);
    const empty = await request(app)
      .get(`/api/library?libraryStatus=COMPLETED&favorite=false&tagId=${focusTagId}&collectionId=${queueCollectionId}&page=1&perPage=50`)
      .set('Cookie', SESSION_COOKIE);

    assert.deepEqual(tagPageOne.body.results.map(({ id }) => id), [second.body.id]);
    assert.deepEqual(tagPageOne.body.pagination, { page: 1, perPage: 1, hasMore: true });
    assert.deepEqual(tagPageTwo.body.results.map(({ id }) => id), [first.body.id]);
    assert.deepEqual(tagPageTwo.body.pagination, { page: 2, perPage: 1, hasMore: false });
    assert.deepEqual(combined.body.results.map(({ id }) => id), [first.body.id]);
    assert.deepEqual(combined.body.pagination, { page: 1, perPage: 1, hasMore: false });
    assert.deepEqual(empty.body.results, []);
    assert.deepEqual(empty.body.pagination, { page: 1, perPage: 50, hasMore: false });
  });

  it('rejects unsupported identities, unknown fields, and invalid pagination', async () => {
    const fixture = createLibraryFixture();
    const app = createApp({ authService: fixture.authService, libraryRepository: fixture.repository, appOrigin: APP_ORIGIN });

    const invalidIdentity = await request(app)
      .post('/api/library')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', SESSION_COOKIE)
      .send({ provider: 'tmdb', type: 'game', providerId: '1' });
    const unknownField = await request(app)
      .post('/api/library')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', SESSION_COOKIE)
      .send({ provider: 'tmdb', type: 'movie', providerId: '1', title: 'client metadata' });
    const blankId = await request(app)
      .post('/api/library')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', SESSION_COOKIE)
      .send({ provider: 'tmdb', type: 'movie', providerId: '   ' });
    const invalidPage = await request(app)
      .get('/api/library?page=0')
      .set('Cookie', SESSION_COOKIE);
    const oversizedId = await request(app)
      .post('/api/library')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', SESSION_COOKIE)
      .send({ provider: 'tmdb', type: 'movie', providerId: 'x'.repeat(201) });
    const malformedJson = await request(app)
      .post('/api/library')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', SESSION_COOKIE)
      .set('Content-Type', 'application/json')
      .send('{"provider":');

    assert.equal(invalidIdentity.status, 400);
    assert.equal(unknownField.status, 400);
    assert.equal(blankId.status, 400);
    assert.equal(invalidPage.status, 400);
    assert.equal(oversizedId.status, 400);
    assert.equal(malformedJson.status, 400);
    assert.equal(fixture.calls.length, 0);
  });

  it('returns a safe conflict for a duplicate identity', async () => {
    const fixture = createLibraryFixture();
    const app = createApp({
      authService: fixture.authService,
      libraryRepository: { create: fixture.repository.duplicate },
      appOrigin: APP_ORIGIN
    });

    const response = await request(app)
      .post('/api/library')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', SESSION_COOKIE)
      .send({ provider: 'anilist', type: 'anime', providerId: '1' });

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, {
      error: {
        code: 'CONFLICT',
        message: 'The Library Item is already in the library.',
        details: []
      }
    });
  });

  it('updates only Library Status and favorite, and rejects immutable or empty patches', async () => {
    const fixture = createLibraryFixture();
    const app = createApp({ authService: fixture.authService, libraryRepository: fixture.repository, appOrigin: APP_ORIGIN });
    const created = await request(app)
      .post('/api/library')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', SESSION_COOKIE)
      .send({ provider: 'tmdb', type: 'movie', providerId: '42' });

    const updated = await request(app)
      .patch(`/api/library/${created.body.id}`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', SESSION_COOKIE)
      .send({ libraryStatus: 'COMPLETED', favorite: true });
    const immutable = await request(app)
      .patch(`/api/library/${created.body.id}`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', SESSION_COOKIE)
      .send({ providerId: 'changed' });
    const empty = await request(app)
      .patch(`/api/library/${created.body.id}`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', SESSION_COOKIE)
      .send({});

    assert.equal(updated.status, 200);
    assert.equal(updated.body.providerId, '42');
    assert.equal(updated.body.libraryStatus, 'COMPLETED');
    assert.equal(updated.body.favorite, true);
    assert.equal(immutable.status, 400);
    assert.equal(empty.status, 400);
    assert.equal(fixture.calls.filter((call) => call.method === 'update').length, 1);
  });

  it('patches scalar tracking fields, preserves zero and false, and clears nullable values', async () => {
    const fixture = createLibraryFixture();
    const app = createApp({ authService: fixture.authService, libraryRepository: fixture.repository, appOrigin: APP_ORIGIN });
    const created = await request(app)
      .post('/api/library')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', SESSION_COOKIE)
      .send({ provider: 'thegamesdb', type: 'game', providerId: '42' });

    const tracked = await request(app)
      .patch(`/api/library/${created.body.id}`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', SESSION_COOKIE)
      .send({ personalRating: 0, note: 'A useful note', progress: { hoursPlayed: 12.5 } });

    assert.equal(tracked.status, 200);
    assert.equal(tracked.body.personalRating, 0);
    assert.equal(tracked.body.note, 'A useful note');
    assert.deepEqual(tracked.body.progress, { hoursPlayed: 12.5 });

    const cleared = await request(app)
      .patch(`/api/library/${created.body.id}`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', SESSION_COOKIE)
      .send({ personalRating: null, note: '', progress: null });

    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.personalRating, null);
    assert.equal(cleared.body.note, null);
    assert.equal(cleared.body.progress, null);
    assert.deepEqual(fixture.calls.filter((call) => call.method === 'update').map(({ changes }) => changes), [
      { personalRating: 0, note: 'A useful note', progress: { hoursPlayed: 12.5 } },
      { personalRating: null, note: null, progress: null }
    ]);
  });

  it('rejects an invalid field before changing another field in the same patch', async () => {
    const fixture = createLibraryFixture();
    const app = createApp({ authService: fixture.authService, libraryRepository: fixture.repository, appOrigin: APP_ORIGIN });
    const created = await request(app)
      .post('/api/library')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', SESSION_COOKIE)
      .send({ provider: 'thegamesdb', type: 'game', providerId: '42' });

    const response = await request(app)
      .patch(`/api/library/${created.body.id}`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', SESSION_COOKIE)
      .send({ favorite: true, personalRating: 9.1 });

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    assert.equal(fixture.calls.filter((call) => call.method === 'update').length, 0);
    assert.equal(fixture.items.get(created.body.id).favorite, false);
  });

  it('maps repository type-specific Progress rejection without updating the item', async () => {
    const fixture = createLibraryFixture();
    const originalUpdate = fixture.repository.update;
    const repository = {
      ...fixture.repository,
      async update(input) {
        if (input.changes.progress) {
          throw new LibraryValidationError('GAME progress is invalid.', [{ field: 'progress', message: 'GAME progress is invalid.' }]);
        }
        return originalUpdate(input);
      }
    };
    const app = createApp({ authService: fixture.authService, libraryRepository: repository, appOrigin: APP_ORIGIN });
    const created = await request(app)
      .post('/api/library')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', SESSION_COOKIE)
      .send({ provider: 'thegamesdb', type: 'game', providerId: '42' });

    const response = await request(app)
      .patch(`/api/library/${created.body.id}`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', SESSION_COOKIE)
      .send({ favorite: true, progress: { episodesWatched: 1 } });

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    assert.equal(fixture.items.get(created.body.id).favorite, false);
  });

  it('hides missing and non-owned Library Items and deletes an owned item', async () => {
    const fixture = createLibraryFixture();
    const app = createApp({ authService: fixture.authService, libraryRepository: fixture.repository, appOrigin: APP_ORIGIN });
    const otherCreated = await request(app)
      .post('/api/library')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', OTHER_SESSION_COOKIE)
      .send({ provider: 'rawg', type: 'game', providerId: 'other-99' });
    const created = await request(app)
      .post('/api/library')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', SESSION_COOKIE)
      .send({ provider: 'myanimelist', type: 'anime', providerId: '99' });

    const missingUpdate = await request(app)
      .patch(`/api/library/${otherCreated.body.id}`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', SESSION_COOKIE)
      .send({ favorite: true });
    const invalidId = await request(app)
      .patch('/api/library/not-a-uuid')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', SESSION_COOKIE)
      .send({ favorite: true });
    const removed = await request(app)
      .delete(`/api/library/${created.body.id}`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', SESSION_COOKIE);
    const missingOtherDelete = await request(app)
      .delete(`/api/library/${otherCreated.body.id}`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', SESSION_COOKIE);
    const missingDelete = await request(app)
      .delete(`/api/library/${created.body.id}`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', SESSION_COOKIE);

    assert.equal(missingUpdate.status, 404);
    assert.equal(invalidId.status, 400);
    assert.equal(removed.status, 204);
    assert.equal(removed.text, '');
    assert.equal(missingOtherDelete.status, 404);
    assert.equal(missingDelete.status, 404);
  });

  it('tracks watched TV episodes with ownership, validation, and immediate updates', async () => {
    const fixture = createLibraryFixture();
    const app = createApp({ authService: fixture.authService, libraryRepository: fixture.repository, appOrigin: APP_ORIGIN });
    const created = await request(app)
      .post('/api/library')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', SESSION_COOKIE)
      .send({ provider: 'tmdb', type: 'tv', providerId: '1002' });

    const initial = await request(app)
      .get(`/api/library/${created.body.id}/episodes`)
      .set('Cookie', SESSION_COOKIE);
    assert.equal(initial.status, 200);
    assert.deepEqual(initial.body, { watched: [] });

    const watched = await request(app)
      .put(`/api/library/${created.body.id}/episodes`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', SESSION_COOKIE)
      .send({ episodes: [{ season: 1, episode: 1, watched: true }, { season: 1, episode: 2, watched: true }] });
    assert.equal(watched.status, 200);
    assert.deepEqual(watched.body, { watched: [{ season: 1, episode: 1 }, { season: 1, episode: 2 }] });

    const cleared = await request(app)
      .put(`/api/library/${created.body.id}/episodes`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', SESSION_COOKIE)
      .send({ episodes: [{ season: 1, episode: 2, watched: false }] });
    assert.equal(cleared.status, 200);
    assert.deepEqual(cleared.body, { watched: [{ season: 1, episode: 1 }] });

    for (const body of [
      {},
      { episodes: [{ season: 0, episode: 1, watched: true }] },
      { episodes: [{ season: 1, episode: 1, watched: 'yes' }] },
      { episodes: [{ season: 1, episode: 1, watched: true }, { season: 1, episode: 1, watched: false }] }
    ]) {
      const invalid = await request(app)
        .put(`/api/library/${created.body.id}/episodes`)
        .set('Origin', APP_ORIGIN)
        .set('Cookie', SESSION_COOKIE)
        .send(body);
      assert.equal(invalid.status, 400);
    }

    const other = await request(app)
      .get(`/api/library/${created.body.id}/episodes`)
      .set('Cookie', OTHER_SESSION_COOKIE);
    assert.equal(other.status, 404);
  });

  it('requires authentication before reading or mutating the library', async () => {
    const fixture = createLibraryFixture();
    const app = createApp({ authService: fixture.authService, libraryRepository: fixture.repository, appOrigin: APP_ORIGIN });

    const response = await request(app).get('/api/library');

    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'AUTHENTICATION_REQUIRED');
    assert.equal(fixture.calls.length, 0);
  });
});
