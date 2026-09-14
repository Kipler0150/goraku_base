import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync('client/src/styles.css', 'utf8');

describe('application scroll ownership', () => {
  it('keeps document scrolling disabled so the main content owns vertical scrolling', () => {
    expect(styles).toMatch(/html, body, #root \{[^}]*height: 100%;/);
    expect(styles).toMatch(/html, body \{[^}]*overflow: hidden;/);
    expect(styles).toMatch(/#main-content \{[^}]*overflow-y: auto;/);
  });
});
