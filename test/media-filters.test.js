import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { createAniListAdapter } from '../server/providers/anilist.js';
import { createTMDBAdapter } from '../server/providers/tmdb.js';
import { createRAWGAdapter } from '../server/providers/rawg.js';

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

function page(results = [], perPage = 12) {
  return { results, pagination: { page: 1, perPage, hasMore: false } };
}

function media(provider, type, id = '1') {
  return {
    provider,
    providerId: id,
    type,
    id: `${provider}:${type}:${id}`,
    title: 'Filtered result',
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
    metadata: type === 'MOVIE'
      ? { runtimeMinutes: null }
      : type === 'TV'
        ? { seasonCount: null, episodeCount: null }
        : type === 'GAME'
          ? { platforms: [], developers: [], publishers: [] }
          : { episodeCount: null, episodeDurationMinutes: null }
  };
}

describe('media search filters', () => {
  it('routes Movie filters to TMDB and allows filter-only Movie browsing', async () => {
    const calls = [];
    const app = createApp({
      tmdbAdapter: {
        enabled: true,
        async searchMedia(options) {
          calls.push(options);
          return page([media('tmdb', 'MOVIE')], 20);
        }
      }
    });

    const result = await request(app)
      .get('/api/media/search?type=movie&genres=18|878&creator=42&minRating=8');

    assert.equal(result.status, 200);
    assert.equal(result.body.source, 'tmdb');
    assert.deepEqual(calls, [{
      type: 'movie',
      query: '',
      page: 1,
      perPage: 12,
      includeAdult: true,
      filters: { genres: ['18', '878'], creator: '42', minRating: 8, minMetacritic: undefined }
    }]);
  });

  it('rejects unsupported combinations before calling a provider', async () => {
    const calls = [];
    const app = createApp({
      tmdbAdapter: { enabled: true, async searchMedia() { calls.push('tmdb'); return page(); } }
    });

    const movieConflict = await request(app)
      .get('/api/media/search?type=movie&q=arrival&minRating=8');
    const allFilters = await request(app)
      .get('/api/media/search?type=all&q=arrival&genres=Drama');

    assert.equal(movieConflict.status, 400);
    assert.match(movieConflict.body.error.details.find(({ field }) => field === 'filters').message, /Clear the title/);
    assert.equal(allFilters.status, 400);
    assert.equal(calls.length, 0);
  });

  it('routes game filters to RAWG and exposes provider-backed option results', async () => {
    const calls = [];
    const app = createApp({
      thegamesdbAdapter: { enabled: true, async searchMedia() { throw new Error('must not call TheGamesDB'); } },
      rawgAdapter: {
        enabled: true,
        async searchMedia(options) { calls.push(options); return page([media('rawg', 'GAME')], 20); }
      },
      mediaFilterService: {
        async getOptions({ type, creatorQuery }) {
          return {
            genres: [{ id: '4', label: 'Action' }],
            creators: creatorQuery ? [{ id: '9', label: 'Creator' }] : [],
            rating: { field: 'minMetacritic', label: 'Minimum Metacritic', max: 100, step: 1 }
          };
        }
      }
    });

    const result = await request(app)
      .get('/api/media/search?type=game&q=zelda&genres=4&minMetacritic=80');
    const options = await request(app)
      .get('/api/media/filter-options?type=game&creatorQuery=creator');

    assert.equal(result.status, 200);
    assert.equal(calls[0].filters.minMetacritic, 80);
    assert.equal(options.status, 200);
    assert.deepEqual(options.body.creators, [{ id: '9', label: 'Creator' }]);
    assert.equal(options.body.source, 'rawg');
  });
});

describe('filtered provider adapters', () => {
  it('uses TMDB Discover parameters for filtered Movie requests', async () => {
    let requestedUrl;
    const adapter = createTMDBAdapter({ accessToken: 'token', request: async (url) => {
      requestedUrl = new URL(url);
      return response({ page: 1, total_pages: 1, results: [] });
    } });

    await adapter.searchMedia({ type: 'movie', query: '', filters: { genres: ['18', '878'], creator: '42', minRating: 8 } });

    assert.equal(requestedUrl.pathname, '/3/discover/movie');
    assert.equal(requestedUrl.searchParams.get('with_genres'), '18|878');
    assert.equal(requestedUrl.searchParams.get('with_people'), '42');
    assert.equal(requestedUrl.searchParams.get('vote_average.gte'), '8');
  });

  it('forwards RAWG Metacritic filters and AniList score filters', async () => {
    let rawgUrl;
    const rawg = createRAWGAdapter({ apiKey: 'key', request: async (url) => {
      rawgUrl = new URL(url);
      return response({ results: [], next: null });
    } });
    await rawg.searchMedia({ query: 'zelda', filters: { genres: ['4'], creator: '9', minMetacritic: 80 } });
    assert.equal(rawgUrl.searchParams.get('genres'), '4');
    assert.equal(rawgUrl.searchParams.get('creators'), '9');
    assert.equal(rawgUrl.searchParams.get('metacritic'), '80,100');

    let anilistVariables;
    const anilist = createAniListAdapter({ request: async (_url, options) => {
      anilistVariables = JSON.parse(options.body).variables;
      return response({ data: { Page: { pageInfo: { currentPage: 1, perPage: 12, hasNextPage: false }, media: [] } } });
    } });
    await anilist.searchMedia({ query: 'naruto', filters: { genres: ['Action'], minRating: 8 } });
    assert.deepEqual(anilistVariables, {
      search: 'naruto',
      page: 1,
      perPage: 12,
      includeAdult: true,
      genres: ['Action'],
      averageScoreGreater: 80
    });
  });
});
