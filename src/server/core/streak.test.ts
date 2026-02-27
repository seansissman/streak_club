import { describe, expect, it } from 'vitest';
import {
  applyDevDayOffset,
  applyCheckIn,
  applyCheckInWithMetadata,
  canCheckIn,
  compareLeaderboardEntries,
  computeNextResetFromDayNumber,
  computeNextResetUTC,
  getUtcNowFromBaseMs,
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
  freezeTokens: 0,
  freezeSaves: 0,
  badges: [],
  isParticipant: true,
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

  it('missed one UTC day without token resets current streak to 1 and sets streak start to today', () => {
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

  it('earns freeze tokens at multiples of 7 and caps at 2', () => {
    const day1 = utcDayNumber(new Date('2026-02-15T10:00:00.000Z'));

    const reaches7 = applyCheckInWithMetadata(
      makeUserState({
        currentStreak: 6,
        bestStreak: 6,
        streakStartDayUTC: day1 - 6,
        lastCheckinDayUTC: day1 - 1,
        freezeTokens: 0,
      }),
      day1
    );
    expect(reaches7.state.currentStreak).toBe(7);
    expect(reaches7.state.freezeTokens).toBe(1);
    expect(reaches7.metadata.earnedFreeze).toBe(true);
    expect(reaches7.metadata.tokenCount).toBe(1);

    const reaches14 = applyCheckInWithMetadata(
      makeUserState({
        currentStreak: 13,
        bestStreak: 13,
        streakStartDayUTC: day1 - 13,
        lastCheckinDayUTC: day1 - 1,
        freezeTokens: 1,
      }),
      day1
    );
    expect(reaches14.state.currentStreak).toBe(14);
    expect(reaches14.state.freezeTokens).toBe(2);
    expect(reaches14.metadata.earnedFreeze).toBe(true);

    const reaches21AtCap = applyCheckInWithMetadata(
      makeUserState({
        currentStreak: 20,
        bestStreak: 20,
        streakStartDayUTC: day1 - 20,
        lastCheckinDayUTC: day1 - 1,
        freezeTokens: 2,
      }),
      day1
    );
    expect(reaches21AtCap.state.currentStreak).toBe(21);
    expect(reaches21AtCap.state.freezeTokens).toBe(2);
    expect(reaches21AtCap.metadata.earnedFreeze).toBe(false);
  });

  it('missed one UTC day with token consumes token and continues streak', () => {
    const day1 = utcDayNumber(new Date('2026-02-15T10:00:00.000Z'));
    const day3 = day1 + 2;

    const result = applyCheckInWithMetadata(
      makeUserState({
        currentStreak: 5,
        bestStreak: 6,
        streakStartDayUTC: day1 - 4,
        lastCheckinDayUTC: day1,
        freezeTokens: 1,
        freezeSaves: 2,
      }),
      day3
    );

    expect(result.state.currentStreak).toBe(6);
    expect(result.state.bestStreak).toBe(6);
    expect(result.state.streakStartDayUTC).toBe(day1 - 4);
    expect(result.state.lastCheckinDayUTC).toBe(day3);
    expect(result.state.freezeTokens).toBe(0);
    expect(result.state.freezeSaves).toBe(3);
    expect(result.metadata.usedFreeze).toBe(true);
    expect(result.metadata.tokenCount).toBe(0);
  });

  it('missed one UTC day without token resets streak', () => {
    const day1 = utcDayNumber(new Date('2026-02-15T10:00:00.000Z'));
    const day3 = day1 + 2;

    const result = applyCheckInWithMetadata(
      makeUserState({
        currentStreak: 8,
        bestStreak: 12,
        streakStartDayUTC: day1 - 7,
        lastCheckinDayUTC: day1,
        freezeTokens: 0,
      }),
      day3
    );

    expect(result.state.currentStreak).toBe(1);
    expect(result.state.bestStreak).toBe(12);
    expect(result.state.streakStartDayUTC).toBe(day3);
    expect(result.state.freezeTokens).toBe(0);
    expect(result.metadata.usedFreeze).toBe(false);
  });

  it('missed 2+ UTC days resets streak and does not consume token', () => {
    const day1 = utcDayNumber(new Date('2026-02-15T10:00:00.000Z'));
    const day4 = day1 + 3;

    const result = applyCheckInWithMetadata(
      makeUserState({
        currentStreak: 8,
        bestStreak: 12,
        streakStartDayUTC: day1 - 7,
        lastCheckinDayUTC: day1,
        freezeTokens: 2,
        freezeSaves: 4,
      }),
      day4
    );

    expect(result.state.currentStreak).toBe(1);
    expect(result.state.bestStreak).toBe(12);
    expect(result.state.streakStartDayUTC).toBe(day4);
    expect(result.state.freezeTokens).toBe(2);
    expect(result.state.freezeSaves).toBe(4);
    expect(result.metadata.usedFreeze).toBe(false);
  });

  it('awards Committed badge at 7-day streak', () => {
    const day = utcDayNumber(new Date('2026-02-15T10:00:00.000Z'));
    const result = applyCheckInWithMetadata(
      makeUserState({
        currentStreak: 6,
        bestStreak: 6,
        streakStartDayUTC: day - 6,
        lastCheckinDayUTC: day - 1,
      }),
      day
    );

    expect(result.state.currentStreak).toBe(7);
    expect(result.state.badges).toEqual(['Committed']);
    expect(result.metadata.earnedBadge).toBe('Committed');
  });

  it('awards Consistent badge at 30-day streak', () => {
    const day = utcDayNumber(new Date('2026-02-15T10:00:00.000Z'));
    const result = applyCheckInWithMetadata(
      makeUserState({
        currentStreak: 29,
        bestStreak: 29,
        streakStartDayUTC: day - 29,
        lastCheckinDayUTC: day - 1,
        badges: ['Committed'],
      }),
      day
    );

    expect(result.state.currentStreak).toBe(30);
    expect(result.state.badges).toEqual(['Committed', 'Consistent']);
    expect(result.metadata.earnedBadge).toBe('Consistent');
  });

  it('does not duplicate an already earned badge', () => {
    const day = utcDayNumber(new Date('2026-02-15T10:00:00.000Z'));
    const result = applyCheckInWithMetadata(
      makeUserState({
        currentStreak: 7,
        bestStreak: 7,
        streakStartDayUTC: day - 7,
        lastCheckinDayUTC: day - 1,
        badges: ['Committed'],
      }),
      day
    );

    expect(result.state.currentStreak).toBe(8);
    expect(result.state.badges).toEqual(['Committed']);
    expect(result.metadata.earnedBadge).toBeNull();
  });

  it('accumulates multiple badges over time', () => {
    const day = utcDayNumber(new Date('2026-02-15T10:00:00.000Z'));
    const thirty = applyCheckInWithMetadata(
      makeUserState({
        currentStreak: 29,
        bestStreak: 29,
        streakStartDayUTC: day - 29,
        lastCheckinDayUTC: day - 1,
        badges: ['Committed'],
      }),
      day
    );
    expect(thirty.state.badges).toEqual(['Committed', 'Consistent']);

    const ninety = applyCheckInWithMetadata(
      makeUserState({
        currentStreak: 89,
        bestStreak: 89,
        streakStartDayUTC: day - 89,
        lastCheckinDayUTC: day - 1,
        badges: thirty.state.badges,
      }),
      day
    );

    expect(ninety.state.badges).toEqual([
      'Committed',
      'Consistent',
      'Disciplined',
    ]);
    expect(ninety.metadata.earnedBadge).toBe('Disciplined');
  });

  it('freeze save does not interfere with badge awarding', () => {
    const day1 = utcDayNumber(new Date('2026-02-15T10:00:00.000Z'));
    const day3 = day1 + 2;
    const result = applyCheckInWithMetadata(
      makeUserState({
        currentStreak: 6,
        bestStreak: 6,
        streakStartDayUTC: day1 - 5,
        lastCheckinDayUTC: day1,
        freezeTokens: 1,
      }),
      day3
    );

    expect(result.metadata.usedFreeze).toBe(true);
    expect(result.state.currentStreak).toBe(7);
    expect(result.state.badges).toEqual(['Committed']);
    expect(result.metadata.earnedBadge).toBe('Committed');
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

  it('getUtcNowFromBaseMs handles boundary crossover without off-by-one', () => {
    const beforeMidnight = Date.parse('2026-02-15T23:59:30.000Z');
    const before = getUtcNowFromBaseMs(beforeMidnight, 0);
    const after = getUtcNowFromBaseMs(beforeMidnight, 40);

    expect(before.utcDayNumber).toBe(utcDayNumber(new Date('2026-02-15T00:00:00.000Z')));
    expect(before.secondsUntilReset).toBe(30);
    expect(after.utcDayNumber).toBe(before.utcDayNumber + 1);
    expect(after.secondsUntilReset).toBe(86_390);
  });

  it('sorts leaderboard ties deterministically by best streak, achieved day, then userId', () => {
    const entries = [
      {
        userId: 'u_c',
        currentStreak: 10,
        bestStreak: 20,
        streakAchievedDayUTC: 100,
        streakStartDayUTC: 90,
        lastCheckinDayUTC: 100,
      },
      {
        userId: 'u_b',
        currentStreak: 10,
        bestStreak: 22,
        streakAchievedDayUTC: 101,
        streakStartDayUTC: 91,
        lastCheckinDayUTC: 101,
      },
      {
        userId: 'u_a',
        currentStreak: 10,
        bestStreak: 22,
        streakAchievedDayUTC: 99,
        streakStartDayUTC: 89,
        lastCheckinDayUTC: 99,
      },
      {
        userId: 'u_d',
        currentStreak: 10,
        bestStreak: 22,
        streakAchievedDayUTC: 99,
        streakStartDayUTC: 89,
        lastCheckinDayUTC: 99,
      },
      {
        userId: 'u_e',
        currentStreak: 9,
        bestStreak: 99,
        streakAchievedDayUTC: 50,
        streakStartDayUTC: 41,
        lastCheckinDayUTC: 50,
      },
    ];

    const sorted = [...entries].sort(compareLeaderboardEntries);

    expect(sorted.map((entry) => entry.userId)).toEqual([
      'u_a',
      'u_d',
      'u_b',
      'u_c',
      'u_e',
    ]);
  });
});
