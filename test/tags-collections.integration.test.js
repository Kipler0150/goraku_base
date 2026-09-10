import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { closeDatabasePool, createDatabasePool } from '../server/db/client.js';
import {
  assertDedicatedTestDatabase,
  assertSafeResponse,
  createMigratedSchema,
  dropTestSchema,
  sessionCookieValue,
  testDatabaseUrl
} from './support/postgres-integration.js';

const APP_ORIGIN = 'http://localhost:5173';

describe('PostgreSQL Tag and Collection HTTP API', () => {
  let pool;
  let schemaPool;
  let schemaName;
  let app;
  let ownerCookie;
  let otherCookie;

  before(async () => {
    assertDedicatedTestDatabase(testDatabaseUrl);
    pool = createDatabasePool({ databaseUrl: testDatabaseUrl });
    ({ schemaName, schemaPool } = await createMigratedSchema(pool, 'tags_collections_test'));
    app = createApp({ databasePool: schemaPool, appOrigin: APP_ORIGIN });

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
    ownerCookie = await register(`tags-owner-${suffix}@example.com`);
    otherCookie = await register(`tags-other-${suffix}@example.com`);
  });

  after(async () => {
    if (pool) {
      await dropTestSchema(pool, schemaName);
      await closeDatabasePool(pool);
    }
  });

  it('persists private resources in normalized order and enforces duplicate names', async () => {
    const zulu = await request(app)
      .post('/api/tags')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', ownerCookie)
      .send({ name: '  Zulu  ' });
    const alpha = await request(app)
      .post('/api/tags')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', ownerCookie)
      .send({ name: 'Alpha' });
    const bravo = await request(app)
      .post('/api/tags')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', ownerCookie)
      .send({ name: 'bravo' });
    const duplicate = await request(app)
      .post('/api/tags')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', ownerCookie)
      .send({ name: ' ALPHA ' });
    const invalid = await request(app)
      .post('/api/tags')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', ownerCookie)
      .send({ name: 'valid', extra: true });
    const firstPage = await request(app).get('/api/tags?page=1&perPage=2').set('Cookie', ownerCookie);
    const secondPage = await request(app).get('/api/tags?page=2&perPage=2').set('Cookie', ownerCookie);
    const otherPage = await request(app).get('/api/tags').set('Cookie', otherCookie);

    for (const response of [zulu, alpha, bravo, duplicate, invalid, firstPage, secondPage, otherPage]) assertSafeResponse(response);
    assert.equal(zulu.status, 201);
    assert.equal(zulu.body.name, 'Zulu');
    assert.equal(duplicate.status, 409);
    assert.equal(invalid.status, 400);
    assert.deepEqual(firstPage.body.results.map(({ name }) => name), ['Alpha', 'bravo']);
    assert.deepEqual(firstPage.body.pagination, { page: 1, perPage: 2, hasMore: true });
    assert.deepEqual(secondPage.body.results.map(({ name }) => name), ['Zulu']);
    assert.equal(otherPage.body.results.length, 0);

    const concurrentResponses = await Promise.all(Array.from({ length: 5 }, () => request(app)
      .post('/api/collections')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', ownerCookie)
      .send({ name: 'Concurrent Queue' })));
    assert.deepEqual(concurrentResponses.map(({ status }) => status).sort((left, right) => left - right), [201, 409, 409, 409, 409]);
    assert.equal(alpha.status, 201);
    assert.equal(bravo.status, 201);
  });

  it('supports owner-safe rename/delete and idempotent membership cleanup without deleting Library Items', async () => {
    const create = (path, cookie, name) => request(app)
      .post(path)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', cookie)
      .send({ name });
    const tag = await create('/api/tags', ownerCookie, 'Membership Tag');
    const otherTag = await create('/api/tags', otherCookie, 'Other User Tag');
    const collection = await create('/api/collections', ownerCookie, 'Membership Collection');
    const item = await request(app)
      .post('/api/library')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', ownerCookie)
      .send({ provider: 'tmdb', type: 'movie', providerId: `membership-${Date.now()}` });

    const renamed = await request(app)
      .patch(`/api/tags/${tag.body.id}`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', ownerCookie)
      .send({ name: 'Renamed Membership Tag' });
    const crossOwnerRename = await request(app)
      .patch(`/api/tags/${tag.body.id}`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', otherCookie)
      .send({ name: 'Leaked Tag' });
    const attachTag = () => request(app)
      .put(`/api/library/${item.body.id}/tags/${tag.body.id}`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', ownerCookie);
    const attachCollection = () => request(app)
      .put(`/api/library/${item.body.id}/collections/${collection.body.id}`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', ownerCookie);
    const attachedTags = await Promise.all(Array.from({ length: 5 }, attachTag));
    const attachedCollections = await Promise.all(Array.from({ length: 3 }, attachCollection));
    const crossOwnerMembership = await request(app)
      .put(`/api/library/${item.body.id}/tags/${otherTag.body.id}`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', ownerCookie);

    for (const response of [tag, otherTag, collection, item, renamed, crossOwnerRename, ...attachedTags, ...attachedCollections, crossOwnerMembership]) assertSafeResponse(response);
    assert.equal(item.status, 201);
    assert.deepEqual(attachedTags.map(({ status }) => status), [204, 204, 204, 204, 204]);
    assert.deepEqual(attachedCollections.map(({ status }) => status), [204, 204, 204]);
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.name, 'Renamed Membership Tag');
    assert.equal(crossOwnerRename.status, 404);
    assert.equal(crossOwnerMembership.status, 404);

    const membershipCounts = await schemaPool.query(`
      SELECT
        (SELECT COUNT(*)::integer FROM library_item_tags WHERE library_item_id = $1) AS tags,
        (SELECT COUNT(*)::integer FROM library_item_collections WHERE library_item_id = $1) AS collections
    `, [item.body.id]);
    assert.deepEqual(membershipCounts.rows[0], { tags: 1, collections: 1 });

    const deletedTag = await request(app)
      .delete(`/api/tags/${tag.body.id}`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', ownerCookie);
    const repeatedTagDelete = await request(app)
      .delete(`/api/tags/${tag.body.id}`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', ownerCookie);
    const detachedCollection = await request(app)
      .delete(`/api/library/${item.body.id}/collections/${collection.body.id}`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', ownerCookie);
    const repeatedDetachedCollection = await request(app)
      .delete(`/api/library/${item.body.id}/collections/${collection.body.id}`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', ownerCookie);
    const deletedCollection = await request(app)
      .delete(`/api/collections/${collection.body.id}`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', ownerCookie);
    const libraryAfterCleanup = await request(app).get('/api/library').set('Cookie', ownerCookie);
    const afterCleanup = await schemaPool.query(`
      SELECT
        (SELECT COUNT(*)::integer FROM library_item_tags WHERE library_item_id = $1) AS tags,
        (SELECT COUNT(*)::integer FROM library_item_collections WHERE library_item_id = $1) AS collections,
        (SELECT COUNT(*)::integer FROM library_items WHERE id = $1) AS items
    `, [item.body.id]);

    for (const response of [deletedTag, repeatedTagDelete, detachedCollection, repeatedDetachedCollection, deletedCollection, libraryAfterCleanup]) assertSafeResponse(response);
    assert.equal(deletedTag.status, 204);
    assert.equal(repeatedTagDelete.status, 404);
    assert.equal(detachedCollection.status, 204);
    assert.equal(repeatedDetachedCollection.status, 204);
    assert.equal(deletedCollection.status, 204);
    assert.equal(libraryAfterCleanup.body.results.some(({ id }) => id === item.body.id), true);
    assert.deepEqual(afterCleanup.rows[0], { tags: 0, collections: 0, items: 1 });
  });
});
