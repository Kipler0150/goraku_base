import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../server/app.js';
import {
  createApplicationRateLimiter,
  createTokenBucket,
  readApplicationRateLimitConfig
} from '../server/rate-limit.js';
import { createRuntimeSignals } from '../server/observability.js';

const emptySearchPage = {
  results: [],
  pagination: { page: 1, perPage: 12, hasMore: false }
};

function mediaApp(options = {}) {
  return createApp({
    rateLimit: { tokensPerMinute: 60, burstCapacity: 10, ...options.rateLimit },
    tmdbAdapter: {
      enabled: true,
      async searchMedia() {
        return emptySearchPage;
      },
      ...options.tmdbAdapter
    },
    ...options
  });
}

describe('Application Rate Limit', () => {
  it('refills tokens deterministically while preserving the burst capacity', () => {
    let now = 0;
    const bucket = createTokenBucket({ burstCapacity: 2, tokensPerMinute: 60, now: () => now });

    assert.equal(bucket.consume('caller').allowed, true);
    assert.equal(bucket.consume('caller').allowed, true);
    assert.deepEqual(bucket.consume('caller'), { allowed: false, remaining: 0, retryAfter: 1 });

    now += 1_000;
    assert.equal(bucket.consume('caller').allowed, true);
    assert.equal(bucket.consume('other-caller').allowed, true);
    assert.equal(bucket.getConfig().burstCapacity, 2);
  });

  it('reads server configuration and supports explicit middleware configuration', () => {
    assert.deepEqual(readApplicationRateLimitConfig({
      MEDIA_RATE_LIMIT_PER_MINUTE: '12',
      MEDIA_RATE_LIMIT_BURST: '3'
    }), {
      tokensPerMinute: 12,
      burstCapacity: 3
    });

    let now = 0;
    const limiter = createApplicationRateLimiter({
      burstCapacity: 1,
      tokensPerMinute: 60,
      now: () => now,
      resolveKey: () => 'caller'
    });
    assert.equal(limiter.consume({}).allowed, true);
    assert.equal(limiter.consume({}).allowed, false);
    now += 1_000;
    assert.equal(limiter.consume({}).allowed, true);
  });

  it('returns a safe 429 with Retry-After after the configured burst', async () => {
    const app = mediaApp({ rateLimit: { burstCapacity: 1 } });
    const path = '/api/media/search?type=movie&provider=tmdb&q=secret-query';

    const first = await request(app).get(path);
    const second = await request(app).get(path);

    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
    assert.equal(second.headers['retry-after'], '1');
    assert.deepEqual(second.body, {
      error: {
        code: 'APPLICATION_RATE_LIMITED',
        message: 'Too many media requests. Please retry later.',
        details: []
      }
    });
    assert.doesNotMatch(second.text, /secret-query|credential|session|library|tracking/i);
    assert.notEqual(second.body.error.code, 'PROVIDER_RATE_LIMITED');
  });

  it('exempts health checks and does not trust forwarded addresses by default', async () => {
    const app = mediaApp({ rateLimit: { burstCapacity: 1 } });
    const path = '/api/media/search?type=movie&provider=tmdb&q=health-boundary';

    assert.equal((await request(app).get('/api/health')).status, 200);
    assert.equal((await request(app).get('/api/health')).status, 200);
    assert.equal((await request(app).get(path).set('X-Forwarded-For', '198.51.100.10')).status, 200);
    const forwardedAddressAttempt = await request(app)
      .get(path)
      .set('X-Forwarded-For', '198.51.100.11');
    assert.equal(forwardedAddressAttempt.status, 429);
  });

  it('uses forwarded addresses only when proxy trust is explicitly enabled', async () => {
    const app = mediaApp({ trustProxy: true, rateLimit: { burstCapacity: 1 } });
    const path = '/api/media/search?type=movie&provider=tmdb&q=trusted-proxy';

    assert.equal((await request(app).get(path).set('X-Forwarded-For', '198.51.100.10')).status, 200);
    assert.equal((await request(app).get(path).set('X-Forwarded-For', '198.51.100.11')).status, 200);
    assert.equal((await request(app).get(path).set('X-Forwarded-For', '198.51.100.10')).status, 429);
  });

  it('applies the same boundary to every public Media route', async () => {
    const routes = [
      '/api/media/search?type=movie&provider=tmdb&q=route-boundary',
      '/api/media/trending?type=movie&provider=tmdb',
      '/api/media/popular?type=movie&provider=tmdb',
      '/api/media/tmdb/movie/1/recommendations',
      '/api/media/tmdb/movie/1'
    ];

    for (const path of routes) {
      const app = mediaApp({ rateLimit: { burstCapacity: 1, now: () => 0 } });
      const first = await request(app).get(path);
      const second = await request(app).get(path);
      assert.notEqual(first.status, 429, path);
      assert.equal(second.status, 429, path);
    }
  });
});

describe('runtime signals', () => {
  it('records cache, Provider, rejection, and duration signals without sensitive fields', async () => {
    const signals = createRuntimeSignals({ maxEvents: 10 });
    signals.recordCacheEvent({
      type: 'private-query',
      operation: 'search',
      provider: 'tmdb',
      request: { query: 'private-query' },
      credential: 'private-credential'
    });
    signals.recordCacheEvent({ type: 'miss', operation: 'search', provider: 'tmdb' });
    signals.recordProviderRequest({
      provider: 'tmdb',
      operation: 'search',
      query: 'private-query',
      session: 'private-session'
    });
    signals.recordRateLimitRejection({ key: '198.51.100.10' });
    signals.recordRequest({ method: 'GET', httpStatus: 200, durationMs: 12 });

    const stats = signals.getStats();
    assert.equal(stats.cacheHits, 0);
    assert.equal(stats.cacheMisses, 1);
    assert.equal(stats.providerRequests, 1);
    assert.equal(stats.rateLimitRejections, 1);
    assert.equal(stats.requestCount, 1);
    assert.equal(stats.requestDurationMs.total, 12);
    assert.doesNotMatch(JSON.stringify(signals.getEvents()), /private-query|private-credential|private-session|198\.51\.100\.10/i);
  });

  it('records cache hits, Provider requests, and HTTP duration at the app boundary', async () => {
    const signals = createRuntimeSignals();
    const app = mediaApp({ runtimeSignals: signals });
    const path = '/api/media/search?type=movie&provider=tmdb&q=signal-boundary';

    assert.equal((await request(app).get(path)).status, 200);
    assert.equal((await request(app).get(path)).status, 200);

    const stats = signals.getStats();
    assert.equal(stats.cacheMisses, 1);
    assert.equal(stats.cacheHits, 1);
    assert.equal(stats.providerRequests, 1);
    assert.equal(stats.requestCount, 2);
    assert.equal(stats.requestDurationMs.count, 2);
    assert.doesNotMatch(JSON.stringify(signals.getEvents()), /signal-boundary|query/i);
  });
});
