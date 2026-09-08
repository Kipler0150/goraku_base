import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';

describe('synthetic Media examples command', () => {
  it('prints all four initial integration examples as JSON', () => {
    const output = execFileSync(process.execPath, ['scripts/inspect-examples.js'], {
      cwd: process.cwd(),
      encoding: 'utf8'
    });
    const examples = JSON.parse(output);

    assert.deepEqual(Object.keys(examples), ['anime', 'movie', 'tv', 'game']);
    assert.equal(examples.anime.type, 'ANIME');
    assert.equal(examples.movie.type, 'MOVIE');
    assert.equal(examples.tv.type, 'TV');
    assert.equal(examples.game.type, 'GAME');
    assert.equal(examples.anime.providerRating.normalized, 8.7);
    assert.equal(examples.movie.providerRating.normalized, 8);
    assert.equal(examples.tv.metadata.seasonCount, null);
  });
});
