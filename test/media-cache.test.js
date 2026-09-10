import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import {
  createMediaMetadataCache,
  createMediaMetadataCacheKey,
  MEDIA_CACHE_TTL_MS
} from '../server/media-cache.js';
import { createApp } from '../server/app.js';
import { ProviderError, PROVIDER_ERROR_CODES } from '../server/providers/errors.js';

const listResponse = (provider = 'tmdb', value = 'result') => ({
  results: [{
    provider,
    providerId: '1',
    type: 'MOVIE',
    id: `${provider}:MOVIE:1`,
    title: String(value),
    originalTitle: String(value),
    alternativeTitles: [],
    description: null,
    image: null,
    bannerImage: null,
    releaseDate: null,
    genres: [],
    providerRating: null,
    releaseStatus: 'UNKNOWN',
    creators: [],
    isAdult: false,
    metadata: { runtimeMinutes: null }
  }],
  source: provider,
  pagination: { page: 1, perPage: 12, hasMore: false },
  providerErrors: []
});

const detailResponse = (provider = 'tmdb', providerId = '550') => ({
  provider,
  providerId,
  type: 'MOVIE',
  id: `${provider}:MOVIE:${providerId}`,
  title: 'Fight Club',
  originalTitle: 'Fight Club',
  alternativeTitles: [],
  description: null,
  image: null,
  bannerImage: null,
  releaseDate: null,
  genres: [],
  providerRating: null,
  releaseStatus: 'UNKNOWN',
  creators: [],
  isAdult: false,
  metadata: { runtimeMinutes: null }
});

function requestOptions(overrides = {}) {
  return {
    provider: 'tmdb',
    type: 'movie',
    operation: 'search',
    request: {
      query: 'arrival',
      page: 1,
      perPage: 12,
      cursor: null,
      includeAdult: true
    },
    ...overrides
  };
}

describe('Media Metadata Cache', () => {
  it('isolates every request dimension without exposing query contents in the key', () => {
    const base = createMediaMetadataCacheKey(requestOptions());
    const dimensions = [
      { provider: 'anilist' },
      { type: 'tv' },
      { operation: 'details' },
      { request: { ...requestOptions().request, query: 'arrival 2' } },
      { request: { ...requestOptions().request, providerId: '551' } },
      { request: { ...requestOptions().request, page: 2 } },
      { request: { ...requestOptions().request, perPage: 24 } },
      { request: { ...requestOptions().request, cursor: 'opaque-cursor' } },
      { request: { ...requestOptions().request, includeAdult: false } },
      { request: { ...requestOptions().request, region: 'US' } }
    ];

    for (const change of dimensions) {
      const changed = createMediaMetadataCacheKey({ ...requestOptions(), ...change });
      assert.notEqual(changed, base);
    }

    assert.equal(base.includes('arrival'), false);
    assert.equal(base.includes('opaque-cursor'), false);
    assert.equal(createMediaMetadataCacheKey({
      ...requestOptions(),
      request: { ...requestOptions().request, sessionToken: 'do-not-cache' }
    }), null);
    assert.equal(createMediaMetadataCacheKey({
      ...requestOptions(),
      request: { ...requestOptions().request, options: { credentials: { apiKey: 'do-not-cache' } } }
    }), null);
  });

  it('shares successful values, expires them at the operation TTL, and does not serve stale data', async () => {
    let now = 10_000;
    let calls = 0;
    const cache = createMediaMetadataCache({ now: () => now });
    const options = requestOptions();

    const first = await cache.getOrSet({ ...options, load: async () => {
      calls += 1;
      return listResponse('tmdb', calls);
    } });
    const second = await cache.getOrSet({ ...options, load: async () => {
      calls += 1;
      return listResponse('tmdb', calls);
    } });

    assert.deepEqual(first, listResponse('tmdb', 1));
    assert.deepEqual(second, first);
    assert.equal(calls, 1);
    assert.equal(cache.getStats().hits, 1);
    assert.equal(cache.getStats().misses, 1);

    now += MEDIA_CACHE_TTL_MS.search;
    const expired = await cache.getOrSet({ ...options, load: async () => {
      calls += 1;
      return listResponse('tmdb', calls);
    } });

    assert.deepEqual(expired, listResponse('tmdb', 2));
    assert.equal(calls, 2);
    assert.equal(cache.size, 1);
  });

  it('applies the five-minute details TTL and the shortest Provider policy retention', async () => {
    let now = 0;
    let calls = 0;
    const cache = createMediaMetadataCache({
      now: () => now,
      policies: {
        tmdb: { eligible: true, maxTtlMs: 30_000, requiresAttribution: true }
      }
    });
    const options = requestOptions({
      operation: 'details',
      request: { providerId: '550', includeAdult: true }
    });
    const load = async () => {
      calls += 1;
      return detailResponse('tmdb');
    };

    await cache.getOrSet({ ...options, load });
    now = 29_999;
    await cache.getOrSet({ ...options, load });
    assert.equal(calls, 1);

    now = 30_000;
    await cache.getOrSet({ ...options, load });
    assert.equal(calls, 2);

    now = 0;
    const detailsCache = createMediaMetadataCache({ now: () => now });
    await detailsCache.getOrSet({ ...options, load });
    now = MEDIA_CACHE_TTL_MS.details - 1;
    await detailsCache.getOrSet({ ...options, load });
    assert.equal(calls, 3);

    now = MEDIA_CACHE_TTL_MS.details;
    await detailsCache.getOrSet({ ...options, load });
    assert.equal(calls, 4);
  });

  it('keeps at most 256 entries and evicts the least recently used entry', async () => {
    let calls = 0;
    const cache = createMediaMetadataCache();
    const load = async () => {
      calls += 1;
      return listResponse('tmdb', calls);
    };

    for (let index = 0; index < 256; index += 1) {
      await cache.getOrSet({
        ...requestOptions(),
        request: { ...requestOptions().request, query: `query-${index}` },
        load
      });
    }
    await cache.getOrSet({
      ...requestOptions(),
      request: { ...requestOptions().request, query: 'query-0' },
      load
    });
    await cache.getOrSet({
      ...requestOptions(),
      request: { ...requestOptions().request, query: 'query-256' },
      load
    });

    assert.equal(cache.size, 256);
    const callsBeforeOldestCheck = calls;
    await cache.getOrSet({
      ...requestOptions(),
      request: { ...requestOptions().request, query: 'query-1' },
      load
    });
    assert.equal(calls, callsBeforeOldestCheck + 1);

    const callsBeforeRecentCheck = calls;
    await cache.getOrSet({
      ...requestOptions(),
      request: { ...requestOptions().request, query: 'query-0' },
      load
    });
    assert.equal(calls, callsBeforeRecentCheck);
  });

  it('shares one in-flight request for identical misses', async () => {
    let release;
    let calls = 0;
    const cache = createMediaMetadataCache();
    const pending = new Promise((resolve) => { release = resolve; });
    const load = async () => {
      calls += 1;
      await pending;
      return listResponse('tmdb', 'shared');
    };

    const first = cache.getOrSet({ ...requestOptions(), load });
    const second = cache.getOrSet({ ...requestOptions(), load });
    await Promise.resolve();
    assert.equal(calls, 1);

    release();
    assert.deepEqual(await Promise.all([first, second]), [listResponse('tmdb', 'shared'), listResponse('tmdb', 'shared')]);
    assert.equal(cache.getStats().inFlightHits, 1);
  });

  it('does not retain failed requests or policy-denied and unsafe values', async () => {
    let calls = 0;
    const cache = createMediaMetadataCache({
      policies: {
        tmdb: { eligible: false, maxTtlMs: MEDIA_CACHE_TTL_MS.details, requiresAttribution: true }
      }
    });
    const options = requestOptions({ operation: 'details', request: { providerId: '550', includeAdult: true } });

    await assert.rejects(cache.getOrSet({ ...options, load: async () => {
      calls += 1;
      throw new Error('upstream failure');
    } }), /upstream failure/);
    await assert.rejects(cache.getOrSet({ ...options, load: async () => {
      calls += 1;
      throw new Error('upstream failure');
    } }), /upstream failure/);
    assert.equal(calls, 2);

    const denied = await cache.getOrSet({ ...options, load: async () => {
      calls += 1;
      return detailResponse('tmdb');
    } });
    await cache.getOrSet({ ...options, load: async () => {
      calls += 1;
      return detailResponse('tmdb');
    } });
    assert.deepEqual(denied, detailResponse('tmdb'));
    assert.equal(calls, 4);
    assert.equal(cache.size, 0);

    const unsafeCache = createMediaMetadataCache();
    const unsafeResponse = await unsafeCache.getOrSet({
      ...requestOptions(),
      load: async () => ({ ...listResponse(), privateState: 'do-not-cache', libraryStatus: 'COMPLETED' })
    });
    await unsafeCache.getOrSet({
      ...requestOptions(),
      load: async () => ({ ...listResponse(), privateState: 'do-not-cache', libraryStatus: 'COMPLETED' })
    });
    assert.equal(unsafeResponse.libraryStatus, 'COMPLETED');
    assert.equal(unsafeCache.getStats().providerRequests, 2);
    assert.equal(unsafeCache.size, 0);
  });

  it('keeps cache events free of request contents and sensitive data', async () => {
    const events = [];
    const cache = createMediaMetadataCache({ onEvent: (event) => events.push(event) });
    await cache.getOrSet({
      ...requestOptions(),
      load: async () => listResponse('tmdb')
    });
    await cache.getOrSet({
      ...requestOptions(),
      load: async () => listResponse('tmdb')
    });

    const eventText = JSON.stringify(events);
    assert.equal(eventText.includes('arrival'), false);
    assert.equal(eventText.includes('secret'), false);
    assert.equal(eventText.includes('session'), false);
    assert.equal(eventText.includes('library'), false);
    assert.equal(eventText.includes('tracking'), false);
  });

  it('rejects sensitive request options and response fields from cache storage', async () => {
    const sensitiveRequestFields = ['credential', 'session', 'libraryItem', 'tracking', 'diagnostic'];
    for (const field of sensitiveRequestFields) {
      assert.equal(createMediaMetadataCacheKey({
        ...requestOptions(),
        request: { ...requestOptions().request, options: { [field]: 'private value' } }
      }), null);
    }

    const sensitiveResponseFields = ['credentials', 'session', 'libraryItem', 'tracking', 'diagnostics', 'query', 'privateState'];
    for (const field of sensitiveResponseFields) {
      let calls = 0;
      const cache = createMediaMetadataCache();
      const load = async () => {
        calls += 1;
        return { ...listResponse(), [field]: 'private value' };
      };
      await cache.getOrSet({ ...requestOptions(), load });
      await cache.getOrSet({ ...requestOptions(), load });
      assert.equal(calls, 2);
      assert.equal(cache.size, 0);
    }
  });

  it('does not retain Provider error diagnostics in list responses', async () => {
    let calls = 0;
    const cache = createMediaMetadataCache();
    const load = async () => {
      calls += 1;
      return {
        ...listResponse(),
        providerErrors: [{ provider: 'tmdb', code: 'PROVIDER_ERROR', message: 'private credential diagnostic' }]
      };
    };

    await cache.getOrSet({ ...requestOptions(), load });
    await cache.getOrSet({ ...requestOptions(), load });
    assert.equal(calls, 2);
    assert.equal(cache.size, 0);
  });

  it('does not cache a response attributed to a different explicit Provider', async () => {
    let calls = 0;
    const cache = createMediaMetadataCache();
    const options = requestOptions();
    const load = async () => {
      calls += 1;
      return listResponse('rawg');
    };

    await cache.getOrSet({ ...options, load });
    await cache.getOrSet({ ...options, load });

    assert.equal(calls, 2);
    assert.equal(cache.size, 0);
  });
});

describe('Media Metadata Cache HTTP integration', () => {
  it('caches successful public search and details responses without caching failures', async () => {
    let searchCalls = 0;
    let detailCalls = 0;
    const media = {
      provider: 'tmdb',
      providerId: '550',
      type: 'MOVIE',
      title: 'Fight Club',
      originalTitle: 'Fight Club',
      alternativeTitles: [],
      description: null,
      image: null,
      bannerImage: null,
      releaseDate: null,
      genres: [],
      providerRating: null,
      releaseStatus: 'UNKNOWN',
      creators: [],
      isAdult: false,
      metadata: { runtimeMinutes: null }
    };
    const cache = createMediaMetadataCache();
    const app = createApp({
      mediaMetadataCache: cache,
      tmdbAdapter: {
        enabled: true,
        async searchMedia() {
          searchCalls += 1;
          return { results: [], pagination: { page: 1, perPage: 12, hasMore: false } };
        },
        async getMediaDetails() {
          detailCalls += 1;
          return media;
        }
      }
    });

    const firstSearch = await request(app).get('/api/media/search?type=movie&provider=tmdb&q=arrival');
    const secondSearch = await request(app).get('/api/media/search?type=movie&provider=tmdb&q=arrival');
    const differentSearch = await request(app).get('/api/media/search?type=movie&provider=tmdb&q=arrival&page=2');
    const firstDetail = await request(app).get('/api/media/tmdb/movie/550');
    const secondDetail = await request(app).get('/api/media/tmdb/movie/550');

    assert.equal(firstSearch.status, 200);
    assert.equal(secondSearch.status, 200);
    assert.equal(differentSearch.status, 200);
    assert.equal(firstDetail.status, 200);
    assert.equal(secondDetail.status, 200);
    assert.equal(searchCalls, 2);
    assert.equal(detailCalls, 1);
  });

  it('retains attribution when caching a successful search fallback response', async () => {
    let primaryCalls = 0;
    let fallbackCalls = 0;
    const cache = createMediaMetadataCache();
    const app = createApp({
      mediaMetadataCache: cache,
      anilistAdapter: {
        enabled: true,
        async searchAnime() {
          primaryCalls += 1;
          throw new ProviderError(PROVIDER_ERROR_CODES.UNAVAILABLE);
        }
      },
      myanimelistAdapter: {
        enabled: true,
        async searchAnime() {
          fallbackCalls += 1;
          return { results: [], pagination: { page: 1, perPage: 12, hasMore: false } };
        }
      }
    });

    const first = await request(app).get('/api/media/search?type=anime&q=naruto');
    const second = await request(app).get('/api/media/search?type=anime&q=naruto');

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(first.body.source, 'myanimelist');
    assert.equal(second.body.source, 'myanimelist');
    assert.equal(primaryCalls, 1);
    assert.equal(fallbackCalls, 1);
  });

  it('caches successful Discovery and Recommendation pages at their public route seams', async () => {
    let trendingCalls = 0;
    let recommendationCalls = 0;
    const movie = {
      provider: 'tmdb',
      providerId: '550',
      type: 'MOVIE',
      title: 'Fight Club',
      originalTitle: 'Fight Club',
      alternativeTitles: [],
      description: null,
      image: null,
      bannerImage: null,
      releaseDate: null,
      genres: [],
      providerRating: null,
      releaseStatus: 'UNKNOWN',
      creators: [],
      isAdult: false,
      metadata: { runtimeMinutes: null }
    };
    const cache = createMediaMetadataCache();
    const app = createApp({
      mediaMetadataCache: cache,
      tmdbAdapter: {
        enabled: true,
        async getTrending() {
          trendingCalls += 1;
          return { results: [movie], pagination: { page: 1, perPage: 12, hasMore: false } };
        },
        async getRecommendations() {
          recommendationCalls += 1;
          return { results: [movie], pagination: { page: 1, perPage: 12, hasMore: false } };
        }
      }
    });

    const firstTrending = await request(app).get('/api/media/trending?type=movie&provider=tmdb');
    const secondTrending = await request(app).get('/api/media/trending?type=movie&provider=tmdb');
    const firstRecommendations = await request(app).get('/api/media/tmdb/movie/550/recommendations');
    const secondRecommendations = await request(app).get('/api/media/tmdb/movie/550/recommendations');

    assert.equal(firstTrending.status, 200);
    assert.equal(secondTrending.status, 200);
    assert.equal(firstRecommendations.status, 200);
    assert.equal(secondRecommendations.status, 200);
    assert.equal(trendingCalls, 1);
    assert.equal(recommendationCalls, 1);
  });
});
