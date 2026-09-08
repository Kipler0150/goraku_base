import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createTMDBAdapter,
  TMDB_ENDPOINT,
  TMDB_PAGE_SIZE
} from '../server/providers/tmdb.js';

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    }
  };
}

describe('TMDB adapter', () => {
  it('normalizes movie search results and sends the server-side Bearer request', async () => {
    let request;
    const adapter = createTMDBAdapter({
      accessToken: 'fixture-access-token',
      endpoint: `${TMDB_ENDPOINT}/test`,
      imageBaseUrl: 'https://images.example/t/p',
      request: async (url, options) => {
        request = { url, options };
        return response({
          page: 2,
          total_pages: 4,
          total_results: 7,
          results: [{
            id: 27205,
            adult: false,
            title: 'Inception',
            original_title: 'Inception',
            overview: 'A dream within a dream.',
            poster_path: '/inception-poster.jpg',
            backdrop_path: '/inception-backdrop.jpg',
            release_date: '2010-07-16',
            genre_ids: [878, 9999],
            vote_average: 8.4
          }]
        });
      }
    });

    const result = await adapter.searchMedia({
      type: 'movie',
      query: 'inception',
      page: 2,
      perPage: 1,
      includeAdult: false
    });

    const requestUrl = new URL(request.url);
    assert.equal(requestUrl.origin + requestUrl.pathname, 'https://api.themoviedb.org/3/search/test/movie');
    assert.equal(requestUrl.searchParams.get('query'), 'inception');
    assert.equal(requestUrl.searchParams.get('page'), '2');
    assert.equal(requestUrl.searchParams.get('include_adult'), 'false');
    assert.equal(requestUrl.searchParams.get('language'), 'en-US');
    assert.equal(requestUrl.searchParams.has('per_page'), false);
    assert.equal(request.options.headers.Authorization, 'Bearer fixture-access-token');
    assert.equal(request.options.headers.accept, 'application/json');
    assert.deepEqual(result.pagination, { page: 2, perPage: TMDB_PAGE_SIZE, hasMore: true });
    assert.deepEqual(result.results[0], {
      provider: 'tmdb',
      providerId: '27205',
      type: 'MOVIE',
      id: 'tmdb:MOVIE:27205',
      title: 'Inception',
      originalTitle: 'Inception',
      alternativeTitles: [],
      description: 'A dream within a dream.',
      image: 'https://images.example/t/p/w500/inception-poster.jpg',
      bannerImage: 'https://images.example/t/p/w1280/inception-backdrop.jpg',
      releaseDate: { year: 2010, month: 7, day: 16 },
      genres: ['Science Fiction'],
      providerRating: { value: 8.4, max: 10, normalized: 8.4 },
      releaseStatus: 'UNKNOWN',
      creators: [],
      isAdult: false,
      metadata: { runtimeMinutes: null }
    });
  });

  it('normalizes TV results, preserves sparse values, filters adult entries, and does not slice provider pages', async () => {
    let requestUrl;
    const adapter = createTMDBAdapter({
      accessToken: 'fixture-access-token',
      request: async (url) => {
        requestUrl = url;
        return response({
          page: 1,
          total_pages: 1,
          total_results: 2,
          results: [
            { id: 1001, adult: true, name: 'Adult result', first_air_date: '2024-01', genre_ids: [18] },
            {
              id: 1002,
              adult: false,
              name: 'Northbound',
              original_name: 'Northbound original',
              overview: null,
              poster_path: null,
              backdrop_path: '/northbound.jpg',
              first_air_date: '2024-01',
              genre_ids: [10765, 9999],
              vote_average: 0
            }
          ]
        });
      }
    });

    const result = await adapter.searchMedia({ type: 'tv', query: 'northbound', perPage: 1, includeAdult: false });

    assert.equal(new URL(requestUrl).searchParams.get('include_adult'), 'false');
    assert.equal(result.results.length, 1);
    assert.deepEqual(result.results[0], {
      provider: 'tmdb',
      providerId: '1002',
      type: 'TV',
      id: 'tmdb:TV:1002',
      title: 'Northbound',
      originalTitle: 'Northbound original',
      alternativeTitles: [],
      description: null,
      image: null,
      bannerImage: 'https://image.tmdb.org/t/p/w1280/northbound.jpg',
      releaseDate: { year: 2024, month: 1, day: null },
      genres: ['Sci-Fi & Fantasy'],
      providerRating: { value: 0, max: 10, normalized: 0 },
      releaseStatus: 'UNKNOWN',
      creators: [],
      isAdult: false,
      metadata: { seasonCount: null, episodeCount: null }
    });
    assert.deepEqual(result.pagination, { page: 1, perPage: TMDB_PAGE_SIZE, hasMore: false });
  });

  it('maps missing credentials, provider failures, malformed payloads, and timeouts to safe errors', async () => {
    let requestCount = 0;
    const missingCredentials = createTMDBAdapter({
      request: async () => { requestCount += 1; return response({}); }
    });
    await assert.rejects(() => missingCredentials.searchMedia({ type: 'movie', query: 'offline' }), {
      code: 'PROVIDER_UNAVAILABLE',
      message: 'TMDB is currently unavailable.'
    });
    assert.equal(requestCount, 0);

    const unauthorized = createTMDBAdapter({ accessToken: 'fixture-access-token', request: async () => response({}, 401) });
    await assert.rejects(() => unauthorized.searchMedia({ type: 'movie', query: 'unauthorized' }), {
      code: 'PROVIDER_UNAVAILABLE',
      message: 'TMDB is currently unavailable.'
    });

    const rateLimited = createTMDBAdapter({ accessToken: 'fixture-access-token', request: async () => response({}, 429) });
    await assert.rejects(() => rateLimited.searchMedia({ type: 'movie', query: 'busy' }), {
      code: 'PROVIDER_RATE_LIMITED',
      message: 'TMDB rate limit reached.'
    });

    const malformed = createTMDBAdapter({ accessToken: 'fixture-access-token', request: async () => response({ page: 1, total_pages: 1, results: {} }) });
    await assert.rejects(() => malformed.searchMedia({ type: 'movie', query: 'broken' }), {
      code: 'PROVIDER_INVALID_RESPONSE',
      message: 'TMDB returned an invalid response.'
    });

    const requestFailure = createTMDBAdapter({ accessToken: 'fixture-access-token', request: async () => { throw new Error('private diagnostic'); } });
    await assert.rejects(() => requestFailure.searchMedia({ type: 'movie', query: 'failed' }), {
      code: 'PROVIDER_ERROR',
      message: 'TMDB request failed.'
    });

    const timeout = createTMDBAdapter({ accessToken: 'fixture-access-token', timeoutMs: 5, request: () => new Promise(() => {}) });
    await assert.rejects(() => timeout.searchMedia({ type: 'movie', query: 'slow' }), {
      code: 'PROVIDER_TIMEOUT',
      message: 'TMDB did not respond within the allowed time.'
    });
  });
});
