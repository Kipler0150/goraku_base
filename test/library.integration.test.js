import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { createLibraryRepository } from '../server/library.js';
import { closeDatabasePool, createDatabasePool } from '../server/db/client.js';
import {
  assertSafeResponse,
  assertDedicatedTestDatabase,
  createMigratedSchema,
  dropTestSchema,
  sessionCookieValue,
  testDatabaseUrl
} from './support/postgres-integration.js';

const APP_ORIGIN = 'http://localhost:5173';

function compareLibraryItemsNewestFirst(left, right) {
  const createdDifference = Date.parse(right.createdAt) - Date.parse(left.createdAt);
  if (createdDifference !== 0) return createdDifference;
  if (right.id < left.id) return -1;
  if (right.id > left.id) return 1;
  return 0;
}

describe('PostgreSQL library HTTP API', () => {
  let pool;
  let schemaPool;
  let schemaName;
  let app;

  before(async () => {
    assertDedicatedTestDatabase(testDatabaseUrl);
    pool = createDatabasePool({ databaseUrl: testDatabaseUrl });
    ({ schemaName, schemaPool } = await createMigratedSchema(pool, 'library_test'));
    app = createApp({ databasePool: schemaPool, appOrigin: APP_ORIGIN });
  });

  after(async () => {
    if (pool) {
      await dropTestSchema(pool, schemaName);
      await closeDatabasePool(pool);
    }
  });

  it('persists defaults, pagination, duplicate safety, and ownership-scoped mutations', async () => {
    const suffix = `${process.pid}-${Date.now()}`;
    const register = async (email) => {
      const response = await request(app)
        .post('/api/auth/register')
        .set('Origin', APP_ORIGIN)
        .send({ email, password: 'correct horse battery staple!' });
      assert.equal(response.status, 201);
      assertSafeResponse(response);
      return sessionCookieValue(response);
    };
    const ownerCookie = await register(`library-owner-${suffix}@example.com`);
    const otherCookie = await register(`library-other-${suffix}@example.com`);
    const add = (cookie, identity) => request(app)
      .post('/api/library')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', cookie)
      .send(identity);

    const first = await add(ownerCookie, { provider: 'tmdb', type: 'movie', providerId: '100' });
    const second = await add(ownerCookie, { provider: 'tmdb', type: 'tv', providerId: '200' });
    const third = await add(ownerCookie, { provider: 'rawg', type: 'game', providerId: '300' });
    assert.equal(first.status, 201);
    assertSafeResponse(first);
    assert.equal(first.body.libraryStatus, 'PLANNING');
    assert.equal(first.body.favorite, false);
    assert.deepEqual(
      Object.keys(first.body).sort(),
      [
        'collections',
        'createdAt',
        'favorite',
        'id',
        'libraryStatus',
        'note',
        'personalRating',
        'progress',
        'provider',
        'providerId',
        'tags',
        'type',
        'updatedAt'
      ]
    );

    const owner = await schemaPool.query('SELECT id FROM users WHERE email = $1', [`library-owner-${suffix}@example.com`]);
    const tag = await schemaPool.query(`
      INSERT INTO tags (user_id, name)
      VALUES ($1, 'Weekend')
      RETURNING id, name
    `, [owner.rows[0].id]);
    const collection = await schemaPool.query(`
      INSERT INTO collections (user_id, name)
      VALUES ($1, 'Queue')
      RETURNING id, name
    `, [owner.rows[0].id]);
    await schemaPool.query(`
      INSERT INTO library_item_tags (user_id, library_item_id, tag_id)
      VALUES ($1, $2, $3)
    `, [owner.rows[0].id, first.body.id, tag.rows[0].id]);
    await schemaPool.query(`
      INSERT INTO library_item_collections (user_id, library_item_id, collection_id)
      VALUES ($1, $2, $3)
    `, [owner.rows[0].id, first.body.id, collection.rows[0].id]);

    const enriched = await request(app)
      .get(`/api/library?tagId=${tag.rows[0].id}&collectionId=${collection.rows[0].id}`)
      .set('Cookie', ownerCookie);
    assert.equal(enriched.status, 200);
    assert.equal(enriched.body.results.length, 1);
    assert.deepEqual(enriched.body.results[0].tags, [{ id: tag.rows[0].id, name: 'Weekend' }]);
    assert.deepEqual(enriched.body.results[0].collections, [{ id: collection.rows[0].id, name: 'Queue' }]);

    const created = [first.body, second.body, third.body].sort(compareLibraryItemsNewestFirst);
    const listed = await request(app).get('/api/library').set('Cookie', ownerCookie);
    const pageOne = await request(app)
      .get('/api/library?page=1&perPage=1')
      .set('Cookie', ownerCookie);
    const pageTwo = await request(app)
      .get('/api/library?page=2&perPage=1')
      .set('Cookie', ownerCookie);
    for (const response of [second, third, listed, pageOne, pageTwo]) assertSafeResponse(response);
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.results.map(({ id }) => id), created.map(({ id }) => id));
    assert.deepEqual(listed.body.pagination, { page: 1, perPage: 20, hasMore: false });
    assert.deepEqual(pageOne.body.results.map(({ id }) => id), [created[0].id]);
    assert.deepEqual(pageOne.body.pagination, { page: 1, perPage: 1, hasMore: true });
    assert.deepEqual(pageTwo.body.results.map(({ id }) => id), [created[1].id]);
    assert.deepEqual(pageTwo.body.pagination, { page: 2, perPage: 1, hasMore: true });

    const duplicate = await add(ownerCookie, { provider: 'tmdb', type: 'movie', providerId: '100' });
    const otherList = await request(app).get('/api/library').set('Cookie', otherCookie);
    const otherUpdate = await request(app)
      .patch(`/api/library/${first.body.id}`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', otherCookie)
      .send({ favorite: true });
    const otherDelete = await request(app)
      .delete(`/api/library/${first.body.id}`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', otherCookie);
    for (const response of [duplicate, otherList, otherUpdate, otherDelete]) assertSafeResponse(response);
    assert.equal(duplicate.status, 409);
    assert.deepEqual(otherList.body.results, []);
    assert.equal(otherUpdate.status, 404);
    assert.equal(otherDelete.status, 404);

    const updated = await request(app)
      .patch(`/api/library/${first.body.id}`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', ownerCookie)
      .send({ libraryStatus: 'COMPLETED', favorite: true });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.providerId, '100');
    assert.equal(updated.body.libraryStatus, 'COMPLETED');
    assert.equal(updated.body.favorite, true);
    assert.equal(updated.body.personalRating, null);
    assert.equal(updated.body.note, null);
    assert.equal(updated.body.progress, null);
    assert.deepEqual(updated.body.tags, [{ id: tag.rows[0].id, name: 'Weekend' }]);
    assert.deepEqual(updated.body.collections, [{ id: collection.rows[0].id, name: 'Queue' }]);

    const trackedMovie = await request(app)
      .patch(`/api/library/${first.body.id}`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', ownerCookie)
      .send({ personalRating: 9.5, note: 'Rewatch this.', progress: { watched: true } });
    assert.equal(trackedMovie.status, 200);
    assert.equal(trackedMovie.body.personalRating, 9.5);
    assert.equal(trackedMovie.body.note, 'Rewatch this.');
    assert.deepEqual(trackedMovie.body.progress, { watched: true });

    const trackedTv = await request(app)
      .patch(`/api/library/${second.body.id}`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', ownerCookie)
      .send({ personalRating: 0, progress: { season: 0, episode: 1 } });
    assert.equal(trackedTv.status, 200);
    assert.equal(trackedTv.body.personalRating, 0);
    assert.deepEqual(trackedTv.body.progress, { season: 0, episode: 1 });

    const trackedGame = await request(app)
      .patch(`/api/library/${third.body.id}`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', ownerCookie)
      .send({ personalRating: 0, progress: { hoursPlayed: 0 } });
    assert.equal(trackedGame.status, 200);
    assert.equal(trackedGame.body.personalRating, 0);
    assert.deepEqual(trackedGame.body.progress, { hoursPlayed: 0 });

    const invalidAtomicPatch = await request(app)
      .patch(`/api/library/${first.body.id}`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', ownerCookie)
      .send({ favorite: false, personalRating: 9.1 });
    assert.equal(invalidAtomicPatch.status, 400);
    const afterInvalidPatch = await request(app)
      .get('/api/library?favorite=true')
      .set('Cookie', ownerCookie);
    assert.equal(afterInvalidPatch.body.results.some(({ id }) => id === first.body.id), true);

    const wrongTypeProgress = await request(app)
      .patch(`/api/library/${third.body.id}`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', ownerCookie)
      .send({ favorite: true, progress: { episodesWatched: 1 } });
    assert.equal(wrongTypeProgress.status, 400);

    const cleared = await request(app)
      .patch(`/api/library/${first.body.id}`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', ownerCookie)
      .send({ personalRating: null, note: '', progress: null });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.personalRating, null);
    assert.equal(cleared.body.note, null);
    assert.equal(cleared.body.progress, null);

    const deleted = await request(app)
      .delete(`/api/library/${first.body.id}`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', ownerCookie);
    assertSafeResponse(updated);
    assertSafeResponse(deleted);
    assert.equal(deleted.status, 204);
    assert.equal(deleted.text, '');
  });

  it('exposes the enriched repository seam and rejects invalid updates atomically', async () => {
    const suffix = `${process.pid}-${Date.now()}-repository`;
    const user = await schemaPool.query(`
      INSERT INTO users (email)
      VALUES ($1)
      RETURNING id
    `, [`${suffix}@example.com`]);
    const userId = user.rows[0].id;
    const repository = createLibraryRepository({ pool: schemaPool });

    const created = await repository.create({
      userId,
      provider: 'tmdb',
      type: 'MOVIE',
      providerId: 'repository-movie'
    });
    assert.equal(created.personalRating, null);
    assert.equal(created.note, null);
    assert.equal(created.progress, null);
    assert.deepEqual(created.tags, []);
    assert.deepEqual(created.collections, []);
    const other = await repository.create({
      userId,
      provider: 'tmdb',
      type: 'MOVIE',
      providerId: 'repository-other-movie'
    });

    const tag = await schemaPool.query(`
      INSERT INTO tags (user_id, name)
      VALUES ($1, 'Repository Tag')
      RETURNING id
    `, [userId]);
    const collection = await schemaPool.query(`
      INSERT INTO collections (user_id, name)
      VALUES ($1, 'Repository Collection')
      RETURNING id
    `, [userId]);
    await schemaPool.query(`
      INSERT INTO library_item_tags (user_id, library_item_id, tag_id)
      VALUES ($1, $2, $3)
    `, [userId, created.id, tag.rows[0].id]);
    await schemaPool.query(`
      INSERT INTO library_item_collections (user_id, library_item_id, collection_id)
      VALUES ($1, $2, $3)
    `, [userId, created.id, collection.rows[0].id]);

    const updated = await repository.update({
      userId,
      id: created.id,
      changes: {
        libraryStatus: 'COMPLETED',
        favorite: true,
        personalRating: 8.5,
        note: 'Repository note',
        progress: { watched: true }
      }
    });
    assert.equal(updated.personalRating, 8.5);
    assert.equal(updated.note, 'Repository note');
    assert.deepEqual(updated.progress, { watched: true });
    assert.deepEqual(updated.tags, [{ id: tag.rows[0].id, name: 'Repository Tag' }]);
    assert.deepEqual(updated.collections, [{ id: collection.rows[0].id, name: 'Repository Collection' }]);

    const filtered = await repository.list({
      userId,
      libraryStatus: 'COMPLETED',
      favorite: true,
      tagId: tag.rows[0].id,
      collectionId: collection.rows[0].id
    });
    assert.deepEqual(filtered.results.map(({ id }) => id), [created.id]);
    const tagFiltered = await repository.list({ userId, tagId: tag.rows[0].id });
    const collectionFiltered = await repository.list({ userId, collectionId: collection.rows[0].id });
    assert.deepEqual(tagFiltered.results.map(({ id }) => id), [created.id]);
    assert.deepEqual(collectionFiltered.results.map(({ id }) => id), [created.id]);

    const planning = await repository.list({ userId, libraryStatus: 'PLANNING' });
    assert.deepEqual(planning.results.map(({ id }) => id), [other.id]);

    for (const changes of [
      {},
      { unknown: true },
      { note: 'x'.repeat(5_001) },
      { progress: {} },
      { favorite: false, progress: { episodesWatched: 1 } },
      { favorite: false, personalRating: 8.1 }
    ]) {
      await assert.rejects(
        () => repository.update({ userId, id: created.id, changes }),
        { code: 'VALIDATION_ERROR' }
      );
    }
    const unchanged = await repository.list({ userId, favorite: true });
    assert.deepEqual(unchanged.results.map(({ id }) => id), [created.id]);
  });
});
