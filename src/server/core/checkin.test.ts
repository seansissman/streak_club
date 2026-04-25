import { describe, expect, it } from 'vitest';

import {
  canCheckInToday,
  checkedInToday,
  isEffectiveDayBeforeLatestCheckIn,
} from './checkin';

describe('check-in day guards', () => {
  it('allows users with no last check-in to check in', () => {
    expect(canCheckInToday(null, 20_500)).toBe(true);
    expect(canCheckInToday({ lastCheckinDayUTC: null }, 20_500)).toBe(true);
  });

  it('marks same-day check-ins as already completed', () => {
    const state = { lastCheckinDayUTC: 20_500 };

    expect(checkedInToday(state, 20_500)).toBe(true);
    expect(canCheckInToday(state, 20_500)).toBe(false);
  });

  it('guards against future last-check-in timestamps', () => {
    const state = { lastCheckinDayUTC: 20_502 };

    expect(isEffectiveDayBeforeLatestCheckIn(state, 20_500)).toBe(true);
    expect(canCheckInToday(state, 20_500)).toBe(false);
  });
});
