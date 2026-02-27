import { describe, expect, it } from 'vitest';

import { normalizeUsername, parseDevUsernames } from './access';

describe('access allowlist helpers', () => {
  it('normalizes usernames by trimming, lowercasing, and stripping optional u/ prefix', () => {
    expect(normalizeUsername(' SacPistachian ')).toBe('sacpistachian');
    expect(normalizeUsername('u/SacPistachian')).toBe('sacpistachian');
    expect(normalizeUsername('U/AnotherUser')).toBe('anotheruser');
  });

  it('parses comma-separated allowlist values and removes blanks', () => {
    const parsed = parseDevUsernames(' SacPistachian, u/DevUser, , DEVUSER ');

    expect(Array.from(parsed).sort()).toEqual(['devuser', 'sacpistachian']);
  });

  it('returns empty set for missing allowlist', () => {
    expect(parseDevUsernames(undefined).size).toBe(0);
  });
});
