import { describe, expect, it } from 'vitest';
import {
  applyDevDayOffset,
  applyCheckIn,
  canCheckIn,
  computeNextResetFromDayNumber,
  computeNextResetUTC,
  utcDayNumber,
  type UserState,
} from './streak';

const makeUserState = (overrides: Partial<UserState> = {}): UserState => ({
  joinedAt: '2026-02-15T00:00:00.000Z',
  privacy: 'public',
  currentStreak: 0,
  bestStreak: 0,
  streakStartDayUTC: null,
  lastCheckinDayUTC: null,
  ...overrides,
});

describe('streak helpers', () => {
  it('first ever check-in sets streak fields to day and streak=1', () => {
    const day = utcDayNumber(new Date('2026-02-15T10:00:00.000Z'));
    const state = makeUserState();

    const updated = applyCheckIn(state, day);

    expect(updated.currentStreak).toBe(1);
    expect(updated.bestStreak).toBe(1);
    expect(updated.lastCheckinDayUTC).toBe(day);
    expect(updated.streakStartDayUTC).toBe(day);
  });

  it('consecutive day check-in increments current streak', () => {
    const day1 = utcDayNumber(new Date('2026-02-15T10:00:00.000Z'));
    const day2 = day1 + 1;

    const state = makeUserState({
      currentStreak: 3,
      bestStreak: 5,
      streakStartDayUTC: day1 - 2,
      lastCheckinDayUTC: day1,
    });

    const updated = applyCheckIn(state, day2);

    expect(updated.currentStreak).toBe(4);
    expect(updated.bestStreak).toBe(5);
    expect(updated.streakStartDayUTC).toBe(day1 - 2);
    expect(updated.lastCheckinDayUTC).toBe(day2);
  });

  it('missed day resets current streak to 1 and sets streak start to today', () => {
    const day1 = utcDayNumber(new Date('2026-02-15T10:00:00.000Z'));
    const day3 = day1 + 2;

    const state = makeUserState({
      currentStreak: 7,
      bestStreak: 9,
      streakStartDayUTC: day1 - 6,
      lastCheckinDayUTC: day1,
    });

    const updated = applyCheckIn(state, day3);

    expect(updated.currentStreak).toBe(1);
    expect(updated.bestStreak).toBe(9);
    expect(updated.streakStartDayUTC).toBe(day3);
    expect(updated.lastCheckinDayUTC).toBe(day3);
  });

  it('same-day double-check-in is disallowed and does not increment streak', () => {
    const day = utcDayNumber(new Date('2026-02-15T10:00:00.000Z'));
    const state = makeUserState({
      currentStreak: 4,
      bestStreak: 6,
      streakStartDayUTC: day - 3,
      lastCheckinDayUTC: day,
    });

    expect(canCheckIn(state, day)).toBe(false);
    expect(() => applyCheckIn(state, day)).toThrow(
      'User has already checked in for this UTC day'
    );
  });

  it('computeNextResetUTC returns next 00:00 UTC timestamp', () => {
    const now = new Date('2026-02-15T23:59:30.000Z');
    const expected = new Date('2026-02-16T00:00:00.000Z').getTime();

    expect(computeNextResetUTC(now)).toBe(expected);
  });

  it('effective day offset allows multi-day playtest progression on same real day', () => {
    const realDay = utcDayNumber(new Date('2026-02-15T10:00:00.000Z'));
    const dayWithOffset0 = applyDevDayOffset(realDay, 0);
    const dayWithOffset1 = applyDevDayOffset(realDay, 1);

    const startState = makeUserState();
    const afterFirst = applyCheckIn(startState, dayWithOffset0);
    const afterSecond = applyCheckIn(afterFirst, dayWithOffset1);

    expect(afterFirst.currentStreak).toBe(1);
    expect(afterSecond.currentStreak).toBe(2);
    expect(afterSecond.lastCheckinDayUTC).toBe(realDay + 1);
  });

  it('computeNextResetFromDayNumber returns reset for effective day', () => {
    const effectiveDay = 20500;
    const expected = (effectiveDay + 1) * 86_400_000;
    expect(computeNextResetFromDayNumber(effectiveDay)).toBe(expected);
  });
});
