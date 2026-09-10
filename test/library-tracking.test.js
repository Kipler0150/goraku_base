import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_USER_OWNED_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  normalizeNote,
  normalizePersonalRating,
  normalizeUserOwnedName,
  validateProgress
} from '../server/library.js';

describe('Library tracking domain values', () => {
  it('trims Tag and Collection names while retaining display and normalized forms', () => {
    assert.deepEqual(normalizeUserOwnedName('  Weekend Queue  '), {
      name: 'Weekend Queue',
      normalizedName: 'weekend queue'
    });
  });

  it('rejects blank, oversized, and non-text Tag or Collection names', () => {
    for (const value of ['', '   ', '😀'.repeat(MAX_USER_OWNED_NAME_LENGTH + 1), 42, null]) {
      assert.throws(() => normalizeUserOwnedName(value), { code: 'VALIDATION_ERROR' });
    }
  });

  it('accepts nullable Personal Ratings from 0 to 10 in half-point increments', () => {
    for (const value of [0, 0.5, 1, 9.5, 10, null]) {
      assert.equal(normalizePersonalRating(value), value);
    }
  });

  it('rejects invalid Personal Ratings', () => {
    for (const value of [-0.5, 0.1, 9.9, 10.5, '5', true, Infinity, NaN]) {
      assert.throws(() => normalizePersonalRating(value), { code: 'VALIDATION_ERROR' });
    }
  });

  it('preserves Notes, allows line breaks, and clears empty or null values', () => {
    const prefix = 'first line\nsecond line ';
    const note = prefix + '😀'.repeat(MAX_NOTE_LENGTH - [...prefix].length);
    assert.equal([...note].length, MAX_NOTE_LENGTH);
    assert.equal(normalizeNote(note), note);
    assert.equal(normalizeNote(''), null);
    assert.equal(normalizeNote(null), null);
  });

  it('rejects Notes longer than the Unicode-character limit or non-text values', () => {
    assert.throws(() => normalizeNote('😀'.repeat(MAX_NOTE_LENGTH + 1)), { code: 'VALIDATION_ERROR' });
    assert.throws(() => normalizeNote('a'.repeat(MAX_NOTE_LENGTH + 1)), { code: 'VALIDATION_ERROR' });
    assert.throws(() => normalizeNote(false), { code: 'VALIDATION_ERROR' });
  });

  it('accepts every supported typed Progress value, including zero and false', () => {
    assert.deepEqual(validateProgress('ANIME', { episodesWatched: 0 }), { episodesWatched: 0 });
    assert.deepEqual(validateProgress('TV', { season: 0, episode: 1 }), { season: 0, episode: 1 });
    assert.deepEqual(validateProgress('MOVIE', { watched: false }), { watched: false });
    assert.deepEqual(validateProgress('GAME', { hoursPlayed: 0 }), { hoursPlayed: 0 });
    assert.deepEqual(validateProgress('GAME', { hoursPlayed: 12.34 }), { hoursPlayed: 12.34 });
    assert.equal(validateProgress('ANIME', null), null);
  });

  it('rejects wrong-type, incomplete, unknown-key, and invalid Progress values', () => {
    const invalidValues = [
      ['ANIME', {}],
      ['ANIME', { episodesWatched: 1, extra: true }],
      ['ANIME', { episodesWatched: 1.5 }],
      ['ANIME', { episodesWatched: -1 }],
      ['TV', { season: -1, episode: 1 }],
      ['TV', { season: 1, episode: 0 }],
      ['TV', { season: 1.5, episode: 1 }],
      ['TV', { season: 1, episode: 1, extra: true }],
      ['MOVIE', { watched: 0 }],
      ['MOVIE', { watched: false, extra: true }],
      ['GAME', { hoursPlayed: -1 }],
      ['GAME', { hoursPlayed: 1.001 }],
      ['GAME', { hoursPlayed: '1.25' }],
      ['MANGA', { chaptersRead: 1 }],
      ['COMIC', { chaptersRead: 1 }]
    ];

    for (const [type, value] of invalidValues) {
      assert.throws(() => validateProgress(type, value), { code: 'VALIDATION_ERROR' });
    }
  });
});
