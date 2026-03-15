import { describe, expect, it } from 'vitest';
import { addCompetitionRanks } from './ranking';

describe('competition rank helper', () => {
  it('assigns tie-aware competition ranks', () => {
    const ranked = addCompetitionRanks([
      { userId: 'u1', currentStreak: 10 },
      { userId: 'u2', currentStreak: 10 },
      { userId: 'u3', currentStreak: 9 },
      { userId: 'u4', currentStreak: 7 },
      { userId: 'u5', currentStreak: 7 },
    ]);

    expect(ranked.map((row) => row.rank)).toEqual([1, 1, 3, 4, 4]);
  });
});
