import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createRAWGAdapter,
  RAWG_ENDPOINT
} from '../server/providers/rawg.js';

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    }
  };
}

describe('RAWG adapter', () => {
  it('normalizes game results and sends the server-only query key', async () => {
    let request;
    const adapter = createRAWGAdapter({
      apiKey: 'fixture-rawg-key',
      request: async (url, options) => {
        request = { url, options };
        return response({
          count: 1,
          next: 'https://api.rawg.io/api/games?page=2',
          results: [{
            id: 3498,
            name: 'Grand Theft Auto V',
            released: '2013-09-17',
            tba: false,
            background_image: 'https://media.rawg.io/images/gta-v.jpg',
            rating: 4.5,
            description: '<p>A sprawling crime epic.</p>',
            genres: [{ name: 'Action' }, { name: 'Adventure' }],
            platforms: [{ platform: { name: 'PC' } }, { platform: { name: 'PlayStation 4' } }],
            developers: [{ name: 'Rockstar North' }],
            publishers: [{ name: 'Rockstar Games' }],
            esrb_rating: { name: 'Mature', slug: 'mature' }
          }]
        });
      }
    });

    const result = await adapter.searchMedia({ query: 'grand theft auto', page: 2, perPage: 12, includeAdult: false });

    const requestUrl = new URL(request.url);
    assert.equal(requestUrl.origin + requestUrl.pathname, RAWG_ENDPOINT);
    assert.equal(requestUrl.searchParams.get('key'), 'fixture-rawg-key');
    assert.equal(requestUrl.searchParams.get('search'), 'grand theft auto');
    assert.equal(requestUrl.searchParams.get('page'), '2');
    assert.equal(requestUrl.searchParams.get('page_size'), '12');
    assert.equal(request.options.headers.accept, 'application/json');
    assert.deepEqual(result, {
      results: [{
        provider: 'rawg',
        providerId: '3498',
        type: 'GAME',
        id: 'rawg:GAME:3498',
        title: 'Grand Theft Auto V',
        originalTitle: null,
        alternativeTitles: [],
        description: 'A sprawling crime epic.',
        image: 'https://media.rawg.io/images/gta-v.jpg',
        bannerImage: null,
        releaseDate: { year: 2013, month: 9, day: 17 },
        genres: ['Action', 'Adventure'],
        providerRating: { value: 4.5, max: 5, normalized: 9 },
        releaseStatus: 'UNKNOWN',
        creators: [],
        isAdult: false,
        metadata: {
          platforms: ['PC', 'PlayStation 4'],
          developers: ['Rockstar North'],
          publishers: ['Rockstar Games']
        }
      }],
      pagination: { page: 2, perPage: 12, hasMore: true }
    });
  });

  it('keeps the English section when RAWG appends translated descriptions', async () => {
    const adapter = createRAWGAdapter({
      apiKey: 'fixture-rawg-key',
      request: async () => response({
        count: 1,
        next: null,
        results: [{
          id: 3498,
          name: 'Grand Theft Auto V',
          description_raw: '<p>Rockstar Games went bigger with a sprawling open-world crime story.</p>\n<p>Español Rockstar Games se hizo más grande con una historia criminal de mundo abierto.</p>'
        }]
      })
    });

    const result = await adapter.searchMedia({ query: 'grand theft auto' });

    assert.equal(result.results[0].description, 'Rockstar Games went bigger with a sprawling open-world crime story.');
  });

  it('preserves sparse fields, maps TBA, filters explicit Adults Only entries, and does not slice pages', async () => {
    const payload = {
      count: 3,
      next: null,
      results: [
        {
          id: 1,
          name: 'Future Quest',
          released: '2028-05',
          tba: true,
          rating: 0,
          esrb_rating: { name: 'Everyone', slug: 'everyone' }
        },
        {
          id: 2,
          name: null,
          released: null,
          rating: null,
          esrb_rating: null
        },
        {
          id: 3,
          name: 'Adults Only Game',
          esrb_rating: { name: 'Adults Only', slug: 'adults-only' }
        }
      ]
    };
    const adapter = createRAWGAdapter({
      apiKey: 'fixture-rawg-key',
      request: async () => response(payload)
    });

    const filtered = await adapter.searchMedia({ query: 'sparse', page: 3, perPage: 1, includeAdult: false });
    assert.deepEqual(filtered.results.map((item) => item.providerId), ['1', '2']);
    assert.equal(filtered.results[0].releaseStatus, 'ANNOUNCED');
    assert.equal(filtered.results[0].isAdult, false);
    assert.deepEqual(filtered.results[0].providerRating, { value: 0, max: 5, normalized: 0 });
    assert.deepEqual(filtered.results[0].releaseDate, { year: 2028, month: 5, day: null });
    assert.equal(filtered.results[1].title, null);
    assert.equal(filtered.results[1].releaseDate, null);
    assert.equal(filtered.results[1].isAdult, null);
    assert.deepEqual(filtered.results[1].metadata, { platforms: [], developers: [], publishers: [] });
    assert.deepEqual(filtered.pagination, { page: 3, perPage: 1, hasMore: false });

    const unfiltered = await adapter.searchMedia({ query: 'sparse', includeAdult: true });
    assert.equal(unfiltered.results.length, 3);
  });

  it('maps missing credentials, malformed payloads, and provider failures to stable errors', async () => {
    let requestCount = 0;
    const missingCredentials = createRAWGAdapter({
      request: async () => {
        requestCount += 1;
        return response({});
      }
    });
    await assert.rejects(() => missingCredentials.searchMedia({ query: 'offline' }), {
      code: 'PROVIDER_UNAVAILABLE',
      message: 'RAWG is currently unavailable.'
    });
    assert.equal(requestCount, 0);

    const malformedPayloads = [
      {},
      { results: [], next: 4 },
      { results: [{ id: 'not-a-number' }], next: null },
      { results: [{ id: 1, rating: 6 }], next: null }
    ];
    for (const payload of malformedPayloads) {
      const adapter = createRAWGAdapter({ apiKey: 'fixture-rawg-key', request: async () => response(payload) });
      await assert.rejects(() => adapter.searchMedia({ query: 'broken' }), {
        code: 'PROVIDER_INVALID_RESPONSE',
        message: 'RAWG returned an invalid response.'
      });
    }

    const cases = [
      [401, 'PROVIDER_UNAVAILABLE', 'RAWG is currently unavailable.'],
      [429, 'PROVIDER_RATE_LIMITED', 'RAWG rate limit reached.'],
      [500, 'PROVIDER_ERROR', 'RAWG request failed.'],
      [503, 'PROVIDER_UNAVAILABLE', 'RAWG is currently unavailable.']
    ];
    for (const [status, code, message] of cases) {
      const adapter = createRAWGAdapter({ apiKey: 'fixture-rawg-key', request: async () => response({}, status) });
      await assert.rejects(() => adapter.searchMedia({ query: 'failed' }), { code, message });
    }

    const invalidJson = createRAWGAdapter({
      apiKey: 'fixture-rawg-key',
      request: async () => ({ ok: true, status: 200, async json() { throw new Error('private payload diagnostic'); } })
    });
    await assert.rejects(() => invalidJson.searchMedia({ query: 'broken json' }), {
      code: 'PROVIDER_INVALID_RESPONSE',
      message: 'RAWG returned an invalid response.'
    });
  });

  it('maps request failures and timeouts without exposing upstream diagnostics', async () => {
    const requestFailure = createRAWGAdapter({
      apiKey: 'fixture-rawg-key',
      request: async () => { throw new Error('private request diagnostic'); }
    });
    await assert.rejects(() => requestFailure.searchMedia({ query: 'failed' }), {
      code: 'PROVIDER_ERROR',
      message: 'RAWG request failed.'
    });

    const timeout = createRAWGAdapter({
      apiKey: 'fixture-rawg-key',
      timeoutMs: 5,
      request: () => new Promise(() => {})
    });
    await assert.rejects(() => timeout.searchMedia({ query: 'slow' }), {
      code: 'PROVIDER_TIMEOUT',
      message: 'RAWG did not respond within the allowed time.'
    });
  });
});
