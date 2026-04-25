import type { UserState } from './streak';

type CheckinStateView = Pick<UserState, 'lastCheckinDayUTC'>;

export const checkedInToday = (
  state: CheckinStateView | null,
  day: number
): boolean => state?.lastCheckinDayUTC === day;

export const isEffectiveDayBeforeLatestCheckIn = (
  state: CheckinStateView | null,
  day: number
): boolean =>
  state?.lastCheckinDayUTC !== null &&
  state?.lastCheckinDayUTC !== undefined &&
  state.lastCheckinDayUTC > day;

export const canCheckInToday = (
  state: CheckinStateView | null,
  day: number
): boolean => {
  if (!state || state.lastCheckinDayUTC === null) {
    return true;
  }

  return day > state.lastCheckinDayUTC;
};
