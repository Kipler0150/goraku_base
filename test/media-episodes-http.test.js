import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { ProviderError, PROVIDER_ERROR_CODES } from '../server/providers/errors.js';

const episodes = {
  provider: 'tmdb',
  providerId: '1002',
  type: 'TV',
  season: 2,
  episodes: [{
    number: 1,
    title: 'The Return',
    airDate: { year: 2024, month: 2, day: 1 },
    runtimeMinutes: 46,
    image: null
  }]
};

const animeEpisodes = {
  provider: 'myanimelist',
  providerId: '1535',
  type: 'ANIME',
  season: 1,
  episodes: [{
    number: 1,
    title: 'Episode 1',
    airDate: { year: 2011, month: 4, day: 17 },
    runtimeMinutes: null,
    image: null
  }]
};

describe('media episodes HTTP API', () => {
  it('returns released episode metadata through the explicit TMDB TV route', async () => {
    const calls = [];
    const app = createApp({
      mediaEpisodesService: {
        async getEpisodes(options) {
          calls.push(options);
          return episodes;
        }
      }
    });

    const response = await request(app).get('/api/media/tmdb/tv/1002/episodes?season=2');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, episodes);
    assert.deepEqual(calls, [{ provider: 'tmdb', type: 'tv', providerId: '1002', season: 2, includeAdult: true }]);
  });

  it('validates season and rejects unsupported Provider/type combinations', async () => {
    const calls = [];
    const app = createApp({
      mediaEpisodesService: {
        async getEpisodes(options) {
          calls.push(options);
          return episodes;
        }
      }
    });

    for (const path of [
      '/api/media/tmdb/tv/1002/episodes?season=0',
      '/api/media/tmdb/tv/1002/episodes?season=1.5',
      '/api/media/tmdb/tv/1002/episodes?season=1001',
      '/api/media/tmdb/tv/1002/episodes?unexpected=true'
    ]) {
      const response = await request(app).get(path);
      assert.equal(response.status, 400);
      assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    }

    const supportedAnime = await request(createApp({
      mediaEpisodesService: {
        async getEpisodes(options) {
          calls.push(options);
          return animeEpisodes;
        }
      }
    })).get('/api/media/myanimelist/anime/1535/episodes?season=1');
    assert.equal(supportedAnime.status, 200);
    assert.deepEqual(supportedAnime.body, animeEpisodes);
    assert.deepEqual(calls.at(-1), { provider: 'myanimelist', type: 'anime', providerId: '1535', season: 1, includeAdult: true });

    const unsupported = await request(createApp()).get('/api/media/rawg/game/1002/episodes?season=1');
    assert.equal(unsupported.status, 501);
  });

  it('reports AniList as the source when anime episode loading fails', async () => {
    const app = createApp({
      mediaEpisodesService: {
        async getEpisodes() {
          throw new ProviderError(PROVIDER_ERROR_CODES.UNAVAILABLE);
        }
      }
    });

    const failed = await request(app).get('/api/media/myanimelist/anime/1535/episodes?season=1');

    assert.equal(failed.status, 503);
    assert.deepEqual(failed.body.error, {
      code: PROVIDER_ERROR_CODES.UNAVAILABLE,
      message: 'AniList is currently unavailable.',
      details: []
    });
  });
});
