const MILLIS_PER_DAY = 86_400_000;

export type DevTimeOffsetView = {
  devTimeOffsetSeconds: number;
};

export type DisplayUserState = {
  currentStreak: number;
  lastCheckinDayUTC: number | null;
  freezeTokens: number;
};

export type DerivedStreakStatus = 'active' | 'at-risk' | 'inactive';

export type DerivedStreakDisplay = {
  status: DerivedStreakStatus;
  activeStreakDays: number;
  storedStreakDays: number;
  dayGap: number | null;
  note: string;
};

export const formatDurationHms = (durationMs: number): string => {
  const diffMs = Math.max(durationMs, 0);
  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600)
    .toString()
    .padStart(2, '0');
  const minutes = Math.floor((totalSeconds % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');

  return `${hours}:${minutes}:${seconds}`;
};

export const formatDays = (n: number): string => (n === 1 ? '1 day' : `${n} days`);

export const formatLastCheckinDateTimeUtc = (day: number | null): string => {
  if (day === null) {
    return 'Never';
  }

  const iso = new Date(day * MILLIS_PER_DAY).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
};

export const getEffectiveNowMs = (
  nowMs: number,
  devTime: DevTimeOffsetView | null
): number => nowMs + (devTime?.devTimeOffsetSeconds ?? 0) * 1000;

export const getMsUntilNextUtcMidnight = (effectiveNowMs: number): number => {
  const nextResetMs =
    (Math.floor(effectiveNowMs / MILLIS_PER_DAY) + 1) * MILLIS_PER_DAY;
  return Math.max(0, nextResetMs - effectiveNowMs);
};

export const getMsUntilNextCheckinDue = (
  state: DisplayUserState | null,
  effectiveNowMs: number
): number | null => {
  if (!state || state.lastCheckinDayUTC === null || state.currentStreak <= 0) {
    return null;
  }

  const preservableGapDays = state.freezeTokens > 0 ? 2 : 1;
  const dueAtMidnightDay = state.lastCheckinDayUTC + preservableGapDays + 1;
  const dueAtMs = dueAtMidnightDay * MILLIS_PER_DAY;
  return Math.max(0, dueAtMs - effectiveNowMs);
};

export const deriveStreakDisplay = (
  state: DisplayUserState | null,
  effectiveDayNumber: number | null
): DerivedStreakDisplay | null => {
  if (!state) {
    return null;
  }

  const storedStreakDays = Math.max(0, state.currentStreak);
  if (state.lastCheckinDayUTC === null || storedStreakDays === 0) {
    return {
      status: 'inactive',
      activeStreakDays: 0,
      storedStreakDays,
      dayGap: null,
      note: 'No active streak yet.',
    };
  }

  if (effectiveDayNumber === null) {
    return {
      status: 'active',
      activeStreakDays: storedStreakDays,
      storedStreakDays,
      dayGap: null,
      note: 'Streak status is based on your latest successful check-in.',
    };
  }

  const dayGap = effectiveDayNumber - state.lastCheckinDayUTC;
  if (dayGap <= 0) {
    return {
      status: 'active',
      activeStreakDays: storedStreakDays,
      storedStreakDays,
      dayGap,
      note: 'Checked in for the current UTC day.',
    };
  }

  if (dayGap === 1) {
    return {
      status: 'at-risk',
      activeStreakDays: storedStreakDays,
      storedStreakDays,
      dayGap,
      note: 'Check in before next reset to keep this streak alive.',
    };
  }

  if (dayGap === 2 && state.freezeTokens > 0) {
    return {
      status: 'at-risk',
      activeStreakDays: storedStreakDays,
      storedStreakDays,
      dayGap,
      note: 'One freeze token can preserve this streak if you check in now.',
    };
  }

  return {
    status: 'inactive',
    activeStreakDays: 0,
    storedStreakDays,
    dayGap,
    note: 'Streak is inactive and will restart at 1 on your next check-in.',
  };
};
