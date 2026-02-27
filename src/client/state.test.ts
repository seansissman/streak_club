import { describe, expect, it } from 'vitest';

import {
  getCompetitionRankAtIndex,
  shouldEnableInlineCardExpand,
  shouldRenderCheckInButton,
  shouldShowInlineExpandLink,
} from './state';

describe('client check-in rendering state', () => {
  it('does not render check-in button when checkedInToday is true', () => {
    const me = {
      state: {
        lastCheckinDayUTC: 20500,
      },
      checkedInToday: true,
    };

    const result = shouldRenderCheckInButton(me, { effectiveDayNumber: 20500 });
    expect(result).toBe(false);
  });

  it('does not render check-in button when API marks effective day as non-checkin', () => {
    const me = {
      state: {
        lastCheckinDayUTC: 20500,
      },
      checkedInToday: false,
      canCheckInToday: false,
    };

    const result = shouldRenderCheckInButton(me, { effectiveDayNumber: 20490 });
    expect(result).toBe(false);
  });

  it('uses competition ranking when streaks tie (1,1,3)', () => {
    const rows = [
      { currentStreak: 10 },
      { currentStreak: 10 },
      { currentStreak: 9 },
      { currentStreak: 7 },
      { currentStreak: 7 },
      { currentStreak: 7 },
      { currentStreak: 6 },
    ];

    expect(rows.map((_, index) => getCompetitionRankAtIndex(rows, index))).toEqual([
      1, 1, 3, 4, 4, 4, 7,
    ]);
  });

  it('keeps rank stable within a tie group', () => {
    const rows = [
      { currentStreak: 5 },
      { currentStreak: 5 },
      { currentStreak: 5 },
    ];

    expect(rows.map((_, index) => getCompetitionRankAtIndex(rows, index))).toEqual([
      1, 1, 1,
    ]);
  });

  it('inline mode always has an expand trigger path available', () => {
    expect(shouldShowInlineExpandLink(true)).toBe(true);
    expect(shouldEnableInlineCardExpand(true)).toBe(true);
    expect(shouldShowInlineExpandLink(false)).toBe(false);
  });

});
