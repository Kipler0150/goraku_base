import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createMediaDiscoveryService,
  MediaDiscoveryCapabilityError
} from '../server/media-discovery.js';
import { ProviderError, PROVIDER_ERROR_CODES } from '../server/providers/errors.js';

const media = {
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

function serviceWith(adapter) {
  return createMediaDiscoveryService({ tmdbAdapter: adapter });
}

describe('media discovery service', () => {
  it('normalizes a supported list, strips upstream fields, and filters adult Media', async () => {
    const service = serviceWith({
      enabled: true,
      async getPopular() {
        return {
          results: [
            { ...media, raw: 'must not escape' },
            { ...media, providerId: '551', id: 'tmdb:MOVIE:551', isAdult: true }
          ],
          pagination: { page: 1, perPage: 12, hasMore: false }
        };
      }
    });

    const result = await service.getPopular({
      provider: 'tmdb',
      type: 'movie',
      page: 1,
      perPage: 12,
      includeAdult: false
    });

    assert.deepEqual(result.results, [media]);
    assert.equal(Object.hasOwn(result.results[0], 'raw'), false);
    assert.deepEqual(result.providerErrors, []);
    assert.equal(result.source, 'tmdb');
  });

  it('keeps valid empty results distinct from unsupported capabilities', async () => {
    const service = serviceWith({
      enabled: true,
      async getTrending() {
        return { results: [], pagination: { page: 1, perPage: 12, hasMore: false } };
      }
    });

    const empty = await service.getTrending({ provider: 'tmdb', type: 'movie', page: 1, perPage: 12, includeAdult: true });
    assert.deepEqual(empty.results, []);

    await assert.rejects(
      service.getTrending({ provider: 'rawg', type: 'game', page: 1, perPage: 12, includeAdult: true }),
      MediaDiscoveryCapabilityError
    );
  });

  it('does not switch Provider when a selected recommendation operation fails', async () => {
    let fallbackCalled = false;
    const service = createMediaDiscoveryService({
      tmdbAdapter: {
        enabled: true,
        async getRecommendations() {
          throw new ProviderError(PROVIDER_ERROR_CODES.TIMEOUT, 'private timeout');
        }
      },
      rawgAdapter: {
        enabled: true,
        async getRecommendations() {
          fallbackCalled = true;
          return { results: [], pagination: { page: 1, perPage: 12, hasMore: false } };
        }
      }
    });

    await assert.rejects(
      service.getRecommendations({ provider: 'tmdb', type: 'movie', providerId: '550', page: 1, perPage: 12, includeAdult: true }),
      { code: PROVIDER_ERROR_CODES.TIMEOUT }
    );
    assert.equal(fallbackCalled, false);
  });

  it('allows only the server-selected Anime discovery path to use the AniList fallback', async () => {
    const anilistMedia = {
      ...media,
      provider: 'anilist',
      providerId: '1',
      type: 'ANIME',
      id: 'anilist:ANIME:1',
      metadata: { episodeCount: null, episodeDurationMinutes: null }
    };
    let fallbackCalls = 0;
    const service = createMediaDiscoveryService({
      myanimelistAdapter: { enabled: false },
      anilistAdapter: {
        enabled: true,
        async getTrending(options) {
          fallbackCalls += 1;
          assert.equal(options.provider, 'anilist');
          return { results: [anilistMedia], pagination: { page: 1, perPage: 12, hasMore: false } };
        }
      }
    });

    const result = await service.getTrending({
      provider: 'myanimelist',
      type: 'anime',
      page: 1,
      perPage: 12,
      includeAdult: true,
      allowFallback: true
    });
    assert.equal(result.source, 'anilist');
    assert.equal(fallbackCalls, 1);

    await assert.rejects(
      service.getTrending({ provider: 'myanimelist', type: 'anime', page: 1, perPage: 12, includeAdult: true }),
      { code: PROVIDER_ERROR_CODES.UNAVAILABLE }
    );
  });

  it('rejects malformed adapter pages as safe Provider invalid responses', async () => {
    const service = serviceWith({ enabled: true, async getPopular() { return { results: [{ raw: 'secret' }] }; } });
    await assert.rejects(
      service.getPopular({ provider: 'tmdb', type: 'movie', page: 1, perPage: 12, includeAdult: true }),
      { code: PROVIDER_ERROR_CODES.INVALID_RESPONSE }
    );
  });
});
