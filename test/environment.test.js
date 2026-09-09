import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { loadLocalEnvironment } from '../server/environment.js';

describe('local environment loading', () => {
  it('loads a local environment file without overwriting an existing value', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'goraku-env-'));
    const filePath = join(directory, '.env.local');
    const key = 'GORAKU_TEST_LOCAL_ENV_VALUE';
    const originalValue = process.env[key];

    try {
      process.env[key] = 'from-shell';
      await writeFile(filePath, `${key}=from-file\n`);

      loadLocalEnvironment(filePath);

      assert.equal(process.env[key], 'from-shell');
    } finally {
      if (originalValue === undefined) delete process.env[key];
      else process.env[key] = originalValue;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not fail when the local environment file is absent', () => {
    assert.doesNotThrow(() => loadLocalEnvironment(join(tmpdir(), 'goraku-env-missing', '.env.local')));
  });

  it('documents blank server-only TMDB configuration in both environment examples', async () => {
    const examples = await Promise.all([
      readFile('.env.example', 'utf8'),
      readFile('server/.env.example', 'utf8'),
      readFile('client/.env.example', 'utf8')
    ]);

    for (const example of examples.slice(0, 2)) {
      assert.match(example, /^# TMDB_ACCESS_TOKEN=$/m);
      assert.match(example, /^# TMDB_IMAGE_BASE_URL=https:\/\/image\.tmdb\.org\/t\/p$/m);
    }
    assert.doesNotMatch(examples[2], /TMDB_ACCESS_TOKEN|TMDB_IMAGE_BASE_URL/);
  });

  it('documents blank server-only RAWG configuration without exposing it to the client', async () => {
    const examples = await Promise.all([
      readFile('.env.example', 'utf8'),
      readFile('server/.env.example', 'utf8'),
      readFile('client/.env.example', 'utf8'),
      readFile('client/src/App.jsx', 'utf8'),
      readFile('client/src/api/mediaSearch.js', 'utf8')
    ]);

    for (const example of examples.slice(0, 2)) {
      assert.match(example, /^# RAWG_API_KEY=$/m);
      assert.doesNotMatch(example, /^(?!\s*#)\s*RAWG_API_KEY=/m);
    }
    for (const clientFile of examples.slice(2)) {
      assert.doesNotMatch(clientFile, /RAWG_API_KEY/);
    }
  });
});
