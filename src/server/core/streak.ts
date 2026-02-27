import { redis } from '@devvit/web/server';
import {
  applyTemplateToConfig,
  isTemplateId,
  type TemplateId,
} from './templates';
import {
  applyAggregateStatsMutation,
  applyCheckinStatsUpdate,
  parseAggregateStatsRecord,
  serializeAggregateStatsRecord,
  type AggregateStats,
  type AggregateStatsMutation,
} from './stats';
import { evaluateActionThrottle, type RateLimitDecision } from './rate_limit';

const MILLISECONDS_PER_DAY = 86_400_000;
const UTC_TIMEZONE = 'UTC';
const UNSET_DAY = '-1';
const STATE_GENERATION_FIELD = 'stateGeneration';
const TODAY_SET_RETENTION_DAYS = 30;
const MAX_FREEZE_TOKENS = 2;
const BADGE_MILESTONES: Array<{ streak: number; badge: string }> = [
  { streak: 7, badge: 'Committed' },
  { streak: 30, badge: 'Consistent' },
  { streak: 90, badge: 'Disciplined' },
  { streak: 180, badge: 'Unstoppable' },
  { streak: 365, badge: 'Legend' },
];
const BADGE_NAMES = BADGE_MILESTONES.map((entry) => entry.badge);

export type Privacy = 'public' | 'private';

export type ChallengeConfig = {
  templateId: TemplateId;
  title: string;
  description: string;
  timezone: 'UTC';
  badgeThresholds: number[];
  devMode: boolean;
  activePostId: string | null;
  updatedAt: number;
  createdAt: number;
};

export type ChallengeConfigUpdate = {
  templateId?: TemplateId;
  title?: string;
  description?: string;
  badgeThresholds?: number[];
  devMode?: boolean;
  activePostId?: string | null;
};

export type UserState = {
  joinedAt: string;
  privacy: Privacy;
  currentStreak: number;
  bestStreak: number;
  streakStartDayUTC: number | null;
  lastCheckinDayUTC: number | null;
  freezeTokens: number;
  freezeSaves: number;
  badges: string[];
  isParticipant: boolean;
};

export type CheckInMetadata = {
  usedFreeze: boolean;
  earnedFreeze: boolean;
  tokenCount: number;
  earnedBadge: string | null;
};

export type CheckInResult = {
  state: UserState;
  metadata: CheckInMetadata;
};

export type LeaderboardEntry = {
  userId: string;
  currentStreak: number;
  bestStreak: number;
  streakAchievedDayUTC: number | null;
  streakStartDayUTC: number | null;
  lastCheckinDayUTC: number | null;
};

export type ChallengeStats = AggregateStats;

export const keys = {
  challengeConfig: (subredditId: string): string => `cfg:${subredditId}`,
  userState: (subredditId: string, userId: string): string =>
    `user:${subredditId}:${userId}`,
  participants: (subredditId: string): string => `participants:${subredditId}`,
  leaderboard: (subredditId: string): string => `lb:${subredditId}`,
  usernames: (subredditId: string): string => `names:${subredditId}`,
  challengeStats: (subredditId: string): string => `stats:${subredditId}`,
  todayCheckins: (subredditId: string, utcDayNumber: number): string =>
    `today:${subredditId}:${String(utcDayNumber)}`,
  rateLimit: (subredditId: string, userId: string): string =>
    `rl:${subredditId}:${userId}`,
  devSettings: (subredditId: string): string => `dev:${subredditId}`,
};

const updateChallengeStats = async (
  subredditId: string,
  todayDay: number,
  mutation: AggregateStatsMutation
): Promise<ChallengeStats> => {
  const statsKey = keys.challengeStats(subredditId);
  const stored = await redis.hGetAll(statsKey);
  const existing = parseAggregateStatsRecord(stored, todayDay);
  const updated = applyAggregateStatsMutation(existing, todayDay, mutation);
  await redis.hSet(statsKey, serializeAggregateStatsRecord(updated));
  return updated;
};

const syncChallengeStatsCheckinsToday = async (
  subredditId: string,
  day: number
): Promise<ChallengeStats> => {
  const statsKey = keys.challengeStats(subredditId);
  const stored = await redis.hGetAll(statsKey);
  const parsed = parseAggregateStatsRecord(stored, day);
  const todaySetSize = await redis.hLen(keys.todayCheckins(subredditId, day));
  const synced = {
    ...parsed,
    lastStatsDay: day,
    checkinsToday: todaySetSize,
  };
  await redis.hSet(statsKey, serializeAggregateStatsRecord(synced));
  return synced;
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

const parseBadges = (raw: string | undefined): string[] => {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const uniqueBadges = Array.from(
      new Set(
        parsed.filter(
          (value): value is string =>
            typeof value === 'string' && BADGE_NAMES.includes(value)
        )
      )
    );

    return BADGE_MILESTONES
      .map((entry) => entry.badge)
      .filter((badge) => uniqueBadges.includes(badge));
  } catch {
    return [];
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
  freezeTokens: String(state.freezeTokens),
  freezeSaves: String(state.freezeSaves),
  badges: JSON.stringify(state.badges),
  isParticipant: state.isParticipant ? '1' : '0',
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
    freezeTokens: Math.min(
      parseNonNegativeInt(data.freezeTokens),
      MAX_FREEZE_TOKENS
    ),
    freezeSaves: parseNonNegativeInt(data.freezeSaves),
    badges: parseBadges(data.badges),
    isParticipant: data.isParticipant !== '0',
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

export type UtcNowSnapshot = {
  utcMs: number;
  utcDayNumber: number;
  secondsUntilReset: number;
};

export const getDevTimeOffsetSeconds = async (
  subredditId: string
): Promise<number> => {
  const offset = await redis.hGet(keys.devSettings(subredditId), 'devTimeOffsetSeconds');
  if (!offset) {
    return 0;
  }

  const parsed = Number.parseInt(offset, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
};

export const getDevDayOffset = async (subredditId: string): Promise<number> => {
  const offsetSeconds = await getDevTimeOffsetSeconds(subredditId);
  return Math.trunc(offsetSeconds / 86_400);
};

export const setDevTimeOffsetSeconds = async (
  subredditId: string,
  devTimeOffsetSeconds: number
): Promise<number> => {
  await redis.hSet(keys.devSettings(subredditId), {
    devTimeOffsetSeconds: String(devTimeOffsetSeconds),
    devDayOffset: String(Math.trunc(devTimeOffsetSeconds / 86_400)),
  });
  return devTimeOffsetSeconds;
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
  await setDevTimeOffsetSeconds(subredditId, devDayOffset * 86_400);
  return devDayOffset;
};

export const getUtcNowFromBaseMs = (
  baseUtcMs: number,
  devTimeOffsetSeconds: number
): UtcNowSnapshot => {
  const utcMs = baseUtcMs + devTimeOffsetSeconds * 1000;
  const day = Math.floor(utcMs / MILLISECONDS_PER_DAY);
  const nextResetUtcMs = computeNextResetFromDayNumber(day);
  const secondsUntilReset = Math.max(
    0,
    Math.floor((nextResetUtcMs - utcMs) / 1000)
  );

  return {
    utcMs,
    utcDayNumber: day,
    secondsUntilReset,
  };
};

export const getUtcNow = async (
  subredditId: string,
  now: Date = new Date()
): Promise<UtcNowSnapshot> => {
  const offsetSeconds = await getDevTimeOffsetSeconds(subredditId);
  return getUtcNowFromBaseMs(now.getTime(), offsetSeconds);
};

export const getTodayDayNumber = async (
  subredditId: string,
  now: Date = new Date()
): Promise<number> => {
  const utcNow = await getUtcNow(subredditId, now);
  return utcNow.utcDayNumber;
};

export const canCheckIn = (userState: UserState, day: number): boolean => {
  const lastCheckinDay = userState.lastCheckinDayUTC;
  if (lastCheckinDay === null) {
    return true;
  }

  return day > lastCheckinDay;
};

export const applyCheckIn = (userState: UserState, day: number): UserState => {
  return applyCheckInWithMetadata(userState, day).state;
};

export const applyCheckInWithMetadata = (
  userState: UserState,
  day: number
): CheckInResult => {
  if (!canCheckIn(userState, day)) {
    throw new Error('User has already checked in for this UTC day');
  }

  const last = userState.lastCheckinDayUTC;
  const missedDays = last === null ? 0 : day - last;
  let usedFreeze = false;
  let freezeTokens = userState.freezeTokens;
  let freezeSaves = userState.freezeSaves;

  const canContinueWithFreeze = missedDays === 2 && freezeTokens > 0;
  if (canContinueWithFreeze) {
    usedFreeze = true;
    freezeTokens -= 1;
    freezeSaves += 1;
  }

  const isConsecutiveDay = missedDays === 1;
  const isContinuation = isConsecutiveDay || canContinueWithFreeze;
  const hasTrackableStreak =
    userState.streakStartDayUTC !== null && userState.currentStreak > 0;

  const currentStreak =
    isContinuation && hasTrackableStreak ? userState.currentStreak + 1 : 1;
  const streakStartDayUTC =
    isContinuation && hasTrackableStreak ? userState.streakStartDayUTC : day;
  const bestStreak = Math.max(userState.bestStreak, currentStreak);
  let earnedFreeze = false;

  if (currentStreak % 7 === 0 && freezeTokens < MAX_FREEZE_TOKENS) {
    freezeTokens += 1;
    earnedFreeze = true;
  }
  const milestoneBadge =
    BADGE_MILESTONES.find((entry) => entry.streak === currentStreak)?.badge ?? null;
  const earnedBadge =
    milestoneBadge && !userState.badges.includes(milestoneBadge)
      ? milestoneBadge
      : null;
  const badges =
    earnedBadge === null ? userState.badges : [...userState.badges, earnedBadge];

  const updated: UserState = {
    ...userState,
    currentStreak,
    bestStreak,
    streakStartDayUTC,
    lastCheckinDayUTC: day,
    freezeTokens,
    freezeSaves,
    badges,
  };

  return {
    state: updated,
    metadata: {
      usedFreeze,
      earnedFreeze,
      tokenCount: freezeTokens,
      earnedBadge,
    },
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
  devMode: config.devMode ? '1' : '0',
  activePostId: config.activePostId ?? '',
  updatedAt: String(config.updatedAt),
  createdAt: String(config.createdAt),
});

const defaultChallengeConfig = (now: number = Date.now()): ChallengeConfig => {
  const templateConfig = applyTemplateToConfig('custom');
  return {
    ...templateConfig,
    timezone: UTC_TIMEZONE,
    devMode: false,
    activePostId: null,
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
  const activePostIdRaw = data.activePostId;

  return {
    templateId,
    title: data.title ?? templateConfig.title,
    description: data.description ?? templateConfig.description,
    timezone: UTC_TIMEZONE,
    badgeThresholds: parsedThresholds ?? templateConfig.badgeThresholds,
    devMode: data.devMode === '1',
    activePostId:
      !activePostIdRaw || activePostIdRaw.trim().length === 0
        ? null
        : activePostIdRaw,
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
    devMode: update.devMode ?? existing.devMode,
    activePostId:
      update.activePostId !== undefined ? update.activePostId : existing.activePostId,
    updatedAt: Date.now(),
    createdAt: existing.createdAt,
  };

  await redis.hSet(
    keys.challengeConfig(subredditId),
    serializeChallengeConfig(next)
  );

  return next;
};

export const setActiveTrackerPostId = async (
  subredditId: string,
  postId: string | null
): Promise<ChallengeConfig> =>
  setChallengeConfig(subredditId, {
    activePostId: postId,
  });

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
    devTimeOffsetSeconds: '0',
  });
  await redis.del(
    keys.leaderboard(subredditId),
    keys.usernames(subredditId),
    keys.challengeStats(subredditId),
    keys.participants(subredditId)
  );

  return { stateGeneration };
};

export const getParticipantCount = async (subredditId: string): Promise<number> => {
  const today = await getTodayDayNumber(subredditId);
  const stats = await getChallengeStats(subredditId, today);
  return stats.participantsTotal;
};

export type ActionType = 'join' | 'checkin';

export const checkActionRateLimit = async (
  subredditId: string,
  userId: string,
  action: ActionType,
  nowMs: number
): Promise<RateLimitDecision> => {
  const field = action === 'join' ? 'lastJoinAttemptMs' : 'lastCheckinAttemptMs';
  const key = keys.rateLimit(subredditId, userId);
  const raw = await redis.hGet(key, field);
  const lastAttemptMs = raw ? Number.parseInt(raw, 10) : null;
  const decision = evaluateActionThrottle(
    nowMs,
    Number.isNaN(lastAttemptMs ?? Number.NaN) ? null : lastAttemptMs
  );

  if (decision.allowed) {
    await redis.hSet(key, {
      [field]: String(nowMs),
    });
  }

  return decision;
};

export const clearUserRateLimit = async (
  subredditId: string,
  userId: string
): Promise<void> => {
  await redis.del(keys.rateLimit(subredditId, userId));
};

const pruneExpiredTodaySet = async (
  subredditId: string,
  todayDay: number
): Promise<void> => {
  const expiredDay = todayDay - TODAY_SET_RETENTION_DAYS - 1;
  if (expiredDay < 0) {
    return;
  }

  try {
    await redis.del(keys.todayCheckins(subredditId, expiredDay));
  } catch {
    // Best-effort retention cleanup should never block check-in or repair.
  }
};

export const storeUsername = async (
  subredditId: string,
  userId: string,
  username: string | undefined
): Promise<void> => {
  const normalized = username?.trim();
  if (!normalized) {
    return;
  }

  await redis.hSet(keys.usernames(subredditId), {
    [userId]: normalized,
  });
};

export const getStoredUsernames = async (
  subredditId: string
): Promise<Record<string, string>> => {
  return await redis.hGetAll(keys.usernames(subredditId));
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
    freezeTokens: 0,
    freezeSaves: 0,
    badges: [],
    isParticipant: true,
  };

  await setUserState(subredditId, userId, initialState);
  await syncLeaderboardEntry(subredditId, userId, initialState);
  const participantsAdded = await redis.hSet(keys.participants(subredditId), {
    [userId]: '1',
  });
  if (participantsAdded > 0) {
    const today = await getTodayDayNumber(subredditId);
    await updateChallengeStats(subredditId, today, {
      incrementParticipants: true,
    });
  }

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
): Promise<CheckInResult | null> => {
  const existing = await getUserState(subredditId, userId);
  if (!existing) {
    return null;
  }

  const result = applyCheckInWithMetadata(existing, day);
  await setUserState(subredditId, userId, result.state);
  await syncLeaderboardEntry(subredditId, userId, result.state);
  const todayKey = keys.todayCheckins(subredditId, day);
  const added = await redis.hSet(todayKey, {
    [userId]: '1',
  });
  const todaySetSize = await redis.hLen(todayKey);
  const statsStored = await redis.hGetAll(keys.challengeStats(subredditId));
  const parsedStats = parseAggregateStatsRecord(statsStored, day);
  const nextStats = applyCheckinStatsUpdate(parsedStats, day, {
    wasNewTodayCheckin: added > 0,
    todaySetSize,
    bestStreakCandidate: result.state.bestStreak,
  });
  await redis.hSet(
    keys.challengeStats(subredditId),
    serializeAggregateStatsRecord(nextStats)
  );
  await pruneExpiredTodaySet(subredditId, day);

  return result;
};

export const getChallengeStats = async (
  subredditId: string,
  day: number
): Promise<ChallengeStats> => {
  return await syncChallengeStatsCheckinsToday(subredditId, day);
};

export const getTodayCheckinsCount = async (
  subredditId: string,
  day: number
): Promise<number> => await redis.hLen(keys.todayCheckins(subredditId, day));

export const repairTodayStats = async (
  subredditId: string,
  day: number
): Promise<{ oldStats: ChallengeStats; newStats: ChallengeStats; todaySetSize: number }> => {
  const oldStats = await getChallengeStats(subredditId, day);
  const todaySetSize = await getTodayCheckinsCount(subredditId, day);
  const repaired: ChallengeStats = {
    ...oldStats,
    lastStatsDay: day,
    checkinsToday: todaySetSize,
  };
  await redis.hSet(
    keys.challengeStats(subredditId),
    serializeAggregateStatsRecord(repaired)
  );
  await pruneExpiredTodaySet(subredditId, day);

  return {
    oldStats,
    newStats: repaired,
    todaySetSize,
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
        streakAchievedDayUTC: userState.lastCheckinDayUTC,
        streakStartDayUTC: userState.streakStartDayUTC,
        lastCheckinDayUTC: userState.lastCheckinDayUTC,
      } satisfies LeaderboardEntry;
    })
  );

  const tieBreakDay = Number.MAX_SAFE_INTEGER;

  return leaderboardUsers
    .filter((entry): entry is LeaderboardEntry => entry !== null)
    .sort((a, b) => compareLeaderboardEntries(a, b, tieBreakDay))
    .slice(0, limit);
};

export const compareLeaderboardEntries = (
  a: LeaderboardEntry,
  b: LeaderboardEntry,
  tieBreakDay = Number.MAX_SAFE_INTEGER
): number => {
  if (b.currentStreak !== a.currentStreak) {
    return b.currentStreak - a.currentStreak;
  }

  if (b.bestStreak !== a.bestStreak) {
    return b.bestStreak - a.bestStreak;
  }

  const aAchieved = a.streakAchievedDayUTC ?? a.lastCheckinDayUTC ?? tieBreakDay;
  const bAchieved = b.streakAchievedDayUTC ?? b.lastCheckinDayUTC ?? tieBreakDay;
  if (aAchieved !== bAchieved) {
    return aAchieved - bAchieved;
  }

  return a.userId.localeCompare(b.userId);
};
