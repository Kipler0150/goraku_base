import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAniListAdapter } from '../server/providers/anilist.js';

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    }
  };
}

function page(media, pageInfo = { currentPage: 1, perPage: 12, hasNextPage: false }) {
  return { data: { Page: { pageInfo, media } } };
}

describe('AniList adapter', () => {
  it('normalizes anime results and forwards search preferences', async () => {
    let request;
    const adapter = createAniListAdapter({
      request: async (url, options) => {
        request = { url, options };
        return response(page([{
          id: 1,
          title: { english: 'English title', romaji: 'Romaji title', native: '原題' },
          description: '<b>A hero</b> &amp; a friend.<br>Second line.',
          coverImage: { extraLarge: 'https://img/extra', large: 'https://img/large' },
          bannerImage: 'https://img/banner',
          startDate: { year: 2024, month: 2, day: 29 },
          genres: ['Action', 'Drama'],
          averageScore: 87,
          status: 'RELEASING',
          staff: {
            edges: [{ role: 'Director', node: { name: { full: 'A Director' } } }]
          },
          studios: {
            edges: [
              { isMain: true, node: { name: 'Main Studio' } },
              { isMain: false, node: { name: 'Other Studio' } }
            ]
          },
          episodes: 12,
          duration: 24,
          isAdult: false
        }], { currentPage: 2, perPage: 1, hasNextPage: true }));
      }
    });

    const result = await adapter.searchAnime({
      query: '  fullmetal  ',
      page: 2,
      perPage: 1,
      includeAdult: false
    });

    assert.equal(request.url, 'https://graphql.anilist.co');
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(request.options.body).variables, {
      search: '  fullmetal  ',
      page: 2,
      perPage: 1,
      includeAdult: false
    });
    assert.deepEqual(result.pagination, { page: 2, perPage: 1, hasMore: true });
    assert.deepEqual(result.results[0], {
      provider: 'anilist',
      providerId: '1',
      type: 'ANIME',
      id: 'anilist:ANIME:1',
      title: 'English title',
      originalTitle: '原題',
      alternativeTitles: ['Romaji title'],
      description: 'A hero & a friend.\nSecond line.',
      image: 'https://img/extra',
      bannerImage: 'https://img/banner',
      releaseDate: { year: 2024, month: 2, day: 29 },
      genres: ['Action', 'Drama'],
      providerRating: { value: 87, max: 100, normalized: 8.7 },
      releaseStatus: 'ONGOING',
      creators: [
        { name: 'A Director', role: 'Director' },
        { name: 'Main Studio', role: 'studio' }
      ],
      isAdult: false,
      metadata: { episodeCount: 12, episodeDurationMinutes: 24 }
    });
  });

  it('preserves sparse values and includes adult content by default', async () => {
    let variables;
    const adapter = createAniListAdapter({
      request: async (_url, options) => {
        variables = JSON.parse(options.body).variables;
        return response(page([{ id: 2, title: null, isAdult: null }]));
      }
    });

    const result = await adapter.searchAnime({ query: 'sparse' });

    assert.deepEqual(variables, {
      search: 'sparse',
      page: 1,
      perPage: 12,
      includeAdult: true
    });
    assert.deepEqual(result.results[0], {
      provider: 'anilist',
      providerId: '2',
      type: 'ANIME',
      id: 'anilist:ANIME:2',
      title: null,
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
      isAdult: null,
      metadata: { episodeCount: null, episodeDurationMinutes: null }
    });
  });

  it('returns an empty successful page without inventing results', async () => {
    const adapter = createAniListAdapter({
      request: async () => response(page([]))
    });

    const result = await adapter.searchAnime({ query: 'missing' });

    assert.deepEqual(result, {
      results: [],
      pagination: { page: 1, perPage: 12, hasMore: false }
    });
  });

  it('maps malformed payloads and GraphQL errors to safe provider errors', async () => {
    const malformed = createAniListAdapter({
      request: async () => response({ data: { Page: { pageInfo: {}, media: [null] } } })
    });
    const graphql = createAniListAdapter({
      request: async () => response({ errors: [{ message: 'private upstream detail' }], data: page([]).data })
    });
    const emptyGraphqlErrors = createAniListAdapter({
      request: async () => response({ errors: [], data: page([]).data })
    });

    await assert.rejects(malformed.searchAnime({ query: 'bad' }), {
      code: 'PROVIDER_INVALID_RESPONSE',
      message: 'AniList returned an invalid response.'
    });
    await assert.rejects(graphql.searchAnime({ query: 'bad' }), {
      code: 'PROVIDER_ERROR',
      message: 'AniList returned a provider error.'
    });
    await assert.rejects(emptyGraphqlErrors.searchAnime({ query: 'bad' }), {
      code: 'PROVIDER_ERROR',
      message: 'AniList returned a provider error.'
    });
  });

  it('maps timeouts, rate limits, and AniList outage 403 responses', async () => {
    const timeout = createAniListAdapter({
      timeoutMs: 10,
      request: () => new Promise(() => {})
    });
    const rateLimited = createAniListAdapter({
      request: async () => response({}, 429)
    });
    const unavailable = createAniListAdapter({
      request: async () => response({}, 403)
    });

    await assert.rejects(timeout.searchAnime({ query: 'slow' }), {
      code: 'PROVIDER_TIMEOUT',
      message: 'AniList did not respond within the allowed time.'
    });
    await assert.rejects(rateLimited.searchAnime({ query: 'busy' }), {
      code: 'PROVIDER_RATE_LIMITED',
      message: 'AniList rate limit reached.'
    });
    await assert.rejects(unavailable.searchAnime({ query: 'offline' }), {
      code: 'PROVIDER_UNAVAILABLE',
      message: 'AniList is currently unavailable.'
    });
  });

  it('maps request and invalid JSON failures without exposing upstream details', async () => {
    const requestFailure = createAniListAdapter({
      request: async () => {
        throw new Error('secret upstream diagnostic');
      }
    });
    const invalidJson = createAniListAdapter({
      request: async () => ({ ok: true, status: 200, async json() { throw new Error('raw body'); } })
    });

    await assert.rejects(requestFailure.searchAnime({ query: 'failed' }), {
      code: 'PROVIDER_ERROR',
      message: 'AniList request failed.'
    });
    await assert.rejects(invalidJson.searchAnime({ query: 'broken' }), {
      code: 'PROVIDER_INVALID_RESPONSE',
      message: 'AniList returned an invalid response.'
    });
  });
});
