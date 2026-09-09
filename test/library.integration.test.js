import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { closeDatabasePool, createDatabasePool } from '../server/db/client.js';
import { runMigrations } from '../server/db/migrate.js';

const APP_ORIGIN = 'http://localhost:5173';
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

function assertDedicatedTestDatabase(databaseUrl) {
  if (!databaseUrl) {
    throw new Error('TEST_DATABASE_URL is required to run PostgreSQL integration tests.');
  }

  let databaseName;
  try {
    databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL for a dedicated test database.');
  }
  if (databaseName !== 'goraku_test') {
    throw new Error('TEST_DATABASE_URL must point to the dedicated goraku_test database.');
  }
}

function quoteSchemaIdentifier(schema) {
  return `"${schema}"`;
}

function createSchemaPool(pool, schema) {
  const quotedSchema = quoteSchemaIdentifier(schema);

  return {
    async connect() {
      const client = await pool.connect();
      await client.query(`SET search_path TO ${quotedSchema}, public`);
      return client;
    },
    async query(text, values) {
      const client = await pool.connect();
      try {
        await client.query(`SET search_path TO ${quotedSchema}, public`);
        return await client.query(text, values);
      } finally {
        client.release();
      }
    }
  };
}

function cookieValue(response) {
  return response.headers['set-cookie'][0].split(';', 1)[0];
}

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
    schemaName = `library_test_${process.pid}_${Date.now()}`;
    await pool.query(`CREATE SCHEMA ${quoteSchemaIdentifier(schemaName)}`);
    await runMigrations({ pool, schema: schemaName });
    schemaPool = createSchemaPool(pool, schemaName);
    app = createApp({ databasePool: schemaPool, appOrigin: APP_ORIGIN });
  });

  after(async () => {
    if (pool) {
      await pool.query(`DROP SCHEMA ${quoteSchemaIdentifier(schemaName)} CASCADE`);
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
      return cookieValue(response);
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
    assert.equal(first.body.libraryStatus, 'PLANNING');
    assert.equal(first.body.favorite, false);
    assert.deepEqual(
      Object.keys(first.body).sort(),
      ['createdAt', 'favorite', 'id', 'libraryStatus', 'provider', 'providerId', 'type', 'updatedAt']
    );

    const created = [first.body, second.body, third.body].sort(compareLibraryItemsNewestFirst);
    const listed = await request(app).get('/api/library').set('Cookie', ownerCookie);
    const pageOne = await request(app)
      .get('/api/library?page=1&perPage=1')
      .set('Cookie', ownerCookie);
    const pageTwo = await request(app)
      .get('/api/library?page=2&perPage=1')
      .set('Cookie', ownerCookie);
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

    const deleted = await request(app)
      .delete(`/api/library/${first.body.id}`)
      .set('Origin', APP_ORIGIN)
      .set('Cookie', ownerCookie);
    assert.equal(deleted.status, 204);
    assert.equal(deleted.text, '');
  });
});
