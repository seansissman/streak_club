import { describe, expect, it } from 'vitest';
import {
  applyAggregateStatsMutation,
  applyCheckinStatsUpdate,
  createEmptyAggregateStats,
  normalizeAggregateStatsDay,
} from './stats';

describe('aggregate stats helpers', () => {
  it('join increments participants only once per user', () => {
    const day = 20500;
    const initial = createEmptyAggregateStats(day);

    const afterFirstJoin = applyAggregateStatsMutation(initial, day, {
      incrementParticipants: true,
    });
    const afterSecondJoinAttempt = applyAggregateStatsMutation(afterFirstJoin, day, {});

    expect(afterFirstJoin.participantsTotal).toBe(1);
    expect(afterSecondJoinAttempt.participantsTotal).toBe(1);
  });

  it('today-set prevents double count for same user/day', () => {
    const day = 20500;
    const initial = createEmptyAggregateStats(day);

    const afterFirstAccepted = applyCheckinStatsUpdate(initial, day, {
      wasNewTodayCheckin: true,
      todaySetSize: 1,
    });
    const afterDuplicateAttempt = applyCheckinStatsUpdate(
      afterFirstAccepted,
      day,
      {
        wasNewTodayCheckin: false,
        todaySetSize: 1,
      }
    );

    expect(afterFirstAccepted.checkinsToday).toBe(1);
    expect(afterFirstAccepted.checkinsAllTime).toBe(1);
    expect(afterDuplicateAttempt.checkinsToday).toBe(1);
    expect(afterDuplicateAttempt.checkinsAllTime).toBe(1);
  });

  it('two different users produce checkinsToday=2', () => {
    const day = 20500;
    const initial = createEmptyAggregateStats(day);
    const afterUserA = applyCheckinStatsUpdate(initial, day, {
      wasNewTodayCheckin: true,
      todaySetSize: 1,
    });
    const afterUserB = applyCheckinStatsUpdate(afterUserA, day, {
      wasNewTodayCheckin: true,
      todaySetSize: 2,
    });

    expect(afterUserB.checkinsToday).toBe(2);
    expect(afterUserB.checkinsAllTime).toBe(2);
  });

  it('day rollover resets checkinsToday', () => {
    const day = 20500;
    const beforeRollover = {
      ...createEmptyAggregateStats(day),
      checkinsToday: 7,
      checkinsAllTime: 42,
    };

    const afterRollover = normalizeAggregateStatsDay(beforeRollover, day + 1);

    expect(afterRollover.lastStatsDay).toBe(day + 1);
    expect(afterRollover.checkinsToday).toBe(0);
    expect(afterRollover.checkinsAllTime).toBe(42);
  });

  it('longestStreakAllTime updates when a higher best streak is reached', () => {
    const day = 20500;
    const initial = createEmptyAggregateStats(day);
    const withLongerStreak = applyAggregateStatsMutation(initial, day, {
      bestStreakCandidate: 12,
    });
    const withLowerStreak = applyAggregateStatsMutation(withLongerStreak, day, {
      bestStreakCandidate: 10,
    });

    expect(withLongerStreak.longestStreakAllTime).toBe(12);
    expect(withLowerStreak.longestStreakAllTime).toBe(12);
  });

  it('freeze-save check-in still increments counters exactly once', () => {
    const day = 20500;
    const initial = createEmptyAggregateStats(day);

    const afterFreezeSavedCheckIn = applyCheckinStatsUpdate(initial, day, {
      wasNewTodayCheckin: true,
      todaySetSize: 1,
      bestStreakCandidate: 7,
    });
    const afterDuplicateAttempt = applyCheckinStatsUpdate(
      afterFreezeSavedCheckIn,
      day,
      {
        wasNewTodayCheckin: false,
        todaySetSize: 1,
      }
    );

    expect(afterFreezeSavedCheckIn.checkinsToday).toBe(1);
    expect(afterFreezeSavedCheckIn.checkinsAllTime).toBe(1);
    expect(afterFreezeSavedCheckIn.longestStreakAllTime).toBe(7);
    expect(afterDuplicateAttempt.checkinsToday).toBe(1);
    expect(afterDuplicateAttempt.checkinsAllTime).toBe(1);
  });

  it('new UTC day uses a new today-set while preserving all-time totals', () => {
    const day = 20500;
    const initial = createEmptyAggregateStats(day);
    const dayOne = applyCheckinStatsUpdate(initial, day, {
      wasNewTodayCheckin: true,
      todaySetSize: 1,
    });
    const dayTwo = applyCheckinStatsUpdate(dayOne, day + 1, {
      wasNewTodayCheckin: true,
      todaySetSize: 1,
    });

    expect(dayTwo.lastStatsDay).toBe(day + 1);
    expect(dayTwo.checkinsToday).toBe(1);
    expect(dayTwo.checkinsAllTime).toBe(2);
  });
});
