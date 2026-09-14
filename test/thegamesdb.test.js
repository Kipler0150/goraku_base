import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createTheGamesDBAdapter,
  THEGAMESDB_ENDPOINT
} from '../server/providers/thegamesdb.js';

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    }
  };
}

describe('TheGamesDB adapter', () => {
  it('normalizes game results and sends the server-only API key', async () => {
    const requests = [];
    const adapter = createTheGamesDBAdapter({
      apiKey: 'fixture-tgdb-key',
      request: async (url, options) => {
        requests.push({ url, options });
        if (url.pathname.endsWith('/Genres/ByGenreID')) {
          return response({ data: { genres: {
            '1': { id: 1, name: 'Action' },
            '8': { id: 8, name: 'Platform' }
          } } });
        }
        if (url.pathname.endsWith('/Developers/ByDeveloperID')) {
          return response({ data: { developers: {
            '1296': { id: 1296, name: 'Sonic Team' }
          } } });
        }
        if (url.pathname.endsWith('/Publishers/ByPublisherID')) {
          return response({ data: { publishers: {
            '1': { id: 1, name: 'Sega' }
          } } });
        }
        return response({
          code: 200,
          status: 'Success',
          data: {
            count: 1,
            games: [{
              id: 53,
              game_title: 'Sonic the Hedgehog',
              release_date: '1991-06-23',
              platform: 18,
              overview: 'Race through six zones.',
              rating: 'E - Everyone',
              genres: [1, 8],
              developers: [1296],
              publishers: [1],
              alternates: ['Sonic the Hedgehog (JP)']
            }]
          },
          include: {
            platform: { data: { '18': { id: 18, name: 'Sega Genesis', alias: 'sega-genesis' } } },
            boxart: {
              base_url: { original: 'https://cdn.thegamesdb.net/images/original/' },
              data: { '53': [{ type: 'boxart', side: 'front', filename: 'boxart/front/53-1.jpg' }] }
            }
          },
          pages: { previous: null, current: 'current', next: 'next' }
        });
      }
    });

    const result = await adapter.searchMedia({ query: 'sonic', page: 2, perPage: 12, includeAdult: false });
    const requestUrl = new URL(requests[0].url);
    assert.equal(requestUrl.origin + requestUrl.pathname, THEGAMESDB_ENDPOINT);
    assert.equal(requestUrl.searchParams.get('apikey'), 'fixture-tgdb-key');
    assert.equal(requestUrl.searchParams.get('name'), 'sonic');
    assert.equal(requestUrl.searchParams.get('page'), '2');
    assert.equal(requestUrl.searchParams.get('include'), 'boxart,platform');
    assert.equal(requests[0].options.headers.accept, 'application/json');
    assert.equal(result.results[0].provider, 'thegamesdb');
    assert.equal(result.results[0].id, 'thegamesdb:GAME:53');
    assert.equal(result.results[0].title, 'Sonic the Hedgehog');
    assert.equal(result.results[0].image, 'https://cdn.thegamesdb.net/images/original/boxart/front/53-1.jpg');
    assert.deepEqual(result.results[0].metadata, {
      platforms: ['Sega Genesis'],
      developers: ['Sonic Team'],
      publishers: ['Sega']
    });
    assert.deepEqual(requests.slice(1).map(({ url }) => new URL(url).pathname).sort(), [
      '/v1/Developers/ByDeveloperID',
      '/v1/Genres/ByGenreID',
      '/v1/Publishers/ByPublisherID'
    ]);
    assert.deepEqual(result.pagination, { page: 2, perPage: 20, hasMore: true });
  });

  it('filters Adults Only games and preserves sparse metadata', async () => {
    const adapter = createTheGamesDBAdapter({
      apiKey: 'fixture-tgdb-key',
      request: async () => response({
        data: {
          count: 2,
          games: [
            { id: 1, game_title: 'Safe Game', rating: 'E - Everyone' },
            { id: 2, game_title: 'Adult Game', rating: 'AO - Adults Only' }
          ]
        },
        pages: { next: null }
      })
    });

    const filtered = await adapter.searchMedia({ query: 'games', includeAdult: false });
    assert.deepEqual(filtered.results.map((game) => game.providerId), ['1']);
    assert.equal(filtered.results[0].isAdult, false);
    assert.deepEqual(filtered.results[0].metadata, { platforms: [], developers: [], publishers: [] });
    assert.equal(filtered.results[0].releaseStatus, 'UNKNOWN');
  });

  it('maps missing credentials, malformed payloads, and provider failures', async () => {
    let requestCount = 0;
    const missingCredentials = createTheGamesDBAdapter({
      request: async () => {
        requestCount += 1;
        return response({});
      }
    });
    await assert.rejects(() => missingCredentials.searchMedia({ query: 'offline' }), {
      code: 'PROVIDER_UNAVAILABLE',
      message: 'TheGamesDB is currently unavailable.'
    });
    assert.equal(requestCount, 0);

    for (const payload of [{}, { data: {}, pages: { next: null } }, { data: { games: [{ id: 'bad' }] }, pages: { next: null } }]) {
      const adapter = createTheGamesDBAdapter({ apiKey: 'fixture-tgdb-key', request: async () => response(payload) });
      await assert.rejects(() => adapter.searchMedia({ query: 'broken' }), {
        code: 'PROVIDER_INVALID_RESPONSE',
        message: 'TheGamesDB returned an invalid response.'
      });
    }

    for (const [status, code, message, body] of [
      [401, 'PROVIDER_UNAVAILABLE', 'TheGamesDB is currently unavailable.'],
      [403, 'PROVIDER_RATE_LIMITED', 'TheGamesDB rate limit reached.', { status: 'Monthly allowance exceeded.' }],
      [500, 'PROVIDER_ERROR', 'TheGamesDB request failed.']
    ]) {
      const adapter = createTheGamesDBAdapter({ apiKey: 'fixture-tgdb-key', request: async () => response(body, status) });
      await assert.rejects(() => adapter.searchMedia({ query: 'failed' }), { code, message });
    }

    const invalidKey = createTheGamesDBAdapter({
      apiKey: 'fixture-tgdb-key',
      request: async () => response({ code: 403, status: 'Invalid API key was provided.' }, 403)
    });
    await assert.rejects(() => invalidKey.searchMedia({ query: 'failed' }), {
      code: 'PROVIDER_UNAVAILABLE',
      message: 'TheGamesDB is currently unavailable.'
    });

    const nearMatch = createTheGamesDBAdapter({
      apiKey: 'fixture-tgdb-key',
      request: async () => response({ code: 403, status: 'Invalid API key was provided for this request.' }, 403)
    });
    await assert.rejects(() => nearMatch.searchMedia({ query: 'failed' }), {
      code: 'PROVIDER_RATE_LIMITED',
      message: 'TheGamesDB rate limit reached.'
    });
  });

  it('maps request failures and timeouts without exposing diagnostics', async () => {
    const requestFailure = createTheGamesDBAdapter({
      apiKey: 'fixture-tgdb-key',
      request: async () => { throw new Error('private request diagnostic'); }
    });
    await assert.rejects(() => requestFailure.searchMedia({ query: 'failed' }), {
      code: 'PROVIDER_ERROR',
      message: 'TheGamesDB request failed.'
    });

    const timeout = createTheGamesDBAdapter({
      apiKey: 'fixture-tgdb-key',
      timeoutMs: 5,
      request: () => new Promise(() => {})
    });
    await assert.rejects(() => timeout.searchMedia({ query: 'slow' }), {
      code: 'PROVIDER_TIMEOUT',
      message: 'TheGamesDB did not respond within the allowed time.'
    });
  });
});
