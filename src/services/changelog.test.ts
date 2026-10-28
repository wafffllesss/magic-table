import { describe, expect, it } from 'vitest';
import { changelogs, changelogVersions, compareVersions, parseChangelog, shouldShowChangelog } from './changelog';
describe('changelog', () => {
  it('includes both languages and sorts numeric versions', () => {
    expect(changelogs['0.0.6'].en).toContain('# Features');
    expect(changelogs['0.0.6']['pt-BR']).toContain('# Fixes and adjustments');
    expect(compareVersions('0.0.10', '0.0.9')).toBeGreaterThan(0);
    expect(changelogVersions.length).toBeLessThanOrEqual(10);
  });
  it('shows notes once for each available version', () => {
    expect(shouldShowChangelog('0.0.6', undefined, changelogs)).toBe(true);
    expect(shouldShowChangelog('0.0.6', '0.0.5', changelogs)).toBe(true);
    expect(shouldShowChangelog('0.0.6', '0.0.6', changelogs)).toBe(false);
    expect(shouldShowChangelog('0.0.7', '0.0.6', {})).toBe(false);
  });
  it('keeps untrusted markup as plain text', () => {
    expect(parseChangelog('# Features\n- <img src=x onerror=alert(1)>')).toEqual([
      { type: 'heading', text: 'Features' }, { type: 'item', text: '<img src=x onerror=alert(1)>' },
    ]);
  });
});
