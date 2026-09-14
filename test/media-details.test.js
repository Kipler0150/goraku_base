import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAniListAdapter } from '../server/providers/anilist.js';
import { createMyAnimeListAdapter } from '../server/providers/myanimelist.js';
import { createTMDBAdapter } from '../server/providers/tmdb.js';
import { createTheGamesDBAdapter } from '../server/providers/thegamesdb.js';
import { createRAWGAdapter } from '../server/providers/rawg.js';

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    }
  };
}

describe('Provider detail adapters', () => {
  it('retrieves and normalizes an AniList detail through the GraphQL seam', async () => {
    let request;
    const adapter = createAniListAdapter({
      request: async (url, options) => {
        request = { url, options };
        return response({
          data: {
            Media: {
              id: 1,
              title: { english: 'English title', romaji: 'Romaji title', native: 'Native title' },
              description: '<p>A normalized detail.</p>',
              coverImage: { extraLarge: 'https://img/extra' },
              bannerImage: 'https://img/banner',
              startDate: { year: 2024, month: 2, day: 29 },
              genres: ['Action'],
              averageScore: 87,
              status: 'RELEASING',
              staff: { edges: [] },
              studios: { edges: [] },
              episodes: 12,
              duration: 24,
              isAdult: false
            }
          }
        });
      }
    });

    const result = await adapter.getMediaDetails({ providerId: '1', includeAdult: false });

    assert.equal(request.url, 'https://graphql.anilist.co');
    assert.equal(request.options.method, 'POST');
    assert.deepEqual(JSON.parse(request.options.body).variables, { id: 1 });
    assert.equal(result.provider, 'anilist');
    assert.equal(result.type, 'ANIME');
    assert.equal(result.title, 'English title');
    assert.equal(result.metadata.episodeCount, 12);
    assert.equal(Object.hasOwn(result, 'raw'), false);
  });

  it('retrieves and normalizes a MyAnimeList detail with its server-only client ID', async () => {
    let request;
    const adapter = createMyAnimeListAdapter({
      clientId: 'fixture-client-id',
      request: async (url, options) => {
        request = { url, options };
        return response({
          id: 2,
          title: 'Naruto',
          alternative_titles: { ja: 'ナルト', synonyms: ['Naruto'] },
          main_picture: { large: 'https://img/naruto' },
          start_date: '2002-10-03',
          synopsis: 'A ninja story.',
          mean: 8.3,
          status: 'finished_airing',
          nsfw: 'white',
          genres: [{ name: 'Action' }],
          num_episodes: 220,
          average_episode_duration: 1380
        });
      }
    });

    const result = await adapter.getMediaDetails({ providerId: '2' });

    const url = new URL(request.url);
    assert.equal(url.pathname, '/v2/anime/2');
    assert.match(url.searchParams.get('fields'), /alternative_titles/);
    assert.equal(request.options.headers['X-MAL-CLIENT-ID'], 'fixture-client-id');
    assert.equal(result.providerId, '2');
    assert.equal(result.originalTitle, 'ナルト');
    assert.equal(result.metadata.episodeDurationMinutes, 23);
  });

  it('retrieves and normalizes TMDB movie and TV details', async () => {
    const requests = [];
    const adapter = createTMDBAdapter({
      accessToken: 'fixture-access-token',
      detailsEndpoint: 'https://api.themoviedb.org/3',
      request: async (url, options) => {
        requests.push({ url, options });
        const type = url.pathname.split('/').at(-2);
        return response(type === 'movie'
          ? {
              id: 550,
              adult: false,
              title: 'Fight Club',
              original_title: 'Fight Club',
              overview: 'A normalized movie detail.',
              poster_path: '/fight-club.jpg',
              backdrop_path: '/fight-club-backdrop.jpg',
              release_date: '1999-10-15',
              genres: [{ id: 18, name: 'Drama' }],
              vote_average: 8.4,
              status: 'Released',
              runtime: 139
            }
          : {
              id: 1399,
              adult: false,
              name: 'Game of Thrones',
              original_name: 'Game of Thrones',
              overview: 'A normalized TV detail.',
              poster_path: '/got.jpg',
              backdrop_path: '/got-backdrop.jpg',
              first_air_date: '2011-04-17',
              genres: [{ id: 18, name: 'Drama' }],
              vote_average: 8.5,
              status: 'Ended',
              number_of_seasons: 8,
              number_of_episodes: 73,
              created_by: [{ id: 1, name: 'A Creator' }]
            });
      }
    });

    const movie = await adapter.getMediaDetails({ type: 'movie', providerId: '550' });
    const tv = await adapter.getMediaDetails({ type: 'tv', providerId: '1399' });

    assert.equal(new URL(requests[0].url).pathname, '/3/movie/550');
    assert.equal(requests[0].options.headers.Authorization, 'Bearer fixture-access-token');
    assert.equal(movie.metadata.runtimeMinutes, 139);
    assert.equal(movie.releaseStatus, 'RELEASED');
    assert.deepEqual(movie.genres, ['Drama']);
    assert.equal(new URL(requests[1].url).pathname, '/3/tv/1399');
    assert.deepEqual(tv.metadata, { seasonCount: 8, episodeCount: 73 });
    assert.deepEqual(tv.creators, [{ name: 'A Creator', role: 'creator' }]);
  });

  it('retrieves and normalizes a TheGamesDB detail without requiring search pagination', async () => {
    const requests = [];
    const adapter = createTheGamesDBAdapter({
      apiKey: 'fixture-tgdb-key',
      request: async (url, options) => {
        requests.push({ url, options });
        if (url.pathname.endsWith('/Genres/ByGenreID')) {
          return response({ data: { genres: { '1': { id: 1, name: 'Action' } } } });
        }
        if (url.pathname.endsWith('/Developers/ByDeveloperID')) {
          return response({ data: { developers: { '1296': { id: 1296, name: 'Sonic Team' } } } });
        }
        if (url.pathname.endsWith('/Publishers/ByPublisherID')) {
          return response({ data: { publishers: { '1': { id: 1, name: 'Sega' } } } });
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
              genres: [1],
              developers: [1296],
              publishers: [1]
            }]
          },
          include: {
            platform: { data: { '18': { name: 'Sega Genesis' } } },
            boxart: {
              base_url: { original: 'https://cdn.example/' },
              data: { '53': [{ type: 'boxart', side: 'front', filename: 'front/53.jpg' }] }
            }
          }
        });
      }
    });

    const result = await adapter.getMediaDetails({ providerId: '53' });

    const url = new URL(requests[0].url);
    assert.equal(url.pathname, '/v1/Games/ByGameID');
    assert.equal(url.searchParams.get('id'), '53');
    assert.equal(url.searchParams.get('apikey'), 'fixture-tgdb-key');
    assert.equal(result.image, 'https://cdn.example/front/53.jpg');
    assert.deepEqual(result.metadata.platforms, ['Sega Genesis']);
    assert.deepEqual(result.genres, ['Action']);
    assert.deepEqual(result.metadata.developers, ['Sonic Team']);
    assert.deepEqual(result.metadata.publishers, ['Sega']);
  });

  it('retrieves and normalizes a RAWG detail', async () => {
    let request;
    const adapter = createRAWGAdapter({
      apiKey: 'fixture-rawg-key',
      request: async (url, options) => {
        request = { url, options };
        return response({
          id: 3498,
          name: 'Grand Theft Auto V',
          released: '2013-09-17',
          tba: false,
          background_image: 'https://media.rawg.io/images/gta-v.jpg',
          rating: 4.5,
          description_raw: 'A sprawling crime epic.',
          genres: [{ name: 'Action' }],
          platforms: [{ platform: { name: 'PC' } }],
          developers: [{ name: 'Rockstar North' }],
          publishers: [{ name: 'Rockstar Games' }],
          esrb_rating: { name: 'Mature', slug: 'mature' }
        });
      }
    });

    const result = await adapter.getMediaDetails({ providerId: '3498' });

    assert.equal(new URL(request.url).pathname, '/api/games/3498');
    assert.equal(new URL(request.url).searchParams.get('key'), 'fixture-rawg-key');
    assert.equal(request.options.headers.accept, 'application/json');
    assert.equal(result.title, 'Grand Theft Auto V');
    assert.equal(result.providerRating.normalized, 9);
  });

  it('maps missing detail responses to a safe provider-not-found error', async () => {
    const adapters = [
      createAniListAdapter({ request: async () => response({ data: { Media: null } }) }),
      createMyAnimeListAdapter({ clientId: 'fixture-client-id', request: async () => response({}, 404) }),
      createTMDBAdapter({ accessToken: 'fixture-access-token', request: async () => response({}, 404) }),
      createTheGamesDBAdapter({ apiKey: 'fixture-tgdb-key', request: async () => response({ data: { games: [] } }) }),
      createRAWGAdapter({ apiKey: 'fixture-rawg-key', request: async () => response({}, 404) })
    ];

    const options = [
      { providerId: '1' },
      { providerId: '1' },
      { type: 'movie', providerId: '1' },
      { providerId: '1' },
      { providerId: '1' }
    ];

    for (const [index, adapter] of adapters.entries()) {
      await assert.rejects(adapter.getMediaDetails(options[index]), {
        code: 'PROVIDER_NOT_FOUND'
      });
    }
  });

  it('filters adult details at the adapter seam when adult content is disabled', async () => {
    const adapter = createRAWGAdapter({
      apiKey: 'fixture-rawg-key',
      request: async () => response({
        id: 7,
        name: 'Adults Only Game',
        esrb_rating: { name: 'Adults Only', slug: 'adults-only' }
      })
    });

    await assert.rejects(adapter.getMediaDetails({ providerId: '7', includeAdult: false }), {
      code: 'PROVIDER_NOT_FOUND'
    });
    const allowed = await adapter.getMediaDetails({ providerId: '7', includeAdult: true });
    assert.equal(allowed.isAdult, true);
  });

  it('maps detail rate limits and timeouts to stable safe Provider errors', async () => {
    const rateLimitedAdapters = [
      createAniListAdapter({ request: async () => response({}, 429) }),
      createMyAnimeListAdapter({ clientId: 'fixture-client-id', request: async () => response({}, 429) }),
      createTMDBAdapter({ accessToken: 'fixture-access-token', request: async () => response({}, 429) }),
      createTheGamesDBAdapter({ apiKey: 'fixture-tgdb-key', request: async () => response({}, 429) }),
      createRAWGAdapter({ apiKey: 'fixture-rawg-key', request: async () => response({}, 429) })
    ];
    const options = [
      { providerId: '1' },
      { providerId: '1' },
      { type: 'movie', providerId: '1' },
      { providerId: '1' },
      { providerId: '1' }
    ];

    for (const [index, adapter] of rateLimitedAdapters.entries()) {
      await assert.rejects(adapter.getMediaDetails(options[index]), {
        code: 'PROVIDER_RATE_LIMITED'
      });
    }

    const timeout = createTMDBAdapter({
      accessToken: 'fixture-access-token',
      timeoutMs: 5,
      request: () => new Promise(() => {})
    });
    await assert.rejects(timeout.getMediaDetails({ type: 'movie', providerId: '1' }), {
      code: 'PROVIDER_TIMEOUT'
    });
  });

  it('keeps search 404 failures on the existing generic search error path', async () => {
    const anilist = createAniListAdapter({ request: async () => response({}, 404) });
    const myanimelist = createMyAnimeListAdapter({ clientId: 'fixture-client-id', request: async () => response({}, 404) });
    const tmdb = createTMDBAdapter({ accessToken: 'fixture-access-token', request: async () => response({}, 404) });

    await assert.rejects(anilist.searchMedia({ query: 'missing' }), { code: 'PROVIDER_ERROR' });
    await assert.rejects(myanimelist.searchMedia({ query: 'missing' }), { code: 'PROVIDER_ERROR' });
    await assert.rejects(tmdb.searchMedia({ type: 'movie', query: 'missing' }), { code: 'PROVIDER_ERROR' });
  });
});
