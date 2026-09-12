import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../server/app.js';

const APP_ORIGIN = 'http://localhost:5173';
const VALID_ID = '00000000-0000-4000-8000-000000000001';
const PRIVATE_ERROR = {
  error: {
    code: 'AUTHENTICATION_REQUIRED',
    message: 'Authentication is required.',
    details: []
  }
};

function assertUnauthenticated(response) {
  assert.equal(response.status, 401);
  assert.deepEqual(response.body, PRIVATE_ERROR);
  assert.doesNotMatch(`${response.text}\n${JSON.stringify(response.body)}`, /password|token|database|diagnostic|stack/i);
}

describe('Phase 6 private HTTP boundary', () => {
  it('rejects every private Library, profile, Tag, Collection, and membership route before persistence', async () => {
    const calls = [];
    const repository = new Proxy({}, {
      get(_target, property) {
        return (...args) => {
          calls.push({ property, args });
          throw new Error(`private repository should not be called: ${property}`);
        };
      }
    });
    const app = createApp({
      authService: { getSession: async () => null },
      libraryRepository: repository,
      tagsCollectionsRepository: repository,
      appOrigin: APP_ORIGIN
    });

    const requests = [
      request(app).get('/api/auth/avatar'),
      request(app).put('/api/auth/avatar').set('Origin', APP_ORIGIN).set('Content-Type', 'image/png').send(Buffer.from('avatar')),
      request(app).delete('/api/auth/avatar').set('Origin', APP_ORIGIN),
      request(app).get('/api/library'),
      request(app).post('/api/library').set('Origin', APP_ORIGIN).send({ provider: 'tmdb', type: 'movie', providerId: '42' }),
      request(app).patch(`/api/library/${VALID_ID}`).set('Origin', APP_ORIGIN).send({ favorite: true }),
      request(app).delete(`/api/library/${VALID_ID}`).set('Origin', APP_ORIGIN),
      request(app).get('/api/tags'),
      request(app).post('/api/tags').set('Origin', APP_ORIGIN).send({ name: 'Private' }),
      request(app).patch(`/api/tags/${VALID_ID}`).set('Origin', APP_ORIGIN).send({ name: 'Renamed' }),
      request(app).delete(`/api/tags/${VALID_ID}`).set('Origin', APP_ORIGIN),
      request(app).get('/api/collections'),
      request(app).post('/api/collections').set('Origin', APP_ORIGIN).send({ name: 'Private' }),
      request(app).patch(`/api/collections/${VALID_ID}`).set('Origin', APP_ORIGIN).send({ name: 'Renamed' }),
      request(app).delete(`/api/collections/${VALID_ID}`).set('Origin', APP_ORIGIN),
      request(app).put(`/api/library/${VALID_ID}/tags/${VALID_ID}`).set('Origin', APP_ORIGIN),
      request(app).delete(`/api/library/${VALID_ID}/tags/${VALID_ID}`).set('Origin', APP_ORIGIN),
      request(app).put(`/api/library/${VALID_ID}/collections/${VALID_ID}`).set('Origin', APP_ORIGIN),
      request(app).delete(`/api/library/${VALID_ID}/collections/${VALID_ID}`).set('Origin', APP_ORIGIN)
    ];

    const responses = await Promise.all(requests);
    responses.forEach(assertUnauthenticated);
    assert.deepEqual(calls, []);
  });
});
