import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { LibraryConflictError } from '../server/library.js';

const APP_ORIGIN = 'http://localhost:5173';
const USER = { id: 'user-1', username: 'reader', email: 'user@example.com' };
const OTHER_USER = { id: 'user-2', username: 'other_reader', email: 'other@example.com' };
const SESSION_COOKIE = 'goraku_session=tracking-session';
const OTHER_SESSION_COOKIE = 'goraku_session=other-session';
const ITEM_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_ITEM_ID = '00000000-0000-4000-8000-000000000002';

function createFixture() {
  const calls = [];
  const tags = new Map();
  const collections = new Map();
  const memberships = {
    tags: new Set(),
    collections: new Set()
  };
  let nextId = 10;

  function createResource(resources, resource, { userId, name }) {
    calls.push({ method: `create${resource}`, userId, name });
    if ([...resources.values()].some((candidate) => candidate.userId === userId && candidate.name.toLowerCase() === name.toLowerCase())) {
      throw new LibraryConflictError();
    }
    const id = `00000000-0000-4000-8000-0000000000${nextId++}`;
    const created = {
      id,
      name,
      createdAt: '2026-09-10T00:00:00.000Z',
      updatedAt: '2026-09-10T00:00:00.000Z',
      userId
    };
    resources.set(id, created);
    return withoutOwner(created);
  }

  function listResources(resources, resource, { userId, page, perPage }) {
    calls.push({ method: `list${resource}s`, userId, page, perPage });
    const start = (page - 1) * perPage;
    const owned = [...resources.values()].filter((candidate) => candidate.userId === userId);
    const results = owned
      .sort((left, right) => left.name.toLowerCase().localeCompare(right.name.toLowerCase()) || left.id.localeCompare(right.id))
      .slice(start, start + perPage)
      .map(withoutOwner);
    return {
      results,
      pagination: { page, perPage, hasMore: start + perPage < owned.length }
    };
  }

  function updateResource(resources, resource, { userId, id, name }) {
    calls.push({ method: `update${resource}`, userId, id, name });
    const existing = resources.get(id);
    if (!existing || existing.userId !== userId) return null;
    if ([...resources.values()].some((candidate) => candidate.id !== id && candidate.userId === userId && candidate.name.toLowerCase() === name.toLowerCase())) {
      throw new LibraryConflictError();
    }
    existing.name = name;
    return withoutOwner(existing);
  }

  function removeResource(resources, resource, { userId, id }) {
    calls.push({ method: `remove${resource}`, userId, id });
    const existing = resources.get(id);
    if (!existing || existing.userId !== userId) return false;
    resources.delete(id);
    const membershipsForResource = memberships[resource === 'Tag' ? 'tags' : 'collections'];
    for (const membership of membershipsForResource) {
      if (membership.endsWith(`:${id}`)) membershipsForResource.delete(membership);
    }
    return true;
  }

  function membership(resources, kind, { userId, libraryItemId, resourceId }) {
    calls.push({ method: kind, userId, libraryItemId, resourceId });
    const resource = resources.get(resourceId);
    const ownerOwnsResource = resource?.userId === userId;
    const ownerOwnsItem = [ITEM_ID, OTHER_ITEM_ID].includes(libraryItemId) && (libraryItemId === ITEM_ID ? userId === USER.id : userId === OTHER_USER.id);
    if (!ownerOwnsResource || !ownerOwnsItem) return null;
    return true;
  }

  function attach(resources, kind, input) {
    const available = membership(resources, `attach${kind}`, input);
    if (!available) return null;
    memberships[kind === 'Tag' ? 'tags' : 'collections'].add(`${input.libraryItemId}:${input.resourceId}`);
    return true;
  }

  function detach(resources, kind, input) {
    const available = membership(resources, `detach${kind}`, input);
    if (!available) return null;
    memberships[kind === 'Tag' ? 'tags' : 'collections'].delete(`${input.libraryItemId}:${input.resourceId}`);
    return true;
  }

  function withoutOwner({ userId, ...resource }) {
    return resource;
  }

  return {
    repository: {
      listTags: (input) => listResources(tags, 'Tag', input),
      createTag: (input) => createResource(tags, 'Tag', input),
      updateTag: (input) => updateResource(tags, 'Tag', input),
      removeTag: (input) => removeResource(tags, 'Tag', input),
      attachTag: (input) => attach(tags, 'Tag', input),
      detachTag: (input) => detach(tags, 'Tag', input),
      listCollections: (input) => listResources(collections, 'Collection', input),
      createCollection: (input) => createResource(collections, 'Collection', input),
      updateCollection: (input) => updateResource(collections, 'Collection', input),
      removeCollection: (input) => removeResource(collections, 'Collection', input),
      attachCollection: (input) => attach(collections, 'Collection', input),
      detachCollection: (input) => detach(collections, 'Collection', input)
    },
    authService: {
      async getSession(token) {
        if (token === 'tracking-session') return { user: USER, session: { id: 'session-1', userId: USER.id } };
        if (token === 'other-session') return { user: OTHER_USER, session: { id: 'session-2', userId: OTHER_USER.id } };
        return null;
      }
    },
    calls,
    memberships,
    tags,
    collections
  };
}

function trackingApp(fixture) {
  return createApp({
    authService: fixture.authService,
    tagsCollectionsRepository: fixture.repository,
    appOrigin: APP_ORIGIN
  });
}

function mutation(requestBuilder, cookie = SESSION_COOKIE) {
  return requestBuilder
    .set('Origin', APP_ORIGIN)
    .set('Cookie', cookie);
}

describe('HTTP Tag and Collection routes', () => {
  it('creates trimmed names, rejects duplicate or non-name bodies, and paginates private resources', async () => {
    const fixture = createFixture();
    const app = trackingApp(fixture);

    const created = await mutation(request(app).post('/api/tags')).send({ name: '  Favorites  ' });
    const second = await mutation(request(app).post('/api/tags')).send({ name: 'alpha' });
    const duplicate = await mutation(request(app).post('/api/tags')).send({ name: ' FAVORITES ' });
    const unknownField = await mutation(request(app).post('/api/tags')).send({ name: 'new', color: 'red' });
    const invalidName = await mutation(request(app).post('/api/tags')).send({ name: '   ' });
    const listed = await request(app).get('/api/tags?page=1&perPage=1').set('Cookie', SESSION_COOKIE);
    const otherList = await request(app).get('/api/tags').set('Cookie', OTHER_SESSION_COOKIE);

    assert.equal(created.status, 201);
    assert.equal(created.headers.location, `/api/tags/${created.body.id}`);
    assert.equal(created.body.name, 'Favorites');
    assert.equal(second.status, 201);
    assert.equal(duplicate.status, 409);
    assert.equal(unknownField.status, 400);
    assert.equal(invalidName.status, 400);
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.results.map(({ name }) => name), ['alpha']);
    assert.deepEqual(listed.body.pagination, { page: 1, perPage: 1, hasMore: true });
    assert.deepEqual(otherList.body.results, []);
    assert.equal(fixture.calls.length, 5);
  });

  it('supports name-only renames/deletions for Tags and Collections with owner privacy', async () => {
    const fixture = createFixture();
    const app = trackingApp(fixture);
    const tag = await mutation(request(app).post('/api/tags')).send({ name: 'Old name' });
    const collection = await mutation(request(app).post('/api/collections')).send({ name: 'Queue' });

    const renamed = await mutation(request(app).patch(`/api/tags/${tag.body.id}`)).send({ name: 'New name' });
    const invalidRename = await mutation(request(app).patch(`/api/tags/${tag.body.id}`)).send({ name: 'New name', extra: true });
    const otherRename = await mutation(request(app).patch(`/api/tags/${tag.body.id}`), OTHER_SESSION_COOKIE).send({ name: 'Private' });
    const otherDelete = await mutation(request(app).delete(`/api/collections/${collection.body.id}`), OTHER_SESSION_COOKIE);
    const deletedTag = await mutation(request(app).delete(`/api/tags/${tag.body.id}`));
    const deletedCollection = await mutation(request(app).delete(`/api/collections/${collection.body.id}`));
    const missingDelete = await mutation(request(app).delete(`/api/tags/${tag.body.id}`));

    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.name, 'New name');
    assert.equal(invalidRename.status, 400);
    assert.equal(otherRename.status, 404);
    assert.equal(otherDelete.status, 404);
    assert.equal(deletedTag.status, 204);
    assert.equal(deletedCollection.status, 204);
    assert.equal(missingDelete.status, 404);
  });

  it('attaches and detaches memberships idempotently without accepting bodies or crossing owners', async () => {
    const fixture = createFixture();
    const app = trackingApp(fixture);
    const tag = await mutation(request(app).post('/api/tags')).send({ name: 'Favorites' });
    const collection = await mutation(request(app).post('/api/collections')).send({ name: 'Queue' });

    const attachTag = () => mutation(request(app).put(`/api/library/${ITEM_ID}/tags/${tag.body.id}`));
    const detachTag = () => mutation(request(app).delete(`/api/library/${ITEM_ID}/tags/${tag.body.id}`));
    const attachCollection = () => mutation(request(app).put(`/api/library/${ITEM_ID}/collections/${collection.body.id}`));
    const detachCollection = () => mutation(request(app).delete(`/api/library/${ITEM_ID}/collections/${collection.body.id}`));

    const results = [
      await attachTag(),
      await attachTag(),
      await detachTag(),
      await detachTag(),
      await attachCollection(),
      await detachCollection(),
      await detachCollection()
    ];
    const bodyRejected = await attachTag().send({});
    const textBodyRejected = await attachTag().set('Content-Type', 'text/plain').send('not allowed');
    const missingItem = await mutation(request(app).put(`/api/library/${OTHER_ITEM_ID}/tags/${tag.body.id}`));
    const otherUserTag = await mutation(request(app).post('/api/tags'), OTHER_SESSION_COOKIE).send({ name: 'Other' });
    const crossOwner = await mutation(request(app).put(`/api/library/${ITEM_ID}/tags/${otherUserTag.body.id}`));

    assert.deepEqual(results.map(({ status }) => status), [204, 204, 204, 204, 204, 204, 204]);
    assert.equal(bodyRejected.status, 400);
    assert.equal(textBodyRejected.status, 400);
    assert.equal(missingItem.status, 404);
    assert.equal(crossOwner.status, 404);
    assert.deepEqual([...fixture.memberships.tags], []);
    assert.deepEqual([...fixture.memberships.collections], []);
  });

  it('validates route IDs, pagination, authentication, and mutation Origin before persistence', async () => {
    const fixture = createFixture();
    const app = trackingApp(fixture);

    const invalidId = await mutation(request(app).patch('/api/tags/not-a-uuid')).send({ name: 'valid' });
    const invalidPage = await request(app).get('/api/collections?page=0').set('Cookie', SESSION_COOKIE);
    const tooMany = await request(app).get('/api/collections?perPage=51').set('Cookie', SESSION_COOKIE);
    const missingOrigin = await request(app).post('/api/tags').set('Cookie', SESSION_COOKIE).send({ name: 'blocked' });
    const unauthenticated = await request(app).get('/api/tags');

    assert.equal(invalidId.status, 400);
    assert.equal(invalidPage.status, 400);
    assert.equal(tooMany.status, 400);
    assert.equal(missingOrigin.status, 403);
    assert.equal(unauthenticated.status, 401);
    assert.equal(fixture.calls.length, 0);
  });
});
