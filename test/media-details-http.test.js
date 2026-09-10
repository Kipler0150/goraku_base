import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { ProviderError, PROVIDER_ERROR_CODES } from '../server/providers/errors.js';

const media = {
  provider: 'tmdb',
  providerId: '550',
  type: 'MOVIE',
  id: 'tmdb:MOVIE:550',
  title: 'Fight Club',
  originalTitle: 'Fight Club',
  alternativeTitles: [],
  description: 'A normalized detail.',
  image: null,
  bannerImage: null,
  releaseDate: { year: 1999, month: 10, day: 15 },
  genres: ['Drama'],
  providerRating: { value: 8.4, max: 10, normalized: 8.4 },
  releaseStatus: 'RELEASED',
  creators: [],
  isAdult: false,
  metadata: { runtimeMinutes: 139 }
};

function createDetailsAdapter(result = media) {
  const calls = [];
  return {
    calls,
    adapter: {
      enabled: true,
      async getMediaDetails(options) {
        calls.push(options);
        return result;
      }
    }
  };
}

describe('media details HTTP API', () => {
  it('returns one normalized Provider-owned Media object for the explicit route selection', async () => {
    const tmdb = createDetailsAdapter();
    const myanimelist = createDetailsAdapter();
    const app = createApp({ tmdbAdapter: tmdb.adapter, myanimelistAdapter: myanimelist.adapter });

    const response = await request(app)
      .get('/api/media/tmdb/movie/550?includeAdult=false');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, media);
    assert.deepEqual(tmdb.calls, [{ type: 'movie', providerId: '550', includeAdult: false }]);
    assert.equal(myanimelist.calls.length, 0);
    assert.equal(Object.hasOwn(response.body, 'raw'), false);
    assert.equal(Object.hasOwn(response.body, 'libraryStatus'), false);
  });

  it('validates Provider, type, ID, adult preference, and unknown detail query values before adapters', async () => {
    const tmdb = createDetailsAdapter();
    const app = createApp({ tmdbAdapter: tmdb.adapter });
    const cases = [
      ['/api/media/unknown/movie/550', 'provider'],
      ['/api/media/tmdb/anime/550', 'provider'],
      ['/api/media/tmdb/movie/0', 'id'],
      ['/api/media/tmdb/movie/not-a-provider-id', 'id'],
      ['/api/media/tmdb/movie/550?includeAdult=maybe', 'includeAdult'],
      ['/api/media/tmdb/movie/550?unexpected=yes', 'unexpected']
    ];

    for (const [path, field] of cases) {
      const response = await request(app).get(path);
      assert.equal(response.status, 400);
      assert.equal(response.body.error.code, 'VALIDATION_ERROR');
      assert.equal(response.body.error.details.some((detail) => detail.field === field), true);
    }

    const repeated = await request(app).get('/api/media/tmdb/movie/550?includeAdult=true&includeAdult=false');
    assert.equal(repeated.status, 400);
    assert.deepEqual(repeated.body.error.details, [
      { field: 'includeAdult', message: 'Query parameters may only appear once.' }
    ]);
    assert.equal(tmdb.calls.length, 0);
  });

  it('returns 404 for absent or adult-filtered details', async () => {
    const missing = createDetailsAdapter();
    missing.adapter.getMediaDetails = async () => {
      throw new ProviderError(PROVIDER_ERROR_CODES.NOT_FOUND);
    };
    const adult = createDetailsAdapter({
      ...media,
      provider: 'anilist',
      providerId: '550',
      type: 'ANIME',
      id: 'anilist:ANIME:550',
      isAdult: true,
      metadata: { episodeCount: null, episodeDurationMinutes: null }
    });
    const app = createApp({
      tmdbAdapter: missing.adapter,
      anilistAdapter: adult.adapter
    });

    const absent = await request(app).get('/api/media/tmdb/movie/550');
    assert.equal(absent.status, 404);
    assert.deepEqual(absent.body, {
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
        details: []
      }
    });

    const filtered = await request(app).get('/api/media/anilist/anime/550?includeAdult=false');
    assert.equal(filtered.status, 404);
    assert.equal(filtered.body.error.code, 'NOT_FOUND');
  });

  it('returns 501 when a known Provider adapter has no declared detail implementation', async () => {
    const response = await request(createApp({
      tmdbAdapter: { enabled: true }
    })).get('/api/media/tmdb/movie/550');

    assert.equal(response.status, 501);
    assert.deepEqual(response.body, {
      error: {
        code: 'CAPABILITY_UNSUPPORTED',
        message: 'This Provider does not support the requested operation.',
        details: []
      }
    });
  });

  it('returns safe 503 responses for unavailable and failed Provider details without fallback', async () => {
    let fallbackCalls = 0;
    const response = await request(createApp({
      tmdbAdapter: {
        enabled: false,
        async getMediaDetails() {
          fallbackCalls += 1;
          throw new Error('must not call disabled Provider');
        }
      },
      anilistAdapter: {
        enabled: true,
        async getMediaDetails() {
          throw new Error('private upstream diagnostic');
        }
      }
    })).get('/api/media/tmdb/movie/550');

    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
      error: {
        code: 'PROVIDER_UNAVAILABLE',
        message: 'TMDB is currently unavailable.',
        details: []
      }
    });
    assert.equal(fallbackCalls, 0);

    const failed = await request(createApp({
      anilistAdapter: {
        enabled: true,
        async getMediaDetails() {
          throw new Error('private upstream diagnostic');
        }
      }
    })).get('/api/media/anilist/anime/1');

    assert.equal(failed.status, 503);
    assert.deepEqual(failed.body, {
      error: {
        code: 'PROVIDER_ERROR',
        message: 'AniList request failed.',
        details: []
      }
    });
    assert.equal(JSON.stringify(failed.body).includes('private upstream diagnostic'), false);
  });

  it('maps malformed, timeout, and Provider rate-limit details to safe 503 envelopes', async () => {
    const malformed = await request(createApp({
      anilistAdapter: {
        enabled: true,
        async getMediaDetails() {
          return { raw: 'private upstream fields' };
        }
      }
    })).get('/api/media/anilist/anime/1');
    assert.equal(malformed.status, 503);
    assert.equal(malformed.body.error.code, 'PROVIDER_INVALID_RESPONSE');
    assert.equal(JSON.stringify(malformed.body).includes('private upstream fields'), false);

    for (const code of [PROVIDER_ERROR_CODES.TIMEOUT, PROVIDER_ERROR_CODES.RATE_LIMITED]) {
      const response = await request(createApp({
        anilistAdapter: {
          enabled: true,
          async getMediaDetails() {
            throw new ProviderError(code, 'private provider diagnostic');
          }
        }
      })).get('/api/media/anilist/anime/1');
      assert.equal(response.status, 503);
      assert.equal(response.body.error.code, code);
      assert.equal(JSON.stringify(response.body).includes('private provider diagnostic'), false);
    }
  });
});
