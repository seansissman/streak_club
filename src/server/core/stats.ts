export type AggregateStats = {
  lastStatsDay: number;
  participantsTotal: number;
  checkinsToday: number;
  checkinsAllTime: number;
  longestStreakAllTime: number;
};

export type AggregateStatsMutation = {
  incrementParticipants?: boolean;
  incrementCheckins?: boolean;
  bestStreakCandidate?: number;
};

export type CheckinStatsInput = {
  wasNewTodayCheckin: boolean;
  todaySetSize: number;
  bestStreakCandidate?: number;
};

const parseNonNegativeInt = (value: string | undefined, fallback = 0): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
};

export const createEmptyAggregateStats = (todayDay: number): AggregateStats => ({
  lastStatsDay: todayDay,
  participantsTotal: 0,
  checkinsToday: 0,
  checkinsAllTime: 0,
  longestStreakAllTime: 0,
});

export const normalizeAggregateStatsDay = (
  stats: AggregateStats,
  todayDay: number
): AggregateStats => {
  if (stats.lastStatsDay === todayDay) {
    return stats;
  }

  return {
    ...stats,
    lastStatsDay: todayDay,
    checkinsToday: 0,
  };
};

export const applyAggregateStatsMutation = (
  stats: AggregateStats,
  todayDay: number,
  mutation: AggregateStatsMutation
): AggregateStats => {
  const normalized = normalizeAggregateStatsDay(stats, todayDay);
  let next: AggregateStats = normalized;

  if (mutation.incrementParticipants) {
    next = {
      ...next,
      participantsTotal: next.participantsTotal + 1,
    };
  }

  if (mutation.incrementCheckins) {
    next = {
      ...next,
      checkinsToday: next.checkinsToday + 1,
      checkinsAllTime: next.checkinsAllTime + 1,
    };
  }

  if (
    mutation.bestStreakCandidate !== undefined &&
    mutation.bestStreakCandidate > next.longestStreakAllTime
  ) {
    next = {
      ...next,
      longestStreakAllTime: mutation.bestStreakCandidate,
    };
  }

  return next;
};

export const applyCheckinStatsUpdate = (
  stats: AggregateStats,
  todayDay: number,
  input: CheckinStatsInput
): AggregateStats => {
  const mutated = applyAggregateStatsMutation(stats, todayDay, {
    incrementCheckins: input.wasNewTodayCheckin,
    bestStreakCandidate: input.bestStreakCandidate,
  });

  return {
    ...mutated,
    checkinsToday: Math.max(0, input.todaySetSize),
  };
};

export const parseAggregateStatsRecord = (
  data: Record<string, string>,
  todayDay: number
): AggregateStats => {
  if (Object.keys(data).length === 0) {
    return createEmptyAggregateStats(todayDay);
  }

  const rawStats: AggregateStats = {
    lastStatsDay: parseNonNegativeInt(data.lastStatsDay, todayDay),
    participantsTotal: parseNonNegativeInt(
      data.participantsTotal ?? data.participantsCount
    ),
    checkinsToday: parseNonNegativeInt(
      data.checkinsToday ?? data[`checkins:${String(todayDay)}`]
    ),
    checkinsAllTime: parseNonNegativeInt(data.checkinsAllTime),
    longestStreakAllTime: parseNonNegativeInt(data.longestStreakAllTime),
  };

  return normalizeAggregateStatsDay(rawStats, todayDay);
};

export const serializeAggregateStatsRecord = (
  stats: AggregateStats
): Record<string, string> => ({
  lastStatsDay: String(stats.lastStatsDay),
  participantsTotal: String(stats.participantsTotal),
  checkinsToday: String(stats.checkinsToday),
  checkinsAllTime: String(stats.checkinsAllTime),
  longestStreakAllTime: String(stats.longestStreakAllTime),
});
