import { describe, expect, it } from 'vitest';
import {
  addCompetitionRanks,
  filterPublicRankRows,
  getCompetitionRankForUser,
} from './ranking';

describe('competition rank helper', () => {
  it('assigns normal ranks when streaks do not tie', () => {
    const ranked = addCompetitionRanks([
      { userId: 'u1', currentStreak: 12 },
      { userId: 'u2', currentStreak: 11 },
      { userId: 'u3', currentStreak: 10 },
    ]);

    expect(ranked.map((row) => row.rank)).toEqual([1, 2, 3]);
  });

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

  it('returns the same rank for a user as the ranked leaderboard rows', () => {
    const rows = [
      { userId: 'u1', currentStreak: 10 },
      { userId: 'u2', currentStreak: 10 },
      { userId: 'u3', currentStreak: 9 },
      { userId: 'u4', currentStreak: 7 },
    ];

    expect(getCompetitionRankForUser(rows, 'u1')).toBe(1);
    expect(getCompetitionRankForUser(rows, 'u2')).toBe(1);
    expect(getCompetitionRankForUser(rows, 'u3')).toBe(3);
    expect(getCompetitionRankForUser(rows, 'missing')).toBeNull();
  });

  it('excludes private users from public leaderboard ranking', () => {
    const ranked = addCompetitionRanks(
      filterPublicRankRows([
        { userId: 'u1', currentStreak: 10, privacy: 'public' as const },
        { userId: 'u2', currentStreak: 10, privacy: 'private' as const },
        { userId: 'u3', currentStreak: 9, privacy: 'public' as const },
      ])
    );

    expect(ranked.map((row) => row.userId)).toEqual(['u1', 'u3']);
    expect(ranked.map((row) => row.rank)).toEqual([1, 2]);
  });
});
