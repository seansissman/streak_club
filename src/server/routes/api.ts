import { Hono } from 'hono';
import type { Context as HonoContext } from 'hono';
import { context, reddit } from '@devvit/web/server';
import { getAccessLevel, isDev, isMod, type AccessLevel } from '../access';
import {
  computeNextResetFromDayNumber,
  ensureChallengeConfig,
  getChallengeConfig,
  getDevTimeOffsetSeconds,
  getUtcNow,
  getParticipantCount,
  getChallengeStats,
  getLeaderboard,
  getTodayCheckinsCount,
  getUserState,
  isConfigSetupRequired,
  joinChallenge,
  checkActionRateLimit,
  clearUserRateLimit,
  recordCheckIn,
  repairTodayStats,
  resetChallengeProgress,
  setChallengeConfig,
  setDevTimeOffsetSeconds,
  storeUsername,
  getStoredUsernames,
  setUserState,
  setPrivacy,
  type Privacy,
  type UserState,
} from '../core/streak';
import {
  TEMPLATES,
  applyTemplateToConfig,
  isTemplateId,
  type TemplateId,
} from '../core/templates';

type ErrorResponse = {
  status: 'error';
  code: string;
  message: string;
  state?: UserState | null;
};

type ConfigRequest = {
  templateId?: string;
  title?: string;
  description?: string;
  badgeThresholds?: number[];
  devMode?: boolean;
  confirmTemplateChange?: boolean;
};

type ValidationErrorPayload = {
  error: {
    code: string;
    message: string;
    details: Record<string, string | string[]>;
  };
};

type PrivacyRequest = {
  privacy?: Privacy;
};

type DevTimeRequest = {
  devTimeOffsetSeconds?: number;
};

type DevStressReport = {
  ok: boolean;
  label: string;
  details?: string;
};

type HttpStatus = 400 | 401 | 403 | 404 | 409 | 429 | 500;

const jsonError = (
  c: HonoContext,
  status: HttpStatus,
  code: string,
  message: string,
  state?: UserState | null
) => c.json<ErrorResponse>({ status: 'error', code, message, state }, status);

const requireSubredditContext = (): { subredditId: string; subredditName: string } => {
  if (!context.subredditId || !context.subredditName) {
    throw new Error('subreddit context is required');
  }

  return {
    subredditId: context.subredditId,
    subredditName: context.subredditName,
  };
};

const requireUserId = (): string => {
  if (!context.userId) {
    throw new Error('userId is required in context');
  }

  return context.userId;
};

const parsePrivacy = (value: unknown): Privacy | null => {
  if (value === 'public' || value === 'private') {
    return value;
  }

  return null;
};

const jsonValidationError = (
  c: HonoContext,
  code: string,
  message: string,
  details: Record<string, string | string[]>
) => c.json<ValidationErrorPayload>({ error: { code, message, details } }, 400);

const isSortedUnique = (values: number[]): boolean => {
  for (let i = 0; i < values.length; i += 1) {
    const current = values[i];
    if (current === undefined || !Number.isInteger(current) || current <= 0) {
      return false;
    }
    const previous = i > 0 ? values[i - 1] : undefined;
    if (previous !== undefined && current <= previous) {
      return false;
    }
  }
  return true;
};

const checkedInToday = (state: UserState | null, day: number): boolean =>
  state?.lastCheckinDayUTC === day;

const canCheckInToday = (state: UserState | null, day: number): boolean => {
  if (!state || state.lastCheckinDayUTC === null) {
    return true;
  }

  return day > state.lastCheckinDayUTC;
};

const requireModAccess = async (): Promise<void> => {
  if (!context.username) {
    throw new Error('AUTH_REQUIRED');
  }

  const accessLevel = await getAccessLevel(context);
  if (!isMod(accessLevel)) {
    throw new Error('MODERATOR_REQUIRED');
  }
};

const requireDevAccess = async (): Promise<void> => {
  if (!context.username) {
    throw new Error('AUTH_REQUIRED');
  }

  const accessLevel = await getAccessLevel(context);
  if (!isDev(accessLevel)) {
    throw new Error('DEV_MODE_DISABLED');
  }
};

const logStress = (label: string, data: Record<string, unknown>): void => {
  // Useful for investigating boundary failures in dev runs.
  console.log(`[utc-stress] ${label}`, JSON.stringify(data));
};

export const api = new Hono();

api.get('/config', async (c) => {
  try {
    const { subredditId } = requireSubredditContext();
    const utcNow = await getUtcNow(subredditId);
    const today = utcNow.utcDayNumber;
    const config = await getChallengeConfig(subredditId);
    const stats = await getChallengeStats(subredditId, today);
    const configNeedsSetup = isConfigSetupRequired(config);

    return c.json({
      status: 'ok',
      config,
      configNeedsSetup,
      stats,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(c, 400, 'CONFIG_READ_FAILED', message);
  }
});

api.get('/templates', async (c) => {
  try {
    return c.json({
      status: 'ok',
      templates: TEMPLATES,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(c, 400, 'TEMPLATES_READ_FAILED', message);
  }
});

api.post('/config', async (c) => {
  try {
    const { subredditId } = requireSubredditContext();
    try {
      await requireModAccess();
    } catch (error) {
      if (error instanceof Error && error.message === 'AUTH_REQUIRED') {
        return jsonError(
          c,
          401,
          'AUTH_REQUIRED',
          'You must be logged in to update challenge config'
        );
      }
      if (error instanceof Error && error.message === 'MODERATOR_REQUIRED') {
        return jsonError(
          c,
          403,
          'MODERATOR_REQUIRED',
          'Only moderators can update challenge config'
        );
      }
      throw error;
    }

    const body = await c.req
      .json<ConfigRequest>()
      .catch(() => ({} as ConfigRequest));
    if (!isTemplateId(body.templateId)) {
      return jsonValidationError(
        c,
        'INVALID_TEMPLATE_ID',
        'Config validation failed',
        {
          templateId:
            'templateId must be one of: custom, habit_30, coding_daily, fitness_daily, study_daily',
        }
      );
    }

    const templateId: TemplateId = body.templateId;
    const confirmTemplateChange = body.confirmTemplateChange === true;
    const existingConfig = await getChallengeConfig(subredditId);
    if (templateId !== existingConfig.templateId) {
      const participantCount = await getParticipantCount(subredditId);
      if (participantCount > 0 && !confirmTemplateChange) {
        return c.json(
          {
            error: {
              code: 'TEMPLATE_CHANGE_CONFIRM_REQUIRED',
              message:
                'Changing template will update the challenge theme for all users. Existing streaks remain intact.',
            },
          },
          409
        );
      }
    }

    const templateDefaults = applyTemplateToConfig(templateId);
    const title = body.title?.trim() ?? templateDefaults.title;
    const description = body.description?.trim() ?? templateDefaults.description;
    const badgeThresholds = body.badgeThresholds ?? templateDefaults.badgeThresholds;

    const validationDetails: Record<string, string | string[]> = {};

    if (title.length < 3 || title.length > 120) {
      validationDetails.title = 'title must be 3..120 characters';
    }
    if (description.length > 500) {
      validationDetails.description = 'description must be 0..500 characters';
    }
    if (!Array.isArray(badgeThresholds)) {
      validationDetails.badgeThresholds = 'badgeThresholds must be an array of integers';
    } else {
      if (badgeThresholds.length === 0) {
        validationDetails.badgeThresholds = 'badgeThresholds cannot be empty';
      } else if (badgeThresholds.length > 10) {
        validationDetails.badgeThresholds = 'badgeThresholds must contain at most 10 values';
      } else {
        const maxValue = Math.max(...badgeThresholds);
        if (maxValue > 365) {
          validationDetails.badgeThresholds = 'badgeThresholds values must be <= 365';
        } else if (!isSortedUnique(badgeThresholds)) {
          validationDetails.badgeThresholds =
            'badgeThresholds must be positive integers in sorted unique order';
        }
      }
    }

    if (Object.keys(validationDetails).length > 0) {
      return jsonValidationError(
        c,
        'INVALID_CONFIG_FIELDS',
        'Config validation failed',
        validationDetails
      );
    }

    const config = await setChallengeConfig(subredditId, {
      templateId,
      title,
      description,
      badgeThresholds,
      devMode: body.devMode ?? existingConfig.devMode,
    });

    return c.json({
      status: 'ok',
      config,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(c, 400, 'CONFIG_WRITE_FAILED', message);
  }
});

api.post('/join', async (c) => {
  try {
    const { subredditId } = requireSubredditContext();
    const userId = requireUserId();
    await storeUsername(subredditId, userId, context.username);
    const utcNow = await getUtcNow(subredditId);
    const joinRateLimit = await checkActionRateLimit(
      subredditId,
      userId,
      'join',
      utcNow.utcMs
    );
    if (!joinRateLimit.allowed) {
      return jsonError(
        c,
        429,
        'JOIN_RATE_LIMITED',
        `Please wait ${Math.ceil(joinRateLimit.retryAfterMs / 1000)}s before trying to join again.`
      );
    }

    await ensureChallengeConfig(subredditId);
    const state = await joinChallenge(subredditId, userId, 'public');

    return c.json({
      status: 'ok',
      state,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(c, 401, 'JOIN_FAILED', message);
  }
});

api.post('/privacy', async (c) => {
  try {
    const { subredditId } = requireSubredditContext();
    const userId = requireUserId();

    const body = await c.req
      .json<PrivacyRequest>()
      .catch(() => ({} as PrivacyRequest));
    const privacy = parsePrivacy(body.privacy);
    if (!privacy) {
      return jsonError(
        c,
        400,
        'INVALID_PRIVACY',
        'privacy must be either "public" or "private"'
      );
    }

    const state = await setPrivacy(subredditId, userId, privacy);
    if (!state) {
      return jsonError(
        c,
        403,
        'JOIN_REQUIRED',
        'You must join before changing privacy settings'
      );
    }

    return c.json({
      status: 'ok',
      state,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(c, 401, 'PRIVACY_UPDATE_FAILED', message);
  }
});

api.post('/checkin', async (c) => {
  try {
    const { subredditId } = requireSubredditContext();
    const userId = requireUserId();
    await storeUsername(subredditId, userId, context.username);

    await ensureChallengeConfig(subredditId);

    const utcNow = await getUtcNow(subredditId);
    const checkinRateLimit = await checkActionRateLimit(
      subredditId,
      userId,
      'checkin',
      utcNow.utcMs
    );
    if (!checkinRateLimit.allowed) {
      return jsonError(
        c,
        429,
        'CHECKIN_RATE_LIMITED',
        `Please wait ${Math.ceil(checkinRateLimit.retryAfterMs / 1000)}s before trying again.`
      );
    }
    const today = utcNow.utcDayNumber;
    const state = await getUserState(subredditId, userId);

    if (!state) {
      return jsonError(
        c,
        403,
        'JOIN_REQUIRED',
        'Join the challenge before checking in'
      );
    }

    if (state.lastCheckinDayUTC === today) {
      return jsonError(
        c,
        409,
        'ALREADY_CHECKED_IN',
        'You already checked in today (UTC). Come back after the daily reset.',
        state
      );
    }
    if (state.lastCheckinDayUTC !== null && state.lastCheckinDayUTC > today) {
      return jsonError(
        c,
        409,
        'PAST_EFFECTIVE_DAY',
        'This effective day is earlier than your latest check-in. Move dev day offset forward to continue.',
        state
      );
    }

    const savedState = await recordCheckIn(subredditId, userId, today);
    if (!savedState) {
      return jsonError(
        c,
        500,
        'CHECKIN_SAVE_FAILED',
        'Unable to save check-in state'
      );
    }

    return c.json({
      status: 'ok',
      state: savedState.state,
      checkedInToday: true,
      nextResetUtcTimestamp: computeNextResetFromDayNumber(today),
      usedFreeze: savedState.metadata.usedFreeze,
      earnedFreeze: savedState.metadata.earnedFreeze,
      tokenCount: savedState.metadata.tokenCount,
      earnedBadge: savedState.metadata.earnedBadge,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(c, 401, 'CHECKIN_FAILED', message);
  }
});

api.get('/me', async (c) => {
  try {
    const { subredditId } = requireSubredditContext();
    const userId = requireUserId();

    const state = await getUserState(subredditId, userId);
    const utcNow = await getUtcNow(subredditId);
    const today = utcNow.utcDayNumber;
    const accessLevel = await getAccessLevel(context);

    let myRank: number | null = null;
    if (state?.privacy === 'public') {
      const ranking = await getLeaderboard(subredditId, 1000);
      const rankIndex = ranking.findIndex((entry) => entry.userId === userId);
      myRank = rankIndex >= 0 ? rankIndex + 1 : null;
    }

    return c.json({
      status: 'ok',
      state,
      checkedInToday: checkedInToday(state, today),
      canCheckInToday: canCheckInToday(state, today),
      nextResetUtcTimestamp: computeNextResetFromDayNumber(today),
      myRank,
      isModerator: isMod(accessLevel),
      accessLevel,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(c, 401, 'ME_FAILED', message);
  }
});

api.get('/viewer-context', async (c) => {
  try {
    const accessLevel = await getAccessLevel(context);
    return c.json({
      status: 'ok',
      accessLevel,
    });
  } catch (error) {
    console.warn('viewer-context fallback to user', error);
    const fallback: AccessLevel = 'user';
    return c.json({
      status: 'ok',
      accessLevel: fallback,
    });
  }
});

api.get('/dev/time', async (c) => {
  try {
    const { subredditId } = requireSubredditContext();
    try {
      await requireDevAccess();
    } catch (error) {
      if (error instanceof Error && error.message === 'AUTH_REQUIRED') {
        return jsonError(
          c,
          401,
          'AUTH_REQUIRED',
          'You must be logged in to view dev time settings'
        );
      }
      throw error;
    }
    const utcNow = await getUtcNow(subredditId);
    const devTimeOffsetSeconds = await getDevTimeOffsetSeconds(subredditId);
    const simulatedNow = new Date(utcNow.utcMs);

    return c.json({
      status: 'ok',
      note: 'DEV ONLY: Simulates day changes for testing.',
      serverUtcNow: new Date().toISOString(),
      simulatedUtcNow: simulatedNow.toISOString(),
      utcDayNumberNow: utcNow.utcDayNumber,
      effectiveDayNumber: utcNow.utcDayNumber,
      devTimeOffsetSeconds,
      nextResetUtcMs: computeNextResetFromDayNumber(utcNow.utcDayNumber),
      secondsUntilReset: utcNow.secondsUntilReset,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(c, 400, 'DEV_TIME_READ_FAILED', message);
  }
});

api.post('/dev/time', async (c) => {
  try {
    const { subredditId } = requireSubredditContext();
    try {
      await requireDevAccess();
    } catch (error) {
      if (error instanceof Error && error.message === 'AUTH_REQUIRED') {
        return jsonError(
          c,
          401,
          'AUTH_REQUIRED',
          'You must be logged in to update dev time settings'
        );
      }
      if (error instanceof Error && error.message === 'DEV_MODE_DISABLED') {
        return jsonError(c, 403, 'DEV_MODE_DISABLED', 'Dev mode is disabled.');
      }
      throw error;
    }

    const body = await c.req
      .json<DevTimeRequest>()
      .catch(() => ({} as DevTimeRequest));
    if (
      typeof body.devTimeOffsetSeconds !== 'number' ||
      !Number.isInteger(body.devTimeOffsetSeconds)
    ) {
      return jsonError(
        c,
        400,
        'INVALID_DEV_TIME_OFFSET',
        'devTimeOffsetSeconds must be an integer'
      );
    }

    const devTimeOffsetSeconds = await setDevTimeOffsetSeconds(
      subredditId,
      body.devTimeOffsetSeconds
    );
    const utcNow = await getUtcNow(subredditId);
    const simulatedNow = new Date(utcNow.utcMs);

    return c.json({
      status: 'ok',
      note: 'DEV ONLY: Simulates day changes for testing.',
      serverUtcNow: new Date().toISOString(),
      simulatedUtcNow: simulatedNow.toISOString(),
      utcDayNumberNow: utcNow.utcDayNumber,
      effectiveDayNumber: utcNow.utcDayNumber,
      devTimeOffsetSeconds,
      nextResetUtcMs: computeNextResetFromDayNumber(utcNow.utcDayNumber),
      secondsUntilReset: utcNow.secondsUntilReset,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(c, 400, 'DEV_TIME_WRITE_FAILED', message);
  }
});

api.post('/dev/reset', async (c) => {
  try {
    const { subredditId } = requireSubredditContext();
    const userId = requireUserId();
    try {
      await requireDevAccess();
    } catch (error) {
      if (error instanceof Error && error.message === 'AUTH_REQUIRED') {
        return jsonError(
          c,
          401,
          'AUTH_REQUIRED',
          'You must be logged in to reset dev test data'
        );
      }
      if (error instanceof Error && error.message === 'DEV_MODE_DISABLED') {
        return jsonError(c, 403, 'DEV_MODE_DISABLED', 'Dev mode is disabled.');
      }
      throw error;
    }

    const { stateGeneration } = await resetChallengeProgress(subredditId);
    await clearUserRateLimit(subredditId, userId);
    const utcNow = await getUtcNow(subredditId);
    const simulatedNow = new Date(utcNow.utcMs);
    const devTimeOffsetSeconds = await getDevTimeOffsetSeconds(subredditId);

    return c.json({
      status: 'ok',
      note: 'DEV ONLY: Challenge progress reset for this subreddit.',
      stateGeneration,
      serverUtcNow: new Date().toISOString(),
      simulatedUtcNow: simulatedNow.toISOString(),
      utcDayNumberNow: utcNow.utcDayNumber,
      effectiveDayNumber: utcNow.utcDayNumber,
      devTimeOffsetSeconds,
      nextResetUtcMs: computeNextResetFromDayNumber(utcNow.utcDayNumber),
      secondsUntilReset: utcNow.secondsUntilReset,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(c, 400, 'DEV_RESET_FAILED', message);
  }
});

api.post('/dev/stress', async (c) => {
  try {
    const { subredditId } = requireSubredditContext();
    try {
      await requireDevAccess();
    } catch (error) {
      if (error instanceof Error && error.message === 'AUTH_REQUIRED') {
        return jsonError(
          c,
          401,
          'AUTH_REQUIRED',
          'You must be logged in to run UTC reset stress tests'
        );
      }
      if (error instanceof Error && error.message === 'DEV_MODE_DISABLED') {
        return jsonError(c, 403, 'DEV_MODE_DISABLED', 'Dev mode is disabled.');
      }
      throw error;
    }

    const reports: DevStressReport[] = [];
    const assertStep = (ok: boolean, label: string, details?: string): void => {
      reports.push({ ok, label, details });
    };
    const currentOffset = async (): Promise<number> =>
      await getDevTimeOffsetSeconds(subredditId);
    const setOffset = async (seconds: number): Promise<void> => {
      await setDevTimeOffsetSeconds(subredditId, seconds);
    };
    const shiftOffset = async (deltaSeconds: number): Promise<void> => {
      const nowOffset = await currentOffset();
      await setOffset(nowOffset + deltaSeconds);
    };
    const alignSecondsUntilReset = async (targetSeconds: number): Promise<void> => {
      const utcNow = await getUtcNow(subredditId);
      const nowOffset = await currentOffset();
      const delta = utcNow.secondsUntilReset - targetSeconds;
      await setOffset(nowOffset + delta);
    };

    const runnerId = requireUserId();
    const userA = `${runnerId}:devstress:A`;
    const userB = `${runnerId}:devstress:B`;
    const userC = `${runnerId}:devstress:C`;
    const userD = `${runnerId}:devstress:D`;

    const originalOffset = await currentOffset();
    try {
      // Scenario A
      await alignSecondsUntilReset(30);
      let utcNow = await getUtcNow(subredditId);
      const dayA = utcNow.utcDayNumber;
      await joinChallenge(subredditId, userA, 'private');
      const resultA1 = await recordCheckIn(subredditId, userA, dayA);
      assertStep(
        resultA1 !== null && resultA1.state.lastCheckinDayUTC === dayA,
        'A1 check-in before reset succeeded'
      );
      logStress('A1', { dayA, utcDay: utcNow.utcDayNumber, secondsUntilReset: utcNow.secondsUntilReset });

      await shiftOffset(40);
      utcNow = await getUtcNow(subredditId);
      const stateAAfter = await getUserState(subredditId, userA);
      const checkedInAfterReset =
        stateAAfter?.lastCheckinDayUTC === utcNow.utcDayNumber;
      assertStep(!checkedInAfterReset, 'A2 rollover resets checked-in-today state');
      const statsA = await getChallengeStats(subredditId, utcNow.utcDayNumber);
      assertStep(
        statsA.lastStatsDay === utcNow.utcDayNumber,
        'A3 stats day rolled over',
        `statsDay=${statsA.lastStatsDay}, utcDay=${utcNow.utcDayNumber}`
      );
      assertStep(
        utcNow.secondsUntilReset > 0 && utcNow.secondsUntilReset <= 86_400,
        'A4 countdown reset is valid',
        `secondsUntilReset=${utcNow.secondsUntilReset}`
      );
      logStress('A2', {
        utcDay: utcNow.utcDayNumber,
        secondsUntilReset: utcNow.secondsUntilReset,
        lastCheckinDayUTC: stateAAfter?.lastCheckinDayUTC,
        statsDay: statsA.lastStatsDay,
      });

      // Scenario B
      await alignSecondsUntilReset(20);
      utcNow = await getUtcNow(subredditId);
      await joinChallenge(subredditId, userB, 'private');
      const dayB0 = utcNow.utcDayNumber;
      const bBefore = await recordCheckIn(subredditId, userA, dayB0);
      assertStep(bBefore !== null, 'B1 user A check-in before boundary succeeded');
      await shiftOffset(30);
      utcNow = await getUtcNow(subredditId);
      const dayB1 = utcNow.utcDayNumber;
      const statsBaseline = await getChallengeStats(subredditId, dayB1);
      const bAAfterReset = await recordCheckIn(subredditId, userA, dayB1);
      const bBAfterReset = await recordCheckIn(subredditId, userB, dayB1);
      assertStep(
        bAAfterReset !== null && bBAfterReset !== null,
        'B2 user A and user B check-ins after reset succeeded'
      );
      const statsAfterB = await getChallengeStats(subredditId, dayB1);
      assertStep(
        statsAfterB.checkinsToday === statsBaseline.checkinsToday + 2,
        'B3 checkinsToday reset and incremented for new day',
        `before=${statsBaseline.checkinsToday}, after=${statsAfterB.checkinsToday}`
      );
      const statsBeforeDuplicate = await getChallengeStats(subredditId, dayB1);
      let duplicateBlocked = false;
      try {
        await recordCheckIn(subredditId, userA, dayB1);
      } catch {
        duplicateBlocked = true;
      }
      const statsAfterDuplicate = await getChallengeStats(subredditId, dayB1);
      assertStep(
        duplicateBlocked &&
          statsBeforeDuplicate.checkinsToday === statsAfterDuplicate.checkinsToday,
        'B4 no double-count for same user same day'
      );
      logStress('B', {
        dayBefore: dayB0,
        dayAfter: dayB1,
        checkinsTodayBefore: statsBaseline.checkinsToday,
        checkinsTodayAfter: statsAfterB.checkinsToday,
      });

      // Scenario C
      utcNow = await getUtcNow(subredditId);
      const dayC = utcNow.utcDayNumber;
      await joinChallenge(subredditId, userC, 'private');
      await setUserState(subredditId, userC, {
        joinedAt: new Date(utcNow.utcMs).toISOString(),
        privacy: 'private',
        currentStreak: 5,
        bestStreak: 6,
        streakStartDayUTC: dayC - 5,
        lastCheckinDayUTC: dayC - 2,
        freezeTokens: 1,
        freezeSaves: 0,
        badges: [],
        isParticipant: true,
      });
      const cResult = await recordCheckIn(subredditId, userC, dayC);
      const cStateAfter = await getUserState(subredditId, userC);
      assertStep(
        cResult !== null &&
          cResult.metadata.usedFreeze &&
          cStateAfter?.freezeTokens === 0,
        'C1 freeze consumed and streak preserved'
      );
      await shiftOffset(86_410);
      const cAfterMidnight = await getUtcNow(subredditId);
      const cStateNextDay = await getUserState(subredditId, userC);
      assertStep(
        cStateNextDay?.lastCheckinDayUTC !== cAfterMidnight.utcDayNumber,
        'C2 post-rollover gating remains correct'
      );
      logStress('C', {
        dayBefore: dayC,
        dayAfter: cAfterMidnight.utcDayNumber,
        usedFreeze: cResult?.metadata.usedFreeze,
        freezeTokensAfter: cStateAfter?.freezeTokens,
      });

      // Scenario D
      await alignSecondsUntilReset(10);
      utcNow = await getUtcNow(subredditId);
      const dayD0 = utcNow.utcDayNumber;
      await joinChallenge(subredditId, userD, 'private');
      await setUserState(subredditId, userD, {
        joinedAt: new Date(utcNow.utcMs).toISOString(),
        privacy: 'private',
        currentStreak: 6,
        bestStreak: 6,
        streakStartDayUTC: dayD0 - 6,
        lastCheckinDayUTC: dayD0 - 1,
        freezeTokens: 0,
        freezeSaves: 0,
        badges: [],
        isParticipant: true,
      });
      const dFirst = await recordCheckIn(subredditId, userD, dayD0);
      assertStep(
        dFirst?.metadata.earnedBadge === 'Committed',
        'D1 badge awarded at 7 exactly once'
      );
      await shiftOffset(20);
      utcNow = await getUtcNow(subredditId);
      const dayD1 = utcNow.utcDayNumber;
      const dSecond = await recordCheckIn(subredditId, userD, dayD1);
      const dState = await getUserState(subredditId, userD);
      const committedCount =
        dState?.badges.filter((badge) => badge === 'Committed').length ?? 0;
      assertStep(
        dSecond?.metadata.earnedBadge === null && committedCount === 1,
        'D2 badge not duplicated after rollover check-in',
        `earnedBadge=${String(dSecond?.metadata.earnedBadge)}, committedCount=${committedCount}`
      );
      logStress('D', {
        dayBefore: dayD0,
        dayAfter: dayD1,
        firstEarnedBadge: dFirst?.metadata.earnedBadge,
        secondEarnedBadge: dSecond?.metadata.earnedBadge,
      });
    } finally {
      await setOffset(originalOffset);
    }

    return c.json({
      status: 'ok',
      reports,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(c, 400, 'DEV_STRESS_FAILED', message);
  }
});

api.post('/dev/stats/repair', async (c) => {
  try {
    const { subredditId } = requireSubredditContext();
    try {
      await requireModAccess();
    } catch (error) {
      if (error instanceof Error && error.message === 'AUTH_REQUIRED') {
        return jsonError(
          c,
          401,
          'AUTH_REQUIRED',
          'You must be logged in to repair stats'
        );
      }
      if (error instanceof Error && error.message === 'MODERATOR_REQUIRED') {
        return jsonError(
          c,
          403,
          'MODERATOR_REQUIRED',
          'Only moderators can repair stats'
        );
      }
      if (error instanceof Error && error.message === 'DEV_MODE_DISABLED') {
        return jsonError(c, 403, 'DEV_MODE_DISABLED', 'Dev mode is disabled.');
      }
      throw error;
    }

    const utcNow = await getUtcNow(subredditId);
    const repair = await repairTodayStats(subredditId, utcNow.utcDayNumber);

    return c.json({
      status: 'ok',
      utcDayNumber: utcNow.utcDayNumber,
      oldCheckinsToday: repair.oldStats.checkinsToday,
      newCheckinsToday: repair.newStats.checkinsToday,
      todaySetSize: repair.todaySetSize,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(c, 400, 'DEV_STATS_REPAIR_FAILED', message);
  }
});

api.get('/dev/stats/debug', async (c) => {
  try {
    const { subredditId } = requireSubredditContext();
    try {
      await requireDevAccess();
    } catch (error) {
      if (error instanceof Error && error.message === 'AUTH_REQUIRED') {
        return jsonError(
          c,
          401,
          'AUTH_REQUIRED',
          'You must be logged in to view stats debug snapshot'
        );
      }
      if (error instanceof Error && error.message === 'DEV_MODE_DISABLED') {
        return jsonError(c, 403, 'DEV_MODE_DISABLED', 'Dev mode is disabled.');
      }
      throw error;
    }

    const utcNow = await getUtcNow(subredditId);
    const stats = await getChallengeStats(subredditId, utcNow.utcDayNumber);
    const todaySetSize = await getTodayCheckinsCount(subredditId, utcNow.utcDayNumber);

    return c.json({
      status: 'ok',
      utcDayNumber: utcNow.utcDayNumber,
      lastStatsDay: stats.lastStatsDay,
      participantsTotal: stats.participantsTotal,
      checkinsToday: stats.checkinsToday,
      checkinsAllTime: stats.checkinsAllTime,
      longestStreakAllTime: stats.longestStreakAllTime,
      todaySetSize,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(c, 400, 'DEV_STATS_DEBUG_FAILED', message);
  }
});

api.get('/leaderboard', async (c) => {
  try {
    const { subredditId } = requireSubredditContext();
    const rawLimit = c.req.query('limit');
    const parsedLimit = rawLimit ? Number.parseInt(rawLimit, 10) : 25;
    const limit =
      Number.isNaN(parsedLimit) || parsedLimit <= 0
        ? 25
        : Math.min(parsedLimit, 100);

    const rows = await getLeaderboard(subredditId, limit);
    const storedUsernames = await getStoredUsernames(subredditId);

    const users = await Promise.all(
      rows.map(async (row) => {
        const storedUsername = storedUsernames[row.userId];
        let resolvedName = storedUsername;
        if (!resolvedName) {
          const user = await reddit.getUserById(row.userId as `t2_${string}`);
          resolvedName = user?.displayName ?? user?.username;
        }
        return {
          userId: row.userId,
          displayName: resolvedName,
          currentStreak: row.currentStreak,
          streakStartDayUTC: row.streakStartDayUTC,
        };
      })
    );

    return c.json({
      status: 'ok',
      leaderboard: users,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(c, 400, 'LEADERBOARD_FAILED', message);
  }
});
