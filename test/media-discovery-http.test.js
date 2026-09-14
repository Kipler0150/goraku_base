import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { ProviderError, PROVIDER_ERROR_CODES } from '../server/providers/errors.js';

const movie = {
  provider: 'tmdb',
  providerId: '550',
  type: 'MOVIE',
  id: 'tmdb:MOVIE:550',
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

const anime = {
  ...movie,
  provider: 'anilist',
  providerId: '1',
  type: 'ANIME',
  id: 'anilist:ANIME:1',
  title: 'Cowboy Bebop',
  metadata: { episodeCount: null, episodeDurationMinutes: null }
};

const game = {
  ...movie,
  provider: 'rawg',
  providerId: '3498',
  type: 'GAME',
  id: 'rawg:GAME:3498',
  title: 'Grand Theft Auto V',
  metadata: { platforms: [], developers: [], publishers: [] }
};

function createDiscoveryAdapter({ result = { results: [movie], pagination: { page: 1, perPage: 12, hasMore: true } }, error = null } = {}) {
  const calls = [];
  const adapter = {
    enabled: true,
    calls,
    async getTrending(options) {
      calls.push({ operation: 'trending', options });
      if (error) throw error;
      return result;
    },
    async getPopular(options) {
      calls.push({ operation: 'popular', options });
      if (error) throw error;
      return result;
    },
    async getLatest(options) {
      calls.push({ operation: 'latest', options });
      if (error) throw error;
      return result;
    },
    async getRecommendations(options) {
      calls.push({ operation: 'recommendations', options });
      if (error) throw error;
      return result;
    }
  };
  return adapter;
}

describe('media discovery HTTP API', () => {
  it('returns an attributed, paginated trending page from the explicit Provider', async () => {
    const anilist = createDiscoveryAdapter({
      result: {
        results: [anime],
        pagination: { page: 2, perPage: 12, hasMore: true }
      }
    });
    const app = createApp({ anilistAdapter: anilist });

    const response = await request(app)
      .get('/api/media/trending?type=anime&provider=anilist&page=2&perPage=12&includeAdult=false');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      results: [anime],
      source: 'anilist',
      pagination: { page: 2, perPage: 12, hasMore: true },
      providerErrors: []
    });
    assert.deepEqual(anilist.calls, [{
      operation: 'trending',
      options: { type: 'anime', provider: 'anilist', page: 2, perPage: 12, includeAdult: false }
    }]);
  });

  it('returns an attributed latest page through the explicit Provider capability', async () => {
    const tmdb = createDiscoveryAdapter({ result: { results: [movie], pagination: { page: 1, perPage: 12, hasMore: false } } });
    const response = await request(createApp({ tmdbAdapter: tmdb }))
      .get('/api/media/latest?type=movie&provider=tmdb&includeAdult=false');

    assert.equal(response.status, 200);
    assert.equal(response.body.source, 'tmdb');
    assert.deepEqual(tmdb.calls, [{
      operation: 'latest',
      options: { provider: 'tmdb', type: 'movie', page: 1, perPage: 12, includeAdult: false }
    }]);
  });

  it('uses RAWG for server-selected game discovery while keeping TheGamesDB out of discovery', async () => {
    const rawg = createDiscoveryAdapter({ result: { results: [game], pagination: { page: 1, perPage: 12, hasMore: false } } });
    const thegamesdb = { enabled: true, async getPopular() { throw new Error('must not be called'); } };
    const app = createApp({ rawgAdapter: rawg, thegamesdbAdapter: thegamesdb });

    const response = await request(app).get('/api/media/popular?type=game');

    assert.equal(response.status, 200);
    assert.equal(response.body.source, 'rawg');
    assert.deepEqual(rawg.calls, [{
      operation: 'popular',
      options: { provider: 'rawg', type: 'game', page: 1, perPage: 12, includeAdult: true }
    }]);
  });

  it('falls back from unavailable MyAnimeList to AniList for server-selected Anime discovery', async () => {
    const anilist = createDiscoveryAdapter({ result: { results: [anime], pagination: { page: 1, perPage: 12, hasMore: false } } });
    const app = createApp({ myanimelistAdapter: { enabled: false }, anilistAdapter: anilist });

    const fallback = await request(app).get('/api/media/trending?type=anime&includeAdult=false');

    assert.equal(fallback.status, 200);
    assert.equal(fallback.body.source, 'anilist');
    assert.deepEqual(anilist.calls, [{
      operation: 'trending',
      options: { type: 'anime', provider: 'anilist', page: 1, perPage: 12, includeAdult: false }
    }]);

    const explicit = await request(app).get('/api/media/trending?type=anime&provider=myanimelist');
    assert.equal(explicit.status, 503);
    assert.equal(explicit.body.error.code, PROVIDER_ERROR_CODES.UNAVAILABLE);
  });

  it('returns Provider-owned recommendations through the anchor route', async () => {
    const tmdb = createDiscoveryAdapter({ result: { results: [movie], pagination: { page: 1, perPage: 12, hasMore: false } } });
    const app = createApp({ tmdbAdapter: tmdb });

    const response = await request(app)
      .get('/api/media/tmdb/movie/550/recommendations?perPage=12&includeAdult=false');

    assert.equal(response.status, 200);
    assert.equal(response.body.source, 'tmdb');
    assert.deepEqual(tmdb.calls, [{
      operation: 'recommendations',
      options: { provider: 'tmdb', type: 'movie', providerId: '550', page: 1, perPage: 12, includeAdult: false }
    }]);
  });

  it('returns 200 for a supported empty page and 501 for an unsupported capability', async () => {
    const tmdb = createDiscoveryAdapter({ result: { results: [], pagination: { page: 1, perPage: 12, hasMore: false } } });
    const empty = await request(createApp({ tmdbAdapter: tmdb }))
      .get('/api/media/popular?type=movie&provider=tmdb');
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.results, []);
    assert.deepEqual(empty.body.providerErrors, []);

    const unsupported = await request(createApp({ thegamesdbAdapter: { enabled: true } }))
      .get('/api/media/trending?type=game&provider=thegamesdb');
    assert.equal(unsupported.status, 501);
    assert.equal(unsupported.body.error.code, 'CAPABILITY_UNSUPPORTED');
  });

  it('validates discovery query and recommendation route inputs before calling Providers', async () => {
    const tmdb = createDiscoveryAdapter();
    const app = createApp({ tmdbAdapter: tmdb });
    const cases = [
      ['/api/media/trending?type=all', 'type'],
      ['/api/media/trending?type=movie&unexpected=yes', 'unexpected'],
      ['/api/media/popular?type=movie&page=0', 'page'],
      ['/api/media/popular?type=movie&includeAdult=maybe', 'includeAdult'],
      ['/api/media/tmdb/movie/not-an-id/recommendations', 'id'],
      ['/api/media/tmdb/anime/550/recommendations', 'provider']
    ];

    for (const [path, field] of cases) {
      const response = await request(app).get(path);
      assert.equal(response.status, 400);
      assert.equal(response.body.error.code, 'VALIDATION_ERROR');
      assert.equal(response.body.error.details.some((detail) => detail.field === field), true);
    }

    const repeated = await request(app)
      .get('/api/media/popular?type=movie&includeAdult=true&includeAdult=false');
    assert.equal(repeated.status, 400);
    assert.equal(tmdb.calls.length, 0);
  });

  it('maps absent, malformed, timeout, rate-limit, and unavailable Provider responses safely', async () => {
    const absent = await request(createApp({
      tmdbAdapter: createDiscoveryAdapter({ error: new ProviderError(PROVIDER_ERROR_CODES.NOT_FOUND) })
    })).get('/api/media/popular?type=movie&provider=tmdb');
    assert.equal(absent.status, 404);
    assert.equal(absent.body.error.code, 'NOT_FOUND');

    for (const code of [PROVIDER_ERROR_CODES.INVALID_RESPONSE, PROVIDER_ERROR_CODES.TIMEOUT, PROVIDER_ERROR_CODES.RATE_LIMITED]) {
      const response = await request(createApp({
        tmdbAdapter: createDiscoveryAdapter({ error: new ProviderError(code, 'private upstream detail') })
      })).get('/api/media/popular?type=movie&provider=tmdb');
      assert.equal(response.status, 503);
      assert.equal(response.body.error.code, code);
      assert.equal(JSON.stringify(response.body).includes('private upstream detail'), false);
    }

    const unavailable = await request(createApp({
      tmdbAdapter: { enabled: false }
    })).get('/api/media/popular?type=movie&provider=tmdb');
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.body.error.code, 'PROVIDER_UNAVAILABLE');
  });
});
