import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('serves the built client and falls back to the SPA entry point in production', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'goraku-client-'));
    try {
      await writeFile(join(directory, 'index.html'), '<!doctype html><title>Goraku Base</title>');
      await writeFile(join(directory, 'asset.txt'), 'asset');
      const productionApp = createApp({ clientDistDirectory: directory });

      const rootResponse = await request(productionApp).get('/');
      assert.equal(rootResponse.status, 200);
      assert.match(rootResponse.headers['content-type'], /text\/html/);
      assert.match(rootResponse.text, /Goraku Base/);

      const routeResponse = await request(productionApp).get('/library');
      assert.equal(routeResponse.status, 200);
      assert.match(routeResponse.headers['content-type'], /text\/html/);

      const assetResponse = await request(productionApp).get('/asset.txt');
      assert.equal(assetResponse.status, 200);
      assert.equal(assetResponse.text, 'asset');

      const apiResponse = await request(productionApp).get('/api/not-a-real-route');
      assert.equal(apiResponse.status, 404);
      assert.deepEqual(apiResponse.body, {
        error: {
          code: 'NOT_FOUND',
          message: 'The requested resource was not found.',
          details: []
        }
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
