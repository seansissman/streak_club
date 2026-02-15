import { redis } from '@devvit/web/server';

const MILLISECONDS_PER_DAY = 86_400_000;
const UTC_TIMEZONE = 'UTC';
const UNSET_DAY = '-1';

export type Privacy = 'public' | 'private';

export type ChallengeConfig = {
  title: string;
  description: string;
  timezone: 'UTC';
  createdAt: string;
};

export type ChallengeConfigUpdate = {
  title: string;
  description: string;
};

export type UserState = {
  joinedAt: string;
  privacy: Privacy;
  currentStreak: number;
  bestStreak: number;
  streakStartDayUTC: number | null;
  lastCheckinDayUTC: number | null;
};

export type LeaderboardEntry = {
  userId: string;
  currentStreak: number;
  bestStreak: number;
  streakStartDayUTC: number | null;
  lastCheckinDayUTC: number | null;
};

export type ChallengeStats = {
  participantsCount: number;
  checkedInTodayCount: number;
};

export const keys = {
  challengeConfig: (subredditId: string): string => `cfg:${subredditId}`,
  userState: (subredditId: string, userId: string): string =>
    `user:${subredditId}:${userId}`,
  leaderboard: (subredditId: string): string => `lb:${subredditId}`,
  challengeStats: (subredditId: string): string => `stats:${subredditId}`,
};

const toDayStorage = (day: number | null): string =>
  day === null ? UNSET_DAY : String(day);

const fromDayStorage = (value: string | undefined): number | null => {
  if (!value || value === UNSET_DAY) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
};

const parsePrivacy = (value: string | undefined): Privacy =>
  value === 'private' ? 'private' : 'public';

const parseNonNegativeInt = (
  value: string | undefined,
  fallback = 0
): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
};

const serializeUserState = (state: UserState): Record<string, string> => ({
  joinedAt: state.joinedAt,
  privacy: state.privacy,
  currentStreak: String(state.currentStreak),
  bestStreak: String(state.bestStreak),
  streakStartDayUTC: toDayStorage(state.streakStartDayUTC),
  lastCheckinDayUTC: toDayStorage(state.lastCheckinDayUTC),
});

const deserializeUserState = (
  data: Record<string, string>
): UserState | null => {
  if (Object.keys(data).length === 0) {
    return null;
  }

  return {
    joinedAt: data.joinedAt ?? new Date(0).toISOString(),
    privacy: parsePrivacy(data.privacy),
    currentStreak: parseNonNegativeInt(data.currentStreak),
    bestStreak: parseNonNegativeInt(data.bestStreak),
    streakStartDayUTC: fromDayStorage(data.streakStartDayUTC),
    lastCheckinDayUTC: fromDayStorage(data.lastCheckinDayUTC),
  };
};

export const utcDayNumber = (date: Date): number =>
  Math.floor(date.getTime() / MILLISECONDS_PER_DAY);

export const canCheckIn = (userState: UserState, day: number): boolean => {
  const lastCheckinDay = userState.lastCheckinDayUTC;
  if (lastCheckinDay === null) {
    return true;
  }

  return day > lastCheckinDay;
};

export const applyCheckIn = (userState: UserState, day: number): UserState => {
  if (!canCheckIn(userState, day)) {
    throw new Error('User has already checked in for this UTC day');
  }

  const last = userState.lastCheckinDayUTC;
  const isConsecutiveDay =
    last !== null &&
    day === last + 1 &&
    userState.streakStartDayUTC !== null;

  const currentStreak = isConsecutiveDay ? userState.currentStreak + 1 : 1;
  const streakStartDayUTC = isConsecutiveDay ? userState.streakStartDayUTC : day;
  const bestStreak = Math.max(userState.bestStreak, currentStreak);

  return {
    ...userState,
    currentStreak,
    bestStreak,
    streakStartDayUTC,
    lastCheckinDayUTC: day,
  };
};

const defaultChallengeConfig = (): ChallengeConfig => ({
  title: 'Streak Engine',
  description: 'Join and check in daily. Reset time is 00:00 UTC.',
  timezone: UTC_TIMEZONE,
  createdAt: new Date().toISOString(),
});

export const ensureChallengeConfig = async (
  subredditId: string
): Promise<ChallengeConfig> => {
  const key = keys.challengeConfig(subredditId);
  const existing = await redis.hGetAll(key);

  if (Object.keys(existing).length > 0) {
    return {
      title: existing.title ?? 'Streak Engine',
      description:
        existing.description ?? 'Join and check in daily. Reset time is 00:00 UTC.',
      timezone: UTC_TIMEZONE,
      createdAt: existing.createdAt ?? new Date(0).toISOString(),
    };
  }

  const config = defaultChallengeConfig();
  await redis.hSet(key, {
    title: config.title,
    description: config.description,
    timezone: config.timezone,
    createdAt: config.createdAt,
  });

  return config;
};

export const getChallengeConfig = async (
  subredditId: string
): Promise<ChallengeConfig> => ensureChallengeConfig(subredditId);

export const setChallengeConfig = async (
  subredditId: string,
  update: ChallengeConfigUpdate
): Promise<ChallengeConfig> => {
  const existing = await ensureChallengeConfig(subredditId);
  const next: ChallengeConfig = {
    ...existing,
    title: update.title,
    description: update.description,
    timezone: UTC_TIMEZONE,
  };

  await redis.hSet(keys.challengeConfig(subredditId), {
    title: next.title,
    description: next.description,
    timezone: next.timezone,
    createdAt: next.createdAt,
  });

  return next;
};

export const getUserState = async (
  subredditId: string,
  userId: string
): Promise<UserState | null> => {
  const stored = await redis.hGetAll(keys.userState(subredditId, userId));
  return deserializeUserState(stored);
};

export const setUserState = async (
  subredditId: string,
  userId: string,
  userState: UserState
): Promise<void> => {
  await redis.hSet(keys.userState(subredditId, userId), serializeUserState(userState));
};

const syncLeaderboardEntry = async (
  subredditId: string,
  userId: string,
  userState: UserState
): Promise<void> => {
  const lbKey = keys.leaderboard(subredditId);
  if (userState.privacy === 'private') {
    await redis.zRem(lbKey, [userId]);
    return;
  }

  await redis.zAdd(lbKey, {
    member: userId,
    score: userState.currentStreak,
  });
};

export const joinChallenge = async (
  subredditId: string,
  userId: string,
  privacy: Privacy = 'public'
): Promise<UserState> => {
  const existing = await getUserState(subredditId, userId);
  if (existing) {
    return existing;
  }

  const initialState: UserState = {
    joinedAt: new Date().toISOString(),
    privacy,
    currentStreak: 0,
    bestStreak: 0,
    streakStartDayUTC: null,
    lastCheckinDayUTC: null,
  };

  await setUserState(subredditId, userId, initialState);
  await syncLeaderboardEntry(subredditId, userId, initialState);
  await redis.hIncrBy(keys.challengeStats(subredditId), 'participantsCount', 1);

  return initialState;
};

export const setPrivacy = async (
  subredditId: string,
  userId: string,
  privacy: Privacy
): Promise<UserState | null> => {
  const existing = await getUserState(subredditId, userId);
  if (!existing) {
    return null;
  }

  const updated: UserState = {
    ...existing,
    privacy,
  };

  await setUserState(subredditId, userId, updated);
  await syncLeaderboardEntry(subredditId, userId, updated);

  return updated;
};

export const recordCheckIn = async (
  subredditId: string,
  userId: string,
  day: number
): Promise<UserState | null> => {
  const existing = await getUserState(subredditId, userId);
  if (!existing) {
    return null;
  }

  const updated = applyCheckIn(existing, day);
  await setUserState(subredditId, userId, updated);
  await syncLeaderboardEntry(subredditId, userId, updated);
  await redis.hIncrBy(
    keys.challengeStats(subredditId),
    `checkins:${String(day)}`,
    1
  );

  return updated;
};

export const getChallengeStats = async (
  subredditId: string,
  day: number
): Promise<ChallengeStats> => {
  const stats = await redis.hMGet(keys.challengeStats(subredditId), [
    'participantsCount',
    `checkins:${String(day)}`,
  ]);

  return {
    participantsCount: Number.parseInt(stats[0] ?? '0', 10) || 0,
    checkedInTodayCount: Number.parseInt(stats[1] ?? '0', 10) || 0,
  };
};

export const getLeaderboard = async (
  subredditId: string,
  limit = 25
): Promise<LeaderboardEntry[]> => {
  const candidateCount = Math.max(limit * 4, 100);
  const ranked = await redis.zRange(keys.leaderboard(subredditId), 0, candidateCount - 1, {
    by: 'rank',
    reverse: true,
  });

  const leaderboardUsers = await Promise.all(
    ranked.map(async ({ member, score }) => {
      const userState = await getUserState(subredditId, member);
      if (!userState || userState.privacy === 'private') {
        return null;
      }

      return {
        userId: member,
        currentStreak: score,
        bestStreak: userState.bestStreak,
        streakStartDayUTC: userState.streakStartDayUTC,
        lastCheckinDayUTC: userState.lastCheckinDayUTC,
      } satisfies LeaderboardEntry;
    })
  );

  const tieBreakDay = Number.MAX_SAFE_INTEGER;

  return leaderboardUsers
    .filter((entry): entry is LeaderboardEntry => entry !== null)
    .sort((a, b) => {
      if (b.currentStreak !== a.currentStreak) {
        return b.currentStreak - a.currentStreak;
      }

      const aStart = a.streakStartDayUTC ?? tieBreakDay;
      const bStart = b.streakStartDayUTC ?? tieBreakDay;
      if (aStart !== bStart) {
        return aStart - bStart;
      }

      return a.userId.localeCompare(b.userId);
    })
    .slice(0, limit);
};
