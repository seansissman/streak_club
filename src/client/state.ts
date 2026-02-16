export type UserStateView = {
  lastCheckinDayUTC: number | null;
};

export type MeStateView = {
  state: UserStateView | null;
  checkedInToday?: boolean;
};

export type DevTimeView = {
  effectiveDayNumber: number;
} | null;

export const isUserJoined = (me: MeStateView | null): boolean => Boolean(me?.state);

export const isCheckedInToday = (
  me: MeStateView | null,
  devTime: DevTimeView
): boolean => {
  if (!me?.state) {
    return false;
  }

  if (typeof me.checkedInToday === 'boolean') {
    return me.checkedInToday;
  }

  if (devTime?.effectiveDayNumber == null || me.state.lastCheckinDayUTC == null) {
    return false;
  }

  return me.state.lastCheckinDayUTC === devTime.effectiveDayNumber;
};

export const shouldRenderCheckInButton = (
  me: MeStateView | null,
  devTime: DevTimeView
): boolean => isUserJoined(me) && !isCheckedInToday(me, devTime);
