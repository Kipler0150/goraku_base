import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createMedia,
  createStableMediaId,
  normalizeProviderRating,
  validateMedia
} from '../shared/media.js';

describe('shared Media contract', () => {
  it('normalizes provider ratings while preserving their source scale', () => {
    assert.deepEqual(normalizeProviderRating({ value: 87, max: 100 }), {
      value: 87,
      max: 100,
      normalized: 8.7
    });
    assert.deepEqual(normalizeProviderRating({ value: 4, max: 5 }), {
      value: 4,
      max: 5,
      normalized: 8
    });
    assert.deepEqual(normalizeProviderRating({ value: 0, max: 5 }), {
      value: 0,
      max: 5,
      normalized: 0
    });
    assert.equal(normalizeProviderRating(null), null);
  });

  it('rejects invalid rating scales and values', () => {
    assert.throws(() => normalizeProviderRating({ value: 101, max: 100 }), /between 0 and max/);
    assert.throws(() => normalizeProviderRating({ value: 1, max: 0 }), /positive finite maximum/);
    assert.throws(() => normalizeProviderRating({ value: Number.NaN, max: 10 }), /finite/);
  });

  it('keeps provider and media type in the stable identity', () => {
    const animeId = createStableMediaId('anilist', 'ANIME', '42');
    assert.notEqual(animeId, createStableMediaId('tmdb', 'ANIME', '42'));
    assert.notEqual(animeId, createStableMediaId('anilist', 'MOVIE', '42'));
    assert.notEqual(animeId, createStableMediaId('anilist', 'ANIME', '4:2'));
  });

  it('preserves partial dates and rejects impossible calendar dates', () => {
    const media = createMedia({
      provider: 'synthetic',
      providerId: 'anime-1',
      type: 'ANIME',
      releaseDate: { year: 2024, month: 2 }
    });

    assert.deepEqual(media.releaseDate, { year: 2024, month: 2, day: null });
    assert.throws(() => createMedia({
      provider: 'synthetic',
      providerId: 'movie-1',
      type: 'MOVIE',
      releaseDate: { year: 2023, month: 2, day: 29 }
    }), /valid calendar date/);
    assert.throws(() => createMedia({
      provider: 'synthetic',
      providerId: 'movie-2',
      type: 'MOVIE',
      releaseDate: { year: 2024, day: 4 }
    }), /month is required/);
  });

  it('uses explicit unknown defaults and retains typed metadata', () => {
    const media = createMedia({
      provider: 'synthetic',
      providerId: 'game-1',
      type: 'GAME',
      metadata: {
        platforms: ['PC'],
        developers: ['Example Studio'],
        publishers: ['Example Works']
      },
      unsupportedField: 'ignored'
    });

    assert.equal(media.title, null);
    assert.deepEqual(media.genres, []);
    assert.equal(media.providerRating, null);
    assert.equal(media.releaseStatus, 'UNKNOWN');
    assert.deepEqual(media.metadata, {
      platforms: ['PC'],
      developers: ['Example Studio'],
      publishers: ['Example Works']
    });
    assert.equal('unsupportedField' in media, false);
  });

  it('reports invalid public Media input without constructing a value', () => {
    const result = validateMedia({ provider: 'synthetic', providerId: '', type: 'PODCAST' });

    assert.equal(result.valid, false);
    assert.deepEqual(result.errors, [
      'providerId must be a non-empty string.',
      'type must be one of ANIME, MANGA, MOVIE, TV, GAME, or COMIC.'
    ]);
  });

  it('validates the rest of the public contract', () => {
    const result = validateMedia({
      provider: 'synthetic',
      providerId: 'movie-1',
      type: 'MOVIE',
      releaseDate: { year: 2023, month: 2, day: 29 }
    });

    assert.equal(result.valid, false);
    assert.equal(result.errors[0], 'releaseDate must be a valid calendar date.');
  });
});
