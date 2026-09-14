import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const viteConfig = readFileSync('client/vite.config.js', 'utf8');

describe('local client server configuration', () => {
  it('fails fast instead of moving to an Origin the API rejects', () => {
    expect(viteConfig).toMatch(/port:\s*5173/);
    expect(viteConfig).toMatch(/strictPort:\s*true/);
  });
});
