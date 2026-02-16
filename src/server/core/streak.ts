import { redis } from '@devvit/web/server';
import {
  applyTemplateToConfig,
  isTemplateId,
  type TemplateId,
} from './templates';

const MILLISECONDS_PER_DAY = 86_400_000;
const UTC_TIMEZONE = 'UTC';
const UNSET_DAY = '-1';
const STATE_GENERATION_FIELD = 'stateGeneration';

export type Privacy = 'public' | 'private';

export type ChallengeConfig = {
  templateId: TemplateId;
  title: string;
  description: string;
  timezone: 'UTC';
  badgeThresholds: number[];
  updatedAt: number;
  createdAt: number;
};

export type ChallengeConfigUpdate = {
  templateId?: TemplateId;
  title?: string;
  description?: string;
  badgeThresholds?: number[];
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
  devSettings: (subredditId: string): string => `dev:${subredditId}`,
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

const parseTimestamp = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const intParsed = Number.parseInt(value, 10);
  if (!Number.isNaN(intParsed) && intParsed > 0) {
    return intParsed;
  }

  const dateParsed = Date.parse(value);
  return Number.isNaN(dateParsed) || dateParsed <= 0 ? fallback : dateParsed;
};

const sanitizeBadgeThresholds = (value: unknown): number[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const values = value
    .map((item) => (typeof item === 'number' ? item : Number.parseInt(String(item), 10)))
    .filter((num) => Number.isInteger(num) && num > 0);

  if (values.length === 0) {
    return null;
  }

  return Array.from(new Set(values)).sort((a, b) => a - b);
};

const parseBadgeThresholds = (raw: string | undefined): number[] | null => {
  if (!raw) {
    return null;
  }

  try {
    return sanitizeBadgeThresholds(JSON.parse(raw));
  } catch {
    return sanitizeBadgeThresholds(raw.split(','));
  }
};

const serializeUserState = (
  state: UserState,
  stateGeneration: number
): Record<string, string> => ({
  joinedAt: state.joinedAt,
  privacy: state.privacy,
  currentStreak: String(state.currentStreak),
  bestStreak: String(state.bestStreak),
  streakStartDayUTC: toDayStorage(state.streakStartDayUTC),
  lastCheckinDayUTC: toDayStorage(state.lastCheckinDayUTC),
  [STATE_GENERATION_FIELD]: String(stateGeneration),
});

const deserializeUserState = (
  data: Record<string, string>,
  currentStateGeneration: number
): UserState | null => {
  if (Object.keys(data).length === 0) {
    return null;
  }

  const storedStateGeneration = parseNonNegativeInt(data[STATE_GENERATION_FIELD], 0);
  if (storedStateGeneration !== currentStateGeneration) {
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

export const computeNextResetUTC = (date: Date): number =>
  (utcDayNumber(date) + 1) * MILLISECONDS_PER_DAY;

export const applyDevDayOffset = (dayNumber: number, devDayOffset: number): number =>
  dayNumber + devDayOffset;

export const computeNextResetFromDayNumber = (dayNumber: number): number =>
  (dayNumber + 1) * MILLISECONDS_PER_DAY;

export const getDevDayOffset = async (subredditId: string): Promise<number> => {
  const offset = await redis.hGet(keys.devSettings(subredditId), 'devDayOffset');
  if (!offset) {
    return 0;
  }

  const parsed = Number.parseInt(offset, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const getStateGeneration = async (subredditId: string): Promise<number> => {
  const raw = await redis.hGet(keys.devSettings(subredditId), STATE_GENERATION_FIELD);
  if (!raw) {
    return 0;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
};

export const setDevDayOffset = async (
  subredditId: string,
  devDayOffset: number
): Promise<number> => {
  await redis.hSet(keys.devSettings(subredditId), {
    devDayOffset: String(devDayOffset),
  });
  return devDayOffset;
};

export const getTodayDayNumber = async (
  subredditId: string,
  now: Date = new Date()
): Promise<number> => {
  const baseDayNumber = utcDayNumber(now);
  const devDayOffset = await getDevDayOffset(subredditId);
  return applyDevDayOffset(baseDayNumber, devDayOffset);
};

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

const serializeChallengeConfig = (
  config: ChallengeConfig
): Record<string, string> => ({
  templateId: config.templateId,
  title: config.title,
  description: config.description,
  timezone: config.timezone,
  badgeThresholds: JSON.stringify(config.badgeThresholds),
  updatedAt: String(config.updatedAt),
  createdAt: String(config.createdAt),
});

const defaultChallengeConfig = (now: number = Date.now()): ChallengeConfig => {
  const templateConfig = applyTemplateToConfig('custom');
  return {
    ...templateConfig,
    timezone: UTC_TIMEZONE,
    updatedAt: now,
    createdAt: now,
  };
};

const isBlank = (value: string | undefined): boolean => !value || value.trim().length === 0;

export const isConfigSetupRequired = (config: ChallengeConfig): boolean => {
  const customDefaults = applyTemplateToConfig('custom');
  const genericCustomTitle =
    config.templateId === 'custom' &&
    (isBlank(config.title) || config.title.trim() === customDefaults.title);
  const blankContent = isBlank(config.title) || isBlank(config.description);
  const missingBadges = !Array.isArray(config.badgeThresholds) || config.badgeThresholds.length === 0;

  return genericCustomTitle || blankContent || missingBadges;
};

const deserializeChallengeConfig = (
  data: Record<string, string>,
  fallbackNow: number
): ChallengeConfig | null => {
  if (Object.keys(data).length === 0) {
    return null;
  }

  const templateId: TemplateId = isTemplateId(data.templateId)
    ? data.templateId
    : 'custom';
  const templateConfig = applyTemplateToConfig(templateId);
  const parsedThresholds = parseBadgeThresholds(data.badgeThresholds);
  const createdAt = parseTimestamp(data.createdAt, fallbackNow);
  const updatedAt = parseTimestamp(data.updatedAt, createdAt);

  return {
    templateId,
    title: data.title ?? templateConfig.title,
    description: data.description ?? templateConfig.description,
    timezone: UTC_TIMEZONE,
    badgeThresholds: parsedThresholds ?? templateConfig.badgeThresholds,
    updatedAt,
    createdAt,
  };
};

export const applyTemplateToChallengeConfig = (
  templateId: TemplateId,
  overrides?: Partial<Pick<ChallengeConfig, 'title' | 'description' | 'badgeThresholds'>>
): Pick<ChallengeConfig, 'templateId' | 'title' | 'description' | 'badgeThresholds'> =>
  applyTemplateToConfig(templateId, overrides);

export const ensureChallengeConfig = async (
  subredditId: string
): Promise<ChallengeConfig> => {
  const key = keys.challengeConfig(subredditId);
  const existing = await redis.hGetAll(key);
  const now = Date.now();
  const parsed = deserializeChallengeConfig(existing, now);
  if (parsed) {
    await redis.hSet(key, serializeChallengeConfig(parsed));
    return parsed;
  }

  const config = defaultChallengeConfig(now);
  await redis.hSet(key, serializeChallengeConfig(config));
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
  const nextTemplateId = update.templateId ?? existing.templateId;
  const templateChanged = nextTemplateId !== existing.templateId;
  const templateDefaults = applyTemplateToConfig(nextTemplateId);
  const nextBadgeThresholds =
    sanitizeBadgeThresholds(update.badgeThresholds) ??
    (templateChanged ? templateDefaults.badgeThresholds : existing.badgeThresholds);

  const next: ChallengeConfig = {
    templateId: nextTemplateId,
    title:
      update.title ??
      (templateChanged ? templateDefaults.title : existing.title),
    description:
      update.description ??
      (templateChanged ? templateDefaults.description : existing.description),
    timezone: UTC_TIMEZONE,
    badgeThresholds: nextBadgeThresholds,
    updatedAt: Date.now(),
    createdAt: existing.createdAt,
  };

  await redis.hSet(
    keys.challengeConfig(subredditId),
    serializeChallengeConfig(next)
  );

  return next;
};

export const getUserState = async (
  subredditId: string,
  userId: string
): Promise<UserState | null> => {
  const stateGeneration = await getStateGeneration(subredditId);
  const stored = await redis.hGetAll(keys.userState(subredditId, userId));
  return deserializeUserState(stored, stateGeneration);
};

export const setUserState = async (
  subredditId: string,
  userId: string,
  userState: UserState
): Promise<void> => {
  const stateGeneration = await getStateGeneration(subredditId);
  await redis.hSet(
    keys.userState(subredditId, userId),
    serializeUserState(userState, stateGeneration)
  );
};

export const resetChallengeProgress = async (
  subredditId: string
): Promise<{ stateGeneration: number }> => {
  const stateGeneration = await redis.hIncrBy(
    keys.devSettings(subredditId),
    STATE_GENERATION_FIELD,
    1
  );
  await redis.hSet(keys.devSettings(subredditId), {
    devDayOffset: '0',
  });
  await redis.del(keys.leaderboard(subredditId), keys.challengeStats(subredditId));

  return { stateGeneration };
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
