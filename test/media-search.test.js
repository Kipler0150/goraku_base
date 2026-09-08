import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../server/app.js';
import {
  ProviderError,
  PROVIDER_ERROR_CODES
} from '../server/providers/anilist.js';

function createMockAdapter(result = {
  results: [],
  pagination: { page: 1, perPage: 12, hasMore: false }
}) {
  const calls = [];
  return {
    calls,
    adapter: {
      async searchAnime(options) {
        calls.push(options);
        return result;
      }
    }
  };
}

function createMediaMockAdapter(result = {
  results: [],
  pagination: { page: 1, perPage: 12, hasMore: false }
}) {
  const calls = [];
  return {
    calls,
    adapter: {
      async searchMedia(options) {
        calls.push(options);
        return result;
      }
    }
  };
}

describe('anime search HTTP API', () => {
  it('validates the query and does not call AniList for invalid parameters', async () => {
    const mock = createMockAdapter();
    const app = createApp({ anilistAdapter: mock.adapter });

    const response = await request(app)
      .get('/api/media/search?type=ANIME&q=%20%20');

    assert.equal(response.status, 400);
    assert.deepEqual(response.body, {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The request query parameters are invalid.',
        details: [
          { field: 'type', message: 'type must be exactly "anime", "movie", or "tv".' },
          { field: 'q', message: 'q must contain between 1 and 100 characters after trimming.' }
        ]
      }
    });
    assert.equal(mock.calls.length, 0);
  });

  it('rejects unknown, repeated, and non-strict pagination parameters', async () => {
    const mock = createMockAdapter();
    const app = createApp({ anilistAdapter: mock.adapter });

    const response = await request(app)
      .get('/api/media/search?type=anime&q=naruto&q=bleach&page=01&unexpected=yes');

    assert.equal(response.status, 400);
    assert.deepEqual(response.body.error.details, [
      { field: 'q', message: 'Query parameters may only appear once.' },
      { field: 'unexpected', message: 'Unknown query parameter.' },
      { field: 'page', message: 'page must be a positive decimal integer from 1 to 100.' }
    ]);
    assert.equal(mock.calls.length, 0);
  });

  it('validates the optional provider pin before calling either adapter', async () => {
    const anilist = createMockAdapter();
    const myanimelist = createMockAdapter();
    const app = createApp({ anilistAdapter: anilist.adapter, myanimelistAdapter: myanimelist.adapter });

    const response = await request(app)
      .get('/api/media/search?type=anime&q=naruto&provider=other');

    assert.equal(response.status, 400);
    assert.deepEqual(response.body.error.details, [
      { field: 'provider', message: 'provider must be anilist or myanimelist.' }
    ]);
    assert.equal(anilist.calls.length, 0);
    assert.equal(myanimelist.calls.length, 0);
  });

  it('returns an empty result page for provider-short search terms without calling providers', async () => {
    const anilist = createMockAdapter();
    const myanimelist = createMockAdapter();
    const app = createApp({ anilistAdapter: anilist.adapter, myanimelistAdapter: myanimelist.adapter });

    const response = await request(app)
      .get('/api/media/search?type=anime&q=2e');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      results: [],
      source: 'anilist',
      pagination: { page: 1, perPage: 12, hasMore: false },
      providerErrors: []
    });
    assert.equal(anilist.calls.length, 0);
    assert.equal(myanimelist.calls.length, 0);
  });

  it('forwards normalized search options and returns the documented success shape', async () => {
    const media = {
      provider: 'anilist',
      providerId: '1',
      type: 'ANIME',
      id: 'anilist:ANIME:1',
      title: 'Naruto',
      originalTitle: null,
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
      metadata: { episodeCount: null, episodeDurationMinutes: null }
    };
    const mock = createMockAdapter({
      results: [media],
      pagination: { page: 3, perPage: 2, hasMore: true }
    });
    const app = createApp({ anilistAdapter: mock.adapter });

    const response = await request(app)
      .get('/api/media/search?type=anime&q=%20naruto%20&page=3&perPage=2&includeAdult=false');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      results: [media],
      source: 'anilist',
      pagination: { page: 3, perPage: 2, hasMore: true },
      providerErrors: []
    });
    assert.deepEqual(mock.calls, [{
      query: 'naruto',
      page: 3,
      perPage: 2,
      includeAdult: false
    }]);
  });

  it('defaults adult content and pagination values, including an empty result page', async () => {
    const mock = createMockAdapter();
    const app = createApp({ anilistAdapter: mock.adapter });

    const response = await request(app)
      .get('/api/media/search?type=anime&q=missing');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      results: [],
      source: 'anilist',
      pagination: { page: 1, perPage: 12, hasMore: false },
      providerErrors: []
    });
    assert.deepEqual(mock.calls, [{
      query: 'missing',
      page: 1,
      perPage: 12,
      includeAdult: true
    }]);
  });

  it('returns safe 503 provider errors without upstream details', async () => {
    const app = createApp({
      anilistAdapter: {
        async searchAnime() {
          throw new ProviderError(PROVIDER_ERROR_CODES.UNAVAILABLE);
        }
      }
    });

    const response = await request(app)
      .get('/api/media/search?type=anime&q=offline');

    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
      error: {
        code: 'PROVIDERS_UNAVAILABLE',
        message: 'The configured anime providers are currently unavailable.',
        details: []
      }
    });
  });

  it('maps unexpected provider failures to a stable safe 503 envelope', async () => {
    const app = createApp({
      anilistAdapter: {
        async searchAnime() {
          throw new Error('private upstream diagnostic');
        }
      }
    });

    const response = await request(app)
      .get('/api/media/search?type=anime&q=broken');

    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
      error: {
        code: 'PROVIDER_ERROR',
        message: 'AniList request failed.',
        details: []
      }
    });
    assert.equal(JSON.stringify(response.body).includes('private upstream diagnostic'), false);
  });

  it('falls back to MyAnimeList only for AniList unavailability and records the source', async () => {
    const anilistCalls = [];
    const myanimelistCalls = [];
    const app = createApp({
      anilistAdapter: {
        async searchAnime(options) {
          anilistCalls.push(options);
          throw new ProviderError(PROVIDER_ERROR_CODES.UNAVAILABLE);
        }
      },
      myanimelistAdapter: {
        enabled: true,
        async searchAnime(options) {
          myanimelistCalls.push(options);
          return {
            results: [],
            pagination: { page: options.page, perPage: options.perPage, hasMore: false }
          };
        }
      }
    });

    const response = await request(app)
      .get('/api/media/search?type=anime&q=offline');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      results: [],
      source: 'myanimelist',
      pagination: { page: 1, perPage: 12, hasMore: false },
      providerErrors: [{
        provider: 'anilist',
        code: 'PROVIDER_UNAVAILABLE',
        message: 'AniList is currently unavailable.'
      }]
    });
    assert.equal(anilistCalls.length, 1);
    assert.deepEqual(myanimelistCalls, [{
      query: 'offline',
      page: 1,
      perPage: 12,
      includeAdult: true
    }]);
  });

  it('pins a requested provider for later pages and does not retry AniList', async () => {
    const anilistCalls = [];
    const myanimelistCalls = [];
    const app = createApp({
      anilistAdapter: {
        async searchAnime(options) {
          anilistCalls.push(options);
          throw new Error('AniList should not be called for a pinned page');
        }
      },
      myanimelistAdapter: {
        enabled: true,
        async searchAnime(options) {
          myanimelistCalls.push(options);
          return {
            results: [],
            pagination: { page: options.page, perPage: options.perPage, hasMore: false }
          };
        }
      }
    });

    const response = await request(app)
      .get('/api/media/search?type=anime&q=offline&page=2&provider=myanimelist');

    assert.equal(response.status, 200);
    assert.equal(response.body.source, 'myanimelist');
    assert.equal(anilistCalls.length, 0);
    assert.deepEqual(myanimelistCalls[0], {
      query: 'offline',
      page: 2,
      perPage: 12,
      includeAdult: true
    });
  });

  it('returns the combined safe failure when a selected provider fails', async () => {
    const app = createApp({
      anilistAdapter: createMockAdapter().adapter,
      myanimelistAdapter: {
        enabled: true,
        async searchAnime() {
          throw new ProviderError(PROVIDER_ERROR_CODES.ERROR, 'private MAL diagnostic');
        }
      }
    });

    const response = await request(app)
      .get('/api/media/search?type=anime&q=offline&provider=myanimelist');

    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
      error: {
        code: 'PROVIDERS_UNAVAILABLE',
        message: 'The configured anime providers are currently unavailable.',
        details: []
      }
    });
    assert.equal(JSON.stringify(response.body).includes('private MAL diagnostic'), false);
  });

  it('does not fallback for AniList timeouts and returns a safe combined failure when both providers fail', async () => {
    let myanimelistCalls = 0;
    const timeoutApp = createApp({
      anilistAdapter: { async searchAnime() { throw new ProviderError(PROVIDER_ERROR_CODES.TIMEOUT); } },
      myanimelistAdapter: { enabled: true, async searchAnime() { myanimelistCalls += 1; return {}; } }
    });
    const timeoutResponse = await request(timeoutApp)
      .get('/api/media/search?type=anime&q=slow');
    assert.equal(timeoutResponse.status, 503);
    assert.equal(timeoutResponse.body.error.code, 'PROVIDER_TIMEOUT');
    assert.equal(myanimelistCalls, 0);

    const bothFailApp = createApp({
      anilistAdapter: { async searchAnime() { throw new ProviderError(PROVIDER_ERROR_CODES.UNAVAILABLE); } },
      myanimelistAdapter: { enabled: true, async searchAnime() { throw new ProviderError(PROVIDER_ERROR_CODES.UNAVAILABLE); } }
    });
    const bothFailResponse = await request(bothFailApp)
      .get('/api/media/search?type=anime&q=offline');
    assert.deepEqual(bothFailResponse.body, {
      error: {
        code: 'PROVIDERS_UNAVAILABLE',
        message: 'The configured anime providers are currently unavailable.',
        details: []
      }
    });
  });

  it('does not fallback for AniList rate limits, malformed responses, generic failures, or valid empty results', async () => {
    const nonFallbackCases = [
      [PROVIDER_ERROR_CODES.RATE_LIMITED, 'PROVIDER_RATE_LIMITED'],
      [PROVIDER_ERROR_CODES.INVALID_RESPONSE, 'PROVIDER_INVALID_RESPONSE'],
      [PROVIDER_ERROR_CODES.ERROR, 'PROVIDER_ERROR']
    ];

    for (const [providerCode, expectedCode] of nonFallbackCases) {
      let myanimelistCalls = 0;
      const app = createApp({
        anilistAdapter: { async searchAnime() { throw new ProviderError(providerCode); } },
        myanimelistAdapter: { enabled: true, async searchAnime() { myanimelistCalls += 1; return {}; } }
      });
      const response = await request(app).get('/api/media/search?type=anime&q=blocked');
      assert.equal(response.status, 503);
      assert.equal(response.body.error.code, expectedCode);
      assert.equal(myanimelistCalls, 0);
    }

    let myanimelistCalls = 0;
    const emptyApp = createApp({
      anilistAdapter: {
        async searchAnime() {
          return { results: [], pagination: { page: 1, perPage: 12, hasMore: false } };
        }
      },
      myanimelistAdapter: { enabled: true, async searchAnime() { myanimelistCalls += 1; return {}; } }
    });
    const emptyResponse = await request(emptyApp).get('/api/media/search?type=anime&q=empty');
    assert.equal(emptyResponse.status, 200);
    assert.equal(emptyResponse.body.source, 'anilist');
    assert.equal(myanimelistCalls, 0);
  });
});

describe('typed media search HTTP API', () => {
  it('accepts movie and TV requests through the TMDB adapter boundary', async () => {
    const tmdb = createMediaMockAdapter();
    const app = createApp({
      anilistAdapter: createMockAdapter().adapter,
      myanimelistAdapter: createMockAdapter().adapter,
      tmdbAdapter: tmdb.adapter
    });

    const movieResponse = await request(app)
      .get('/api/media/search?type=movie&q=arrival&provider=tmdb&includeAdult=false');
    const tvResponse = await request(app)
      .get('/api/media/search?type=tv&q=severance');

    assert.equal(movieResponse.status, 200);
    assert.equal(movieResponse.body.source, 'tmdb');
    assert.equal(tvResponse.status, 200);
    assert.equal(tvResponse.body.source, 'tmdb');
    assert.deepEqual(tmdb.calls, [
      { type: 'movie', query: 'arrival', page: 1, perPage: 12, includeAdult: false },
      { type: 'tv', query: 'severance', page: 1, perPage: 12, includeAdult: true }
    ]);
  });

  it('rejects incompatible type and provider combinations before calling adapters', async () => {
    const anilist = createMockAdapter();
    const myanimelist = createMockAdapter();
    const tmdb = createMediaMockAdapter();
    const app = createApp({
      anilistAdapter: anilist.adapter,
      myanimelistAdapter: myanimelist.adapter,
      tmdbAdapter: tmdb.adapter
    });

    for (const query of [
      'type=anime&q=naruto&provider=tmdb',
      'type=movie&q=arrival&provider=anilist',
      'type=tv&q=severance&provider=myanimelist'
    ]) {
      const response = await request(app).get(`/api/media/search?${query}`);
      assert.equal(response.status, 400);
      assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    }

    assert.equal(anilist.calls.length, 0);
    assert.equal(myanimelist.calls.length, 0);
    assert.equal(tmdb.calls.length, 0);
  });

  it('returns a safe TMDB unavailable response when the server has no access token', async () => {
    let requestCount = 0;
    const app = createApp({
      tmdbAdapter: {
        enabled: false,
        async searchMedia() {
          requestCount += 1;
          throw new Error('must not reach disabled provider');
        }
      }
    });

    const response = await request(app)
      .get('/api/media/search?type=movie&q=arrival&provider=tmdb');

    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
      error: {
        code: 'PROVIDER_UNAVAILABLE',
        message: 'TMDB is currently unavailable.',
        details: []
      }
    });
    assert.equal(requestCount, 0);
  });
});
