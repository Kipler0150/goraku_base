import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../server/app.js';

describe('HTTP API', () => {
  let app;

  before(() => {
    app = createApp({ enableTestErrorRoute: true });
  });

  after(() => {
    app = null;
  });

  it('returns the public health response', async () => {
    const response = await request(app).get('/api/health');

    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /application\/json/);
    assert.deepEqual(response.body, {
      status: 'ok',
      service: 'goraku-base-api'
    });
  });

  it('returns a consistent 404 envelope for unknown API paths', async () => {
    const response = await request(app).get('/api/not-a-real-route');

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, {
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
        details: []
      }
    });
  });

  it('returns a safe 500 envelope without server diagnostics', async () => {
    const response = await request(app).get('/api/test/unexpected');

    assert.equal(response.status, 500);
    assert.deepEqual(response.body, {
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected server error occurred.',
        details: []
      }
    });
    assert.equal(JSON.stringify(response.body).includes('intentional test failure'), false);
  });
});
