import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../server/app.js';
import {
  ProviderError,
  PROVIDER_ERROR_CODES
} from '../server/providers/anilist.js';
import {
  ProviderError as SharedProviderError,
  PROVIDER_ERROR_CODES as SHARED_PROVIDER_ERROR_CODES
} from '../server/providers/errors.js';

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
  it('uses provider errors from the shared provider boundary', () => {
    assert.equal(ProviderError, SharedProviderError);
    assert.equal(PROVIDER_ERROR_CODES, SHARED_PROVIDER_ERROR_CODES);
  });

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
          { field: 'type', message: 'type must be exactly "anime", "movie", "tv", "game", or "all".' },
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
  it('accepts game requests through the RAWG adapter boundary', async () => {
    const rawg = createMediaMockAdapter();
    const app = createApp({ rawgAdapter: rawg.adapter });

    const response = await request(app)
      .get('/api/media/search?type=game&q=zelda&provider=rawg&includeAdult=false');

    assert.equal(response.status, 200);
    assert.equal(response.body.source, 'rawg');
    assert.deepEqual(rawg.calls, [{
      query: 'zelda',
      page: 1,
      perPage: 12,
      includeAdult: false
    }]);
  });

  it('rejects providers outside the typed game matrix before calling adapters', async () => {
    const rawg = createMediaMockAdapter();
    const tmdb = createMediaMockAdapter();
    const app = createApp({ rawgAdapter: rawg.adapter, tmdbAdapter: tmdb.adapter });

    const response = await request(app)
      .get('/api/media/search?type=game&q=zelda&provider=tmdb');

    assert.equal(response.status, 400);
    assert.deepEqual(response.body.error.details, [
      { field: 'provider', message: 'provider must be thegamesdb or rawg.' }
    ]);
    assert.equal(rawg.calls.length, 0);
    assert.equal(tmdb.calls.length, 0);
  });

  it('uses TheGamesDB by default and falls back to RAWG only when it is unavailable', async () => {
    const thegamesdb = {
      calls: [],
      async searchMedia(options) {
        this.calls.push(options);
        throw new SharedProviderError(SHARED_PROVIDER_ERROR_CODES.UNAVAILABLE, 'private TGDB diagnostic');
      }
    };
    const rawg = createMediaMockAdapter();
    const app = createApp({ thegamesdbAdapter: thegamesdb, rawgAdapter: rawg.adapter });

    const response = await request(app).get('/api/media/search?type=game&q=zelda');

    assert.equal(response.status, 200);
    assert.equal(response.body.source, 'rawg');
    assert.deepEqual(response.body.providerErrors, [{
      provider: 'thegamesdb',
      code: 'PROVIDER_UNAVAILABLE',
      message: 'TheGamesDB is currently unavailable.'
    }]);
    assert.equal(thegamesdb.calls.length, 1);
    assert.equal(rawg.calls.length, 1);
  });

  it('keeps explicit TheGamesDB and RAWG provider pins strict', async () => {
    const thegamesdb = createMediaMockAdapter();
    const rawg = createMediaMockAdapter();
    const app = createApp({ thegamesdbAdapter: thegamesdb.adapter, rawgAdapter: rawg.adapter });

    const tgdbResponse = await request(app).get('/api/media/search?type=game&q=zelda&provider=thegamesdb');
    const rawgResponse = await request(app).get('/api/media/search?type=game&q=zelda&provider=rawg');

    assert.equal(tgdbResponse.status, 200);
    assert.equal(tgdbResponse.body.source, 'thegamesdb');
    assert.equal(rawgResponse.status, 200);
    assert.equal(rawgResponse.body.source, 'rawg');
    assert.equal(thegamesdb.calls.length, 1);
    assert.equal(rawg.calls.length, 1);
  });

  it('does not fall back when an explicit TheGamesDB provider pin fails', async () => {
    const rawg = createMediaMockAdapter();
    const app = createApp({
      thegamesdbAdapter: { async searchMedia() { throw new SharedProviderError(SHARED_PROVIDER_ERROR_CODES.UNAVAILABLE); } },
      rawgAdapter: rawg.adapter
    });

    const response = await request(app).get('/api/media/search?type=game&q=zelda&provider=thegamesdb');

    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
      error: {
        code: 'PROVIDER_UNAVAILABLE',
        message: 'TheGamesDB is currently unavailable.',
        details: []
      }
    });
    assert.equal(rawg.calls.length, 0);
  });

  it('does not fall back from TheGamesDB rate limits or malformed provider responses', async () => {
    for (const error of [
      new SharedProviderError(SHARED_PROVIDER_ERROR_CODES.RATE_LIMITED),
      new SharedProviderError(SHARED_PROVIDER_ERROR_CODES.INVALID_RESPONSE)
    ]) {
      const rawg = createMediaMockAdapter();
      const app = createApp({
        thegamesdbAdapter: { async searchMedia() { throw error; } },
        rawgAdapter: rawg.adapter
      });

      const response = await request(app).get('/api/media/search?type=game&q=zelda');

      assert.equal(response.status, 503);
      assert.equal(response.body.error.code, error.code);
      assert.equal(rawg.calls.length, 0);
    }

    const genericRAWG = createMediaMockAdapter();
    const genericApp = createApp({
      thegamesdbAdapter: { async searchMedia() { throw new SharedProviderError(SHARED_PROVIDER_ERROR_CODES.ERROR); } },
      rawgAdapter: genericRAWG.adapter
    });
    const genericResponse = await request(genericApp).get('/api/media/search?type=game&q=zelda');
    assert.equal(genericResponse.status, 503);
    assert.equal(genericResponse.body.error.code, 'PROVIDER_ERROR');
    assert.equal(genericRAWG.calls.length, 0);

    const emptyRAWG = createMediaMockAdapter();
    const emptyApp = createApp({
      thegamesdbAdapter: createMediaMockAdapter({
        results: [],
        pagination: { page: 1, perPage: 20, hasMore: false }
      }).adapter,
      rawgAdapter: emptyRAWG.adapter
    });
    const emptyResponse = await request(emptyApp).get('/api/media/search?type=game&q=zelda');
    assert.equal(emptyResponse.status, 200);
    assert.equal(emptyResponse.body.source, 'thegamesdb');
    assert.equal(emptyRAWG.calls.length, 0);
  });

  it('returns the final RAWG provider error when both game providers are unavailable', async () => {
    const app = createApp({
      thegamesdbAdapter: { async searchMedia() { throw new SharedProviderError(SHARED_PROVIDER_ERROR_CODES.UNAVAILABLE); } },
      rawgAdapter: { async searchMedia() { throw new SharedProviderError(SHARED_PROVIDER_ERROR_CODES.TIMEOUT); } }
    });

    const response = await request(app).get('/api/media/search?type=game&q=zelda');

    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
      error: {
        code: 'PROVIDER_TIMEOUT',
        message: 'RAWG did not respond within the allowed time.',
        details: []
      }
    });
  });

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

  it('preserves TMDB-owned pagination and pins later pages to TMDB', async () => {
    const tmdb = createMediaMockAdapter({
      results: [],
      pagination: { page: 2, perPage: 20, hasMore: true }
    });
    const app = createApp({ tmdbAdapter: tmdb.adapter });

    const response = await request(app)
      .get('/api/media/search?type=movie&q=arrival&page=2&perPage=24&provider=tmdb');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.pagination, { page: 2, perPage: 20, hasMore: true });
    assert.deepEqual(tmdb.calls, [{
      type: 'movie',
      query: 'arrival',
      page: 2,
      perPage: 24,
      includeAdult: true
    }]);
  });

  it('maps TMDB timeout, rate-limit, unavailable, malformed, and generic failures safely', async () => {
    const cases = [
      [PROVIDER_ERROR_CODES.TIMEOUT, 'PROVIDER_TIMEOUT', 'TMDB did not respond within the allowed time.'],
      [PROVIDER_ERROR_CODES.RATE_LIMITED, 'PROVIDER_RATE_LIMITED', 'TMDB rate limit reached.'],
      [PROVIDER_ERROR_CODES.UNAVAILABLE, 'PROVIDER_UNAVAILABLE', 'TMDB is currently unavailable.'],
      [PROVIDER_ERROR_CODES.INVALID_RESPONSE, 'PROVIDER_INVALID_RESPONSE', 'TMDB returned an invalid response.'],
      [PROVIDER_ERROR_CODES.ERROR, 'PROVIDER_ERROR', 'TMDB request failed.']
    ];

    for (const [providerCode, expectedCode, expectedMessage] of cases) {
      const app = createApp({
        tmdbAdapter: {
          async searchMedia() {
            throw new ProviderError(providerCode, 'private TMDB diagnostic');
          }
        }
      });

      const response = await request(app).get('/api/media/search?type=tv&q=severance');

      assert.equal(response.status, 503);
      assert.deepEqual(response.body, {
        error: { code: expectedCode, message: expectedMessage, details: [] }
      });
      assert.equal(JSON.stringify(response.body).includes('private TMDB diagnostic'), false);
    }
  });

  it('returns the normal empty page for short movie and TV queries without calling TMDB', async () => {
    const tmdb = createMediaMockAdapter();
    const app = createApp({ tmdbAdapter: tmdb.adapter });

    for (const type of ['movie', 'tv']) {
      const response = await request(app).get(`/api/media/search?type=${type}&q=ab`);

      assert.equal(response.status, 200);
      assert.deepEqual(response.body, {
        results: [],
        source: 'tmdb',
        pagination: { page: 1, perPage: 12, hasMore: false },
        providerErrors: []
      });
    }

    assert.equal(tmdb.calls.length, 0);
  });
});

describe('combined media search HTTP API', () => {
  it('runs the four lanes concurrently and returns deterministic media-type ordering', async () => {
    const started = [];
    let allStarted;
    const allStartedPromise = new Promise((resolve) => { allStarted = resolve; });
    const waitForAllLanes = async (provider) => {
      started.push(provider);
      if (started.length === 4) allStarted();
      await allStartedPromise;
    };
    const anilist = {
      async searchAnime(options) {
        await waitForAllLanes('anilist');
        return { results: ['anime'], pagination: { page: options.page, perPage: 12, hasMore: true } };
      }
    };
    const tmdb = {
      async searchMedia(options) {
        await waitForAllLanes(`tmdb-${options.type}`);
        return { results: [options.type], pagination: { page: options.page, perPage: 20, hasMore: false } };
      }
    };
    const thegamesdb = {
      async searchMedia(options) {
        await waitForAllLanes('thegamesdb');
        return { results: ['game'], pagination: { page: options.page, perPage: 20, hasMore: true } };
      }
    };
    const rawg = {
      async searchMedia(options) {
        await waitForAllLanes('rawg');
        return { results: ['game'], pagination: { page: options.page, perPage: 20, hasMore: true } };
      }
    };
    const app = createApp({ anilistAdapter: anilist, myanimelistAdapter: { enabled: false }, tmdbAdapter: tmdb, thegamesdbAdapter: thegamesdb, rawgAdapter: rawg });

    const response = await request(app)
      .get('/api/media/search?type=all&q=zelda&includeAdult=false');

    assert.equal(response.status, 200);
    assert.deepEqual(started.sort(), ['anilist', 'thegamesdb', 'tmdb-movie', 'tmdb-tv']);
    assert.deepEqual(response.body.results, ['anime', 'movie', 'tv', 'game']);
    assert.equal(response.body.source, 'combined');
    assert.deepEqual(response.body.pagination.providers, {
      anilist: { page: 1, perPage: 12, hasMore: true },
      tmdb: { page: 1, perPage: 20, hasMore: false },
      thegamesdb: { page: 1, perPage: 20, hasMore: true }
    });
    assert.equal(response.body.pagination.page, 1);
    assert.equal(response.body.pagination.hasMore, true);
    assert.equal(typeof response.body.pagination.continuation, 'string');
    assert.deepEqual(response.body.providerErrors, []);
  });

  it('returns 200 with safe provider errors when one independent lane fails', async () => {
    const anilist = {
      async searchAnime() {
        return { results: ['anime'], pagination: { page: 1, perPage: 12, hasMore: false } };
      }
    };
    const tmdb = {
      async searchMedia(options) {
        return { results: [options.type], pagination: { page: 1, perPage: 20, hasMore: false } };
      }
    };
    const rawg = {
      async searchMedia() {
        throw new ProviderError(PROVIDER_ERROR_CODES.RATE_LIMITED, 'private RAWG diagnostic');
      }
    };
    const app = createApp({ anilistAdapter: anilist, myanimelistAdapter: { enabled: false }, tmdbAdapter: tmdb, rawgAdapter: rawg });

    const response = await request(app).get('/api/media/search?type=all&q=zelda');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.results, ['anime', 'movie', 'tv']);
    assert.deepEqual(response.body.providerErrors, [{
      provider: 'thegamesdb',
      code: 'PROVIDER_UNAVAILABLE',
      message: 'TheGamesDB is currently unavailable.'
    }, {
      provider: 'rawg',
      code: 'PROVIDER_RATE_LIMITED',
      message: 'RAWG rate limit reached.'
    }]);
    assert.equal(JSON.stringify(response.body).includes('private RAWG diagnostic'), false);
    assert.equal(response.body.pagination.hasMore, true);
    assert.equal(typeof response.body.pagination.continuation, 'string');
  });

  it('treats a valid empty lane as success and returns 503 only when every lane fails', async () => {
    const emptyAnime = createApp({
      anilistAdapter: {
        async searchAnime() {
          return { results: [], pagination: { page: 1, perPage: 12, hasMore: false } };
        }
      },
      myanimelistAdapter: { enabled: false },
      tmdbAdapter: { async searchMedia() { throw new ProviderError(PROVIDER_ERROR_CODES.UNAVAILABLE); } },
      rawgAdapter: { async searchMedia() { throw new ProviderError(PROVIDER_ERROR_CODES.ERROR); } }
    });
    const emptyResponse = await request(emptyAnime).get('/api/media/search?type=all&q=empty');
    assert.equal(emptyResponse.status, 200);
    assert.deepEqual(emptyResponse.body.results, []);
    assert.deepEqual(emptyResponse.body.providerErrors.map(({ provider }) => provider), ['tmdb', 'thegamesdb', 'rawg']);

    const allFailed = createApp({
      anilistAdapter: { async searchAnime() { throw new ProviderError(PROVIDER_ERROR_CODES.UNAVAILABLE); } },
      myanimelistAdapter: { enabled: false },
      tmdbAdapter: { async searchMedia() { throw new ProviderError(PROVIDER_ERROR_CODES.ERROR); } },
      rawgAdapter: { async searchMedia() { throw new ProviderError(PROVIDER_ERROR_CODES.TIMEOUT); } }
    });
    const failedResponse = await request(allFailed).get('/api/media/search?type=all&q=offline');
    assert.equal(failedResponse.status, 503);
    assert.deepEqual(failedResponse.body, {
      error: {
        code: 'PROVIDERS_UNAVAILABLE',
        message: 'The configured providers are currently unavailable.',
        details: []
      }
    });
  });

  it('preserves independent lane pages and skips exhausted lanes on continuation', async () => {
    const calls = { anilist: [], tmdb: [], rawg: [] };
    const anilist = {
      async searchAnime(options) {
        calls.anilist.push(options);
        return { results: [`anime-${options.page}`], pagination: { page: options.page, perPage: 12, hasMore: options.page < 3 } };
      }
    };
    const tmdb = {
      async searchMedia(options) {
        calls.tmdb.push(options);
        const hasMore = options.type === 'tv';
        return { results: [`${options.type}-${options.page}`], pagination: { page: options.page, perPage: 20, hasMore } };
      }
    };
    const rawg = {
      async searchMedia(options) {
        calls.rawg.push(options);
        return { results: [`game-${options.page}`], pagination: { page: options.page, perPage: 20, hasMore: true } };
      }
    };
    const app = createApp({ anilistAdapter: anilist, myanimelistAdapter: { enabled: false }, tmdbAdapter: tmdb, rawgAdapter: rawg });

    const first = await request(app).get('/api/media/search?type=all&q=zelda');
    const cursor = first.body.pagination.continuation;
    const second = await request(app)
      .get(`/api/media/search?type=all&q=zelda&page=2&cursor=${encodeURIComponent(cursor)}`);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.deepEqual(first.body.results, ['anime-1', 'movie-1', 'tv-1', 'game-1']);
    assert.deepEqual(second.body.results, ['anime-2', 'tv-2', 'game-2']);
    assert.deepEqual(calls.anilist.map((options) => options.page), [1, 2]);
    assert.deepEqual(calls.tmdb.map((options) => [options.type, options.page]), [
      ['movie', 1], ['tv', 1], ['tv', 2]
    ]);
    assert.deepEqual(calls.rawg.map((options) => options.page), [1, 2]);
    assert.equal(second.body.pagination.page, 2);
    assert.deepEqual(second.body.pagination.providers, {
      anilist: { page: 2, perPage: 12, hasMore: true },
      tmdb: { page: 2, perPage: 20, hasMore: true },
      rawg: { page: 2, perPage: 20, hasMore: true }
    });
  });

  it('keeps TheGamesDB selected across Combined Search pages', async () => {
    const thegamesdbCalls = [];
    const app = createApp({
      anilistAdapter: { async searchAnime() { return { results: [], pagination: { page: 1, perPage: 12, hasMore: false } }; } },
      myanimelistAdapter: { enabled: false },
      tmdbAdapter: { async searchMedia() { return { results: [], pagination: { page: 1, perPage: 20, hasMore: false } }; } },
      thegamesdbAdapter: {
        async searchMedia(options) {
          thegamesdbCalls.push(options.page);
          return { results: [`game-${options.page}`], pagination: { page: options.page, perPage: 20, hasMore: options.page < 2 } };
        }
      },
      rawgAdapter: { enabled: false }
    });

    const first = await request(app).get('/api/media/search?type=all&q=zelda');
    const second = await request(app)
      .get(`/api/media/search?type=all&q=zelda&page=2&cursor=${encodeURIComponent(first.body.pagination.continuation)}`);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.deepEqual(first.body.results, ['game-1']);
    assert.deepEqual(second.body.results, ['game-2']);
    assert.deepEqual(thegamesdbCalls, [1, 2]);
    assert.deepEqual(second.body.pagination.providers, {
      anilist: { page: 1, perPage: 12, hasMore: false },
      tmdb: { page: 1, perPage: 20, hasMore: false },
      thegamesdb: { page: 2, perPage: 20, hasMore: false }
    });
  });

  it('pins RAWG after TheGamesDB fallback across Combined Search pages', async () => {
    const thegamesdbCalls = [];
    const rawgCalls = [];
    const app = createApp({
      anilistAdapter: { async searchAnime() { return { results: [], pagination: { page: 1, perPage: 12, hasMore: false } }; } },
      myanimelistAdapter: { enabled: false },
      tmdbAdapter: { async searchMedia() { return { results: [], pagination: { page: 1, perPage: 20, hasMore: false } }; } },
      thegamesdbAdapter: {
        async searchMedia(options) {
          thegamesdbCalls.push(options.page);
          throw new SharedProviderError(SHARED_PROVIDER_ERROR_CODES.UNAVAILABLE);
        }
      },
      rawgAdapter: {
        async searchMedia(options) {
          rawgCalls.push(options.page);
          return { results: [`fallback-game-${options.page}`], pagination: { page: options.page, perPage: 20, hasMore: options.page < 2 } };
        }
      }
    });

    const first = await request(app).get('/api/media/search?type=all&q=zelda');
    const second = await request(app)
      .get(`/api/media/search?type=all&q=zelda&page=2&cursor=${encodeURIComponent(first.body.pagination.continuation)}`);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.deepEqual(first.body.results, ['fallback-game-1']);
    assert.deepEqual(second.body.results, ['fallback-game-2']);
    assert.deepEqual(thegamesdbCalls, [1]);
    assert.deepEqual(rawgCalls, [1, 2]);
    assert.deepEqual(second.body.pagination.providers, {
      anilist: { page: 1, perPage: 12, hasMore: false },
      tmdb: { page: 1, perPage: 20, hasMore: false },
      rawg: { page: 2, perPage: 20, hasMore: false }
    });
    assert.deepEqual(second.body.providerErrors, [{
      provider: 'thegamesdb',
      code: 'PROVIDER_UNAVAILABLE',
      message: 'TheGamesDB is currently unavailable.'
    }]);
  });

  it('pins the Anime fallback provider across Combined Search pages', async () => {
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
          return { results: [`anime-${options.page}`], pagination: { page: options.page, perPage: 12, hasMore: options.page < 2 } };
        }
      },
      thegamesdbAdapter: { async searchMedia() { return { results: [], pagination: { page: 1, perPage: 20, hasMore: false } }; } },
      tmdbAdapter: { async searchMedia() { return { results: [], pagination: { page: 1, perPage: 20, hasMore: false } }; } },
      rawgAdapter: { async searchMedia() { return { results: [], pagination: { page: 1, perPage: 20, hasMore: false } }; } }
    });

    const first = await request(app).get('/api/media/search?type=all&q=naruto');
    const second = await request(app)
      .get(`/api/media/search?type=all&q=naruto&page=2&cursor=${encodeURIComponent(first.body.pagination.continuation)}`);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(first.body.pagination.providers.myanimelist.page, 1);
    assert.equal(second.body.pagination.providers.myanimelist.page, 2);
    assert.deepEqual(first.body.providerErrors, [{
      provider: 'anilist',
      code: 'PROVIDER_UNAVAILABLE',
      message: 'AniList is currently unavailable.'
    }]);
    assert.deepEqual(anilistCalls.map((options) => options.page), [1]);
    assert.deepEqual(myanimelistCalls.map((options) => options.page), [1, 2]);
    assert.deepEqual(second.body.results, ['anime-2']);
  });

  it('retries only a failed lane and does not refetch successful lanes', async () => {
    const calls = { anilist: 0, tmdb: 0, rawg: 0 };
    const app = createApp({
      anilistAdapter: { async searchAnime() { calls.anilist += 1; return { results: ['anime'], pagination: { page: 1, perPage: 12, hasMore: false } }; } },
      myanimelistAdapter: { enabled: false },
      tmdbAdapter: { async searchMedia(options) { calls.tmdb += 1; return { results: [options.type], pagination: { page: 1, perPage: 20, hasMore: false } }; } },
      rawgAdapter: {
        async searchMedia() {
          calls.rawg += 1;
          if (calls.rawg === 1) throw new ProviderError(PROVIDER_ERROR_CODES.UNAVAILABLE, 'private RAWG diagnostic');
          return { results: ['recovered-game'], pagination: { page: 1, perPage: 20, hasMore: false } };
        }
      }
    });

    const first = await request(app).get('/api/media/search?type=all&q=zelda');
    const retry = await request(app)
      .get(`/api/media/search?type=all&q=zelda&page=2&cursor=${encodeURIComponent(first.body.pagination.continuation)}&retryProvider=rawg`);

    assert.equal(first.status, 200);
    assert.deepEqual(first.body.providerErrors, [{
      provider: 'thegamesdb',
      code: 'PROVIDER_UNAVAILABLE',
      message: 'TheGamesDB is currently unavailable.'
    }, {
      provider: 'rawg',
      code: 'PROVIDER_UNAVAILABLE',
      message: 'RAWG is currently unavailable.'
    }]);
    assert.equal(retry.status, 200);
    assert.deepEqual(retry.body.results, ['recovered-game']);
    assert.deepEqual(retry.body.providerErrors, [{
      provider: 'thegamesdb',
      code: 'PROVIDER_UNAVAILABLE',
      message: 'TheGamesDB is currently unavailable.'
    }]);
    assert.equal(retry.body.pagination.hasMore, false);
    assert.equal(retry.body.pagination.continuation, null);
    assert.deepEqual(calls, { anilist: 1, tmdb: 2, rawg: 2 });
    assert.equal(first.body.pagination.continuation.includes('private'), false);
  });

  it('rejects Combined Search provider pins and invalid or mismatched cursors before calling lanes', async () => {
    const calls = { anilist: 0, tmdb: 0, rawg: 0 };
    const adapters = {
      anilistAdapter: { async searchAnime() { calls.anilist += 1; return { results: [], pagination: { page: 1, perPage: 12, hasMore: false } }; } },
      myanimelistAdapter: { enabled: false },
      tmdbAdapter: { async searchMedia() { calls.tmdb += 1; return { results: [], pagination: { page: 1, perPage: 20, hasMore: false } }; } },
      rawgAdapter: { async searchMedia() { calls.rawg += 1; return { results: [], pagination: { page: 1, perPage: 20, hasMore: false } }; } }
    };
    const app = createApp(adapters);

    const providerResponse = await request(app).get('/api/media/search?type=all&q=zelda&provider=rawg');
    const cursorResponse = await request(app).get('/api/media/search?type=all&q=zelda&page=2&cursor=not-a-cursor');

    assert.equal(providerResponse.status, 400);
    assert.equal(cursorResponse.status, 400);
    assert.equal(calls.anilist + calls.tmdb + calls.rawg, 0);
  });
});
