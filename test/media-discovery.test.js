import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAniListAdapter } from '../server/providers/anilist.js';
import { createMyAnimeListAdapter } from '../server/providers/myanimelist.js';
import { createTMDBAdapter } from '../server/providers/tmdb.js';
import { createRAWGAdapter } from '../server/providers/rawg.js';
import { PROVIDER_ERROR_CODES } from '../server/providers/errors.js';

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    }
  };
}

const anime = {
  id: 1,
  title: { english: 'Cowboy Bebop', romaji: 'Cowboy Bebop', native: null },
  description: 'A space western.',
  coverImage: { large: 'https://img.example/anime.jpg' },
  startDate: { year: 1998, month: 4, day: 3 },
  genres: ['Action'],
  averageScore: 88,
  status: 'FINISHED',
  isAdult: false
};

const game = {
  id: 3498,
  name: 'Grand Theft Auto V',
  released: '2013-09-17',
  tba: false,
  background_image: 'https://img.example/game.jpg',
  rating: 4.5,
  genres: [{ name: 'Action' }],
  platforms: [{ platform: { name: 'PC' } }],
  developers: [{ name: 'Rockstar North' }],
  publishers: [{ name: 'Rockstar Games' }]
};

describe('Provider discovery adapters', () => {
  it('maps AniList trending and popular sort operations through GraphQL', async () => {
    const requests = [];
    const adapter = createAniListAdapter({
      request: async (url, options) => {
        requests.push({ url, options });
        return response({ data: { Page: {
          pageInfo: { currentPage: 2, perPage: 3, hasNextPage: false },
          media: [anime]
        } } });
      }
    });

    const trending = await adapter.getTrending({ page: 2, perPage: 3, includeAdult: false });
    const popular = await adapter.getPopular({ page: 1, perPage: 3, includeAdult: true });
    const latest = await adapter.getLatest({ page: 1, perPage: 3, includeAdult: true });

    assert.equal(trending.results[0].provider, 'anilist');
    assert.deepEqual(trending.pagination, { page: 2, perPage: 3, hasMore: false });
    assert.deepEqual(JSON.parse(requests[0].options.body).variables, {
      page: 2,
      perPage: 3,
      includeAdult: false,
      sort: ['TRENDING_DESC']
    });
    assert.deepEqual(JSON.parse(requests[1].options.body).variables.sort, ['POPULARITY_DESC']);
    assert.deepEqual(JSON.parse(requests[2].options.body).variables.sort, ['START_DATE_DESC']);
    assert.equal(popular.results.length, 1);
    assert.equal(latest.results.length, 1);
  });

  it('normalizes AniList Provider-owned recommendations and preserves empty pages', async () => {
    const adapter = createAniListAdapter({
      request: async (_url, options) => {
        assert.match(JSON.parse(options.body).query, /recommendations/);
        return response({ data: { Media: { recommendations: {
          pageInfo: { currentPage: 1, perPage: 12, hasNextPage: false },
          nodes: [{ media: anime }]
        } } } });
      }
    });

    const result = await adapter.getRecommendations({ providerId: '1', page: 1, perPage: 12, includeAdult: false });
    assert.equal(result.results[0].providerId, '1');
    assert.equal(result.pagination.hasMore, false);
  });

  it('returns an empty successful AniList discovery page without inventing Media', async () => {
    const adapter = createAniListAdapter({
      request: async () => response({ data: { Page: {
        pageInfo: { currentPage: 1, perPage: 12, hasNextPage: false },
        media: []
      } } })
    });

    const result = await adapter.getTrending({ page: 1, perPage: 12, includeAdult: false });
    assert.deepEqual(result, {
      results: [],
      pagination: { page: 1, perPage: 12, hasMore: false }
    });
  });

  it('maps MyAnimeList popular and recommendation endpoints with safe pagination', async () => {
    const requests = [];
    const adapter = createMyAnimeListAdapter({
      clientId: 'fixture-client-id',
      request: async (url, options) => {
        requests.push({ url, options });
        if (new URL(url).pathname.endsWith('/recommendations')) {
          return response({ data: [{ node: {
            id: 1,
            title: 'Cowboy Bebop',
            main_picture: { medium: 'https://img.example/anime.jpg' }
          } }], paging: {} });
        }
        return response({ data: [{ node: {
          id: 1,
          title: 'Cowboy Bebop',
          main_picture: { medium: 'https://img.example/anime.jpg' },
          start_date: '1998-04-03',
          genres: [{ name: 'Action' }],
          mean: 8.8,
          status: 'finished_airing',
          nsfw: 'white'
        } }], paging: {} });
      }
    });

    const popular = await adapter.getPopular({ page: 2, perPage: 4, includeAdult: false });
    const recommendations = await adapter.getRecommendations({ providerId: '1', page: 1, perPage: 4, includeAdult: false });

    assert.equal(new URL(requests[0].url).pathname, '/v2/anime/ranking');
    assert.equal(new URL(requests[0].url).searchParams.get('ranking_type'), 'bypopularity');
    assert.equal(new URL(requests[0].url).searchParams.get('offset'), '4');
    assert.equal(popular.results[0].provider, 'myanimelist');
    assert.equal(recommendations.results[0].providerId, '1');
    assert.equal(requests[0].options.headers['X-MAL-CLIENT-ID'], 'fixture-client-id');
  });

  it('maps TMDB trending, popular, latest, and recommendation list endpoints', async () => {
    const requests = [];
    const adapter = createTMDBAdapter({
      accessToken: 'fixture-access-token',
      detailsEndpoint: 'https://api.themoviedb.org/3',
      request: async (url, options) => {
        requests.push({ url, options });
        const pathname = new URL(url).pathname;
        const item = {
          id: 550,
          adult: false,
          title: 'Fight Club',
          original_title: 'Fight Club',
          overview: 'A normalized movie.',
          release_date: '1999-10-15',
          genre_ids: [18],
          vote_average: 8.4
        };
        return response(pathname.includes('trending')
          ? { page: 1, total_pages: 1, results: [{ ...item, media_type: 'movie' }] }
          : { page: 1, total_pages: 1, results: [item] });
      }
    });

    await adapter.getTrending({ type: 'movie', page: 1, perPage: 12, includeAdult: false });
    await adapter.getPopular({ type: 'movie', page: 1, perPage: 12, includeAdult: false });
    await adapter.getLatest({ type: 'movie', page: 1, perPage: 12, includeAdult: false });
    await adapter.getRecommendations({ type: 'movie', providerId: '550', page: 1, perPage: 12, includeAdult: false });

    assert.equal(new URL(requests[0].url).pathname, '/3/trending/movie/week');
    assert.equal(new URL(requests[1].url).pathname, '/3/movie/popular');
    assert.equal(new URL(requests[1].url).searchParams.get('include_adult'), 'false');
    assert.equal(new URL(requests[2].url).pathname, '/3/movie/now_playing');
    assert.equal(new URL(requests[3].url).pathname, '/3/movie/550/recommendations');
    assert.equal(requests[3].options.headers.Authorization, 'Bearer fixture-access-token');
  });

  it('maps RAWG popular and Provider-owned suggested games', async () => {
    const requests = [];
    const adapter = createRAWGAdapter({
      apiKey: 'fixture-rawg-key',
      request: async (url, options) => {
        requests.push({ url, options });
        return response({ next: null, results: [game] });
      }
    });

    const popular = await adapter.getPopular({ page: 3, perPage: 5, includeAdult: false });
    const latest = await adapter.getLatest({ page: 2, perPage: 5, includeAdult: false });
    const recommendations = await adapter.getRecommendations({ providerId: '3498', page: 1, perPage: 5, includeAdult: false });

    assert.equal(new URL(requests[0].url).pathname, '/api/games');
    assert.equal(new URL(requests[0].url).searchParams.get('ordering'), '-added');
    assert.equal(new URL(requests[1].url).searchParams.get('ordering'), '-released');
    assert.equal(new URL(requests[2].url).pathname, '/api/games/3498/suggested');
    assert.equal(popular.results[0].metadata.platforms[0], 'PC');
    assert.equal(latest.results[0].provider, 'rawg');
    assert.equal(recommendations.results[0].providerId, '3498');
  });

  it('keeps malformed, timeout, rate-limit, and unavailable discovery failures safe', async () => {
    const malformed = createAniListAdapter({
      request: async () => response({ data: { Page: { pageInfo: { currentPage: 1, perPage: 12, hasNextPage: false }, media: [{}] } } })
    });
    await assert.rejects(malformed.getTrending(), { code: PROVIDER_ERROR_CODES.INVALID_RESPONSE });

    const rateLimited = createTMDBAdapter({
      accessToken: 'fixture-access-token',
      request: async () => response({}, 429)
    });
    await assert.rejects(rateLimited.getPopular({ type: 'movie' }), { code: PROVIDER_ERROR_CODES.RATE_LIMITED });

    const timeout = createRAWGAdapter({
      apiKey: 'fixture-rawg-key',
      timeoutMs: 5,
      request: () => new Promise(() => {})
    });
    await assert.rejects(timeout.getPopular(), { code: PROVIDER_ERROR_CODES.TIMEOUT });

    const unavailable = createMyAnimeListAdapter({ request: async () => { throw new Error('must not call'); } });
    await assert.rejects(unavailable.getPopular(), { code: PROVIDER_ERROR_CODES.UNAVAILABLE });
  });
});
