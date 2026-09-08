import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createMyAnimeListAdapter,
  MYANIMELIST_ENDPOINT
} from '../server/providers/myanimelist.js';

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    }
  };
}

function animePage(data, next = undefined) {
  return {
    data,
    ...(next ? { paging: { next } } : {})
  };
}

describe('MyAnimeList adapter', () => {
  it('normalizes anime results and sends the server-side client ID', async () => {
    let request;
    const adapter = createMyAnimeListAdapter({
      clientId: 'mal-client-id',
      request: async (url, options) => {
        request = { url, options };
        return response(animePage([{
          node: {
            id: 1,
            title: 'Naruto',
            main_picture: { large: 'https://img/large', medium: 'https://img/medium' },
            alternative_titles: { en: 'Naruto', ja: 'ナルト' },
            start_date: '2002-10-03',
            synopsis: 'A ninja story.',
            mean: 8.3,
            status: 'finished_airing',
            nsfw: 'white',
            genres: [{ name: 'Action' }],
            num_episodes: 220,
            average_episode_duration: 1380
          }
        }], 'https://api.myanimelist.net/v2/anime?q=naruto&limit=12&offset=12'));
      }
    });

    const result = await adapter.searchAnime({ query: 'naruto', page: 2, perPage: 12, includeAdult: false });

    const requestUrl = new URL(request.url);
    assert.equal(requestUrl.origin + requestUrl.pathname, MYANIMELIST_ENDPOINT);
    assert.equal(requestUrl.searchParams.get('q'), 'naruto');
    assert.equal(requestUrl.searchParams.get('limit'), '12');
    assert.equal(requestUrl.searchParams.get('offset'), '12');
    assert.match(requestUrl.searchParams.get('fields'), /main_picture/);
    assert.equal(request.options.headers['X-MAL-CLIENT-ID'], 'mal-client-id');
    assert.deepEqual(result.pagination, { page: 2, perPage: 12, hasMore: true });
    assert.deepEqual(result.results[0], {
      provider: 'myanimelist',
      providerId: '1',
      type: 'ANIME',
      id: 'myanimelist:ANIME:1',
      title: 'Naruto',
      originalTitle: 'ナルト',
      alternativeTitles: [],
      description: 'A ninja story.',
      image: 'https://img/large',
      bannerImage: null,
      releaseDate: { year: 2002, month: 10, day: 3 },
      genres: ['Action'],
      providerRating: { value: 8.3, max: 10, normalized: 8.3 },
      releaseStatus: 'RELEASED',
      creators: [],
      isAdult: false,
      metadata: { episodeCount: 220, episodeDurationMinutes: 23 }
    });
  });

  it('preserves sparse values and filters explicit entries when adult content is disabled', async () => {
    const adapter = createMyAnimeListAdapter({
      clientId: 'mal-client-id',
      request: async () => response(animePage([
        { node: { id: 2, title: null, nsfw: 'black' } },
        { node: { id: 3, title: 'Family show', nsfw: 'white' } }
      ]))
    });

    const result = await adapter.searchAnime({ query: 'sparse', includeAdult: false });

    assert.deepEqual(result.results.map((item) => item.providerId), ['3']);
    assert.equal(result.results[0].isAdult, false);
    assert.equal(result.results[0].releaseDate, null);
    assert.equal(result.results[0].providerRating, null);
  });

  it('maps provider failures and reports missing credentials without making a request', async () => {
    let requestCount = 0;
    const unavailable = createMyAnimeListAdapter({
      clientId: 'mal-client-id',
      request: async () => {
        requestCount += 1;
        return response({}, 403);
      }
    });
    const missingCredentials = createMyAnimeListAdapter({
      request: async () => {
        requestCount += 1;
        return response({});
      }
    });

    await assert.rejects(() => unavailable.searchAnime({ query: 'offline' }), { code: 'PROVIDER_UNAVAILABLE' });
    await assert.rejects(() => missingCredentials.searchAnime({ query: 'offline' }), { code: 'PROVIDER_UNAVAILABLE' });
    assert.equal(requestCount, 1);
  });
});
