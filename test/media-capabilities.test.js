import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MEDIA_OPERATIONS,
  PROVIDER_CAPABILITY_MATRIX,
  getProviderCapabilities,
  getProvidersForType,
  supportsProviderCapability
} from '../server/media-capabilities.js';

describe('provider capability matrix', () => {
  it('declares every operation for each supported provider and media type', () => {
    assert.deepEqual(MEDIA_OPERATIONS, [
      'search',
      'details',
      'trending',
      'popular',
      'latest',
      'recommendations'
    ]);

    const expected = {
      anilist: { anime: { search: true, details: true, trending: true, popular: true, latest: true, recommendations: true } },
      myanimelist: { anime: { search: true, details: true, trending: false, popular: true, latest: false, recommendations: true } },
      tmdb: {
        movie: { search: true, details: true, trending: true, popular: true, latest: true, recommendations: true },
        tv: { search: true, details: true, trending: true, popular: true, latest: true, recommendations: true }
      },
      thegamesdb: { game: { search: true, details: true, trending: false, popular: false, latest: false, recommendations: false } },
      rawg: { game: { search: true, details: true, trending: false, popular: true, latest: true, recommendations: true } }
    };

    assert.deepEqual(PROVIDER_CAPABILITY_MATRIX, expected);
  });

  it('distinguishes supported, unsupported, and incompatible capability lookups', () => {
    assert.deepEqual(getProviderCapabilities('tmdb', 'movie'), {
      search: true,
      details: true,
      trending: true,
      popular: true,
      latest: true,
      recommendations: true
    });
    assert.equal(supportsProviderCapability('tmdb', 'movie', 'details'), true);
    assert.equal(supportsProviderCapability('tmdb', 'movie', 'trending'), true);
    assert.equal(supportsProviderCapability('anilist', 'movie', 'details'), false);
    assert.equal(supportsProviderCapability('unknown', 'anime', 'details'), false);
    assert.equal(supportsProviderCapability('tmdb', 'movie', 'unknown'), false);
    assert.deepEqual(getProvidersForType('anime', 'search'), ['anilist', 'myanimelist']);
    assert.deepEqual(getProvidersForType('movie', 'details'), ['tmdb']);
    assert.deepEqual(getProvidersForType('game', 'trending'), []);
  });
});
