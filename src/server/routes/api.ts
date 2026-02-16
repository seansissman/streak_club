import { Hono } from 'hono';
import type { Context as HonoContext } from 'hono';
import { context, reddit } from '@devvit/web/server';
import {
  computeNextResetFromDayNumber,
  computeNextResetUTC,
  ensureChallengeConfig,
  getDevDayOffset,
  getTodayDayNumber,
  getChallengeStats,
  getLeaderboard,
  getUserState,
  joinChallenge,
  recordCheckIn,
  setChallengeConfig,
  setDevDayOffset,
  setPrivacy,
  utcDayNumber,
  type Privacy,
  type UserState,
} from '../core/streak';

type ErrorResponse = {
  status: 'error';
  code: string;
  message: string;
  state?: UserState | null;
};

type ConfigRequest = {
  title?: string;
  description?: string;
};

type PrivacyRequest = {
  privacy?: Privacy;
};

type DevTimeRequest = {
  devDayOffset?: number;
};

type HttpStatus = 400 | 401 | 403 | 404 | 409 | 500;

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

const checkedInToday = (state: UserState | null, day: number): boolean =>
  state?.lastCheckinDayUTC === day;

const canCheckInToday = (state: UserState | null, day: number): boolean => {
  if (!state || state.lastCheckinDayUTC === null) {
    return true;
  }

  return day > state.lastCheckinDayUTC;
};

const isModerator = async (
  subredditName: string,
  username: string
): Promise<boolean> => {
  const moderators = await reddit
    .getModerators({
      subredditName,
      username,
      limit: 1,
      pageSize: 1,
    })
    .all();

  return moderators.some(
    (mod) => mod.username.toLowerCase() === username.toLowerCase()
  );
};

const requireModerator = async (
  subredditName: string
): Promise<{ username: string }> => {
  const username = context.username;
  if (!username) {
    throw new Error('AUTH_REQUIRED');
  }

  if (!(await isModerator(subredditName, username))) {
    throw new Error('MODERATOR_REQUIRED');
  }

  return { username };
};

export const api = new Hono();

api.get('/config', async (c) => {
  try {
    const { subredditId } = requireSubredditContext();
    const today = await getTodayDayNumber(subredditId);
    const config = await ensureChallengeConfig(subredditId);
    const stats = await getChallengeStats(subredditId, today);

    return c.json({
      status: 'ok',
      config,
      stats,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(c, 400, 'CONFIG_READ_FAILED', message);
  }
});

api.post('/config', async (c) => {
  try {
    const { subredditId, subredditName } = requireSubredditContext();
    try {
      await requireModerator(subredditName);
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
    const title = body.title?.trim();
    const description = body.description?.trim();

    if (!title || !description) {
      return jsonError(
        c,
        400,
        'INVALID_CONFIG',
        'title and description are required'
      );
    }

    const config = await setChallengeConfig(subredditId, {
      title,
      description,
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

    await ensureChallengeConfig(subredditId);

    const today = await getTodayDayNumber(subredditId);
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
      state: savedState,
      checkedInToday: true,
      nextResetUtcTimestamp: computeNextResetUTC(new Date()),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(c, 401, 'CHECKIN_FAILED', message);
  }
});

api.get('/me', async (c) => {
  try {
    const { subredditId, subredditName } = requireSubredditContext();
    const userId = requireUserId();

    const state = await getUserState(subredditId, userId);
    const now = new Date();
    const today = await getTodayDayNumber(subredditId, now);
    const username = context.username;
    const moderator =
      typeof username === 'string' && username.length > 0
        ? await isModerator(subredditName, username)
        : false;

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
      nextResetUtcTimestamp: computeNextResetUTC(now),
      myRank,
      isModerator: moderator,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(c, 401, 'ME_FAILED', message);
  }
});

api.get('/dev/time', async (c) => {
  try {
    const { subredditId } = requireSubredditContext();
    const now = new Date();
    const utcDayNumberNow = utcDayNumber(now);
    const devDayOffset = await getDevDayOffset(subredditId);
    const effectiveDayNumber = await getTodayDayNumber(subredditId, now);

    return c.json({
      status: 'ok',
      note: 'DEV ONLY: Simulates day changes for testing.',
      serverUtcNow: now.toISOString(),
      utcDayNumberNow,
      devDayOffset,
      effectiveDayNumber,
      nextResetUtcMs: computeNextResetFromDayNumber(effectiveDayNumber),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(c, 400, 'DEV_TIME_READ_FAILED', message);
  }
});

api.post('/dev/time', async (c) => {
  try {
    const { subredditId, subredditName } = requireSubredditContext();
    try {
      await requireModerator(subredditName);
    } catch (error) {
      if (error instanceof Error && error.message === 'AUTH_REQUIRED') {
        return jsonError(
          c,
          401,
          'AUTH_REQUIRED',
          'You must be logged in to update dev time settings'
        );
      }
      if (error instanceof Error && error.message === 'MODERATOR_REQUIRED') {
        return jsonError(
          c,
          403,
          'MODERATOR_REQUIRED',
          'Only moderators can update dev time settings'
        );
      }
      throw error;
    }

    const body = await c.req
      .json<DevTimeRequest>()
      .catch(() => ({} as DevTimeRequest));
    if (typeof body.devDayOffset !== 'number' || !Number.isInteger(body.devDayOffset)) {
      return jsonError(
        c,
        400,
        'INVALID_DEV_DAY_OFFSET',
        'devDayOffset must be an integer'
      );
    }

    const devDayOffset = await setDevDayOffset(subredditId, body.devDayOffset);
    const now = new Date();
    const utcDayNumberNow = utcDayNumber(now);
    const effectiveDayNumber = await getTodayDayNumber(subredditId, now);

    return c.json({
      status: 'ok',
      note: 'DEV ONLY: Simulates day changes for testing.',
      serverUtcNow: now.toISOString(),
      utcDayNumberNow,
      devDayOffset,
      effectiveDayNumber,
      nextResetUtcMs: computeNextResetFromDayNumber(effectiveDayNumber),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(c, 400, 'DEV_TIME_WRITE_FAILED', message);
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

    const users = await Promise.all(
      rows.map(async (row) => {
        const user = await reddit.getUserById(row.userId as `t2_${string}`);
        return {
          userId: row.userId,
          displayName: user?.displayName ?? user?.username,
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
