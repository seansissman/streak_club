import { Hono } from 'hono';
import { context } from '@devvit/web/server';
import {
  applyCheckIn,
  canCheckIn,
  ensureChallengeConfig,
  getLeaderboard,
  getUserState,
  joinChallenge,
  recordCheckIn,
  setPrivacy,
  utcDayNumber,
  type Privacy,
} from '../core/streak';

type ErrorResponse = {
  status: 'error';
  message: string;
};

type JoinRequest = {
  privacy?: Privacy;
};

type PrivacyRequest = {
  privacy: Privacy;
};

const parsePrivacy = (value: unknown): Privacy =>
  value === 'private' ? 'private' : 'public';

const requireSubredditId = (): string => {
  if (!context.subredditId) {
    throw new Error('subredditId is required in context');
  }

  return context.subredditId;
};

const requireUserId = (): string => {
  if (!context.userId) {
    throw new Error('userId is required in context');
  }

  return context.userId;
};

export const api = new Hono();

api.get('/challenge', async (c) => {
  try {
    const subredditId = requireSubredditId();
    const challenge = await ensureChallengeConfig(subredditId);

    return c.json({
      type: 'challenge',
      challenge,
      subredditId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

api.get('/me', async (c) => {
  try {
    const subredditId = requireSubredditId();
    const userId = requireUserId();

    await ensureChallengeConfig(subredditId);

    const day = utcDayNumber(new Date());
    const user = await getUserState(subredditId, userId);

    return c.json({
      type: 'me',
      userId,
      user,
      utcDay: day,
      canCheckIn: user ? canCheckIn(user, day) : false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json<ErrorResponse>({ status: 'error', message }, 401);
  }
});

api.post('/join', async (c) => {
  try {
    const subredditId = requireSubredditId();
    const userId = requireUserId();

    await ensureChallengeConfig(subredditId);

    const input = await c.req
      .json<JoinRequest>()
      .catch(() => ({} as JoinRequest));
    const privacy = parsePrivacy(input.privacy);
    const user = await joinChallenge(subredditId, userId, privacy);

    return c.json({
      type: 'join',
      userId,
      user,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json<ErrorResponse>({ status: 'error', message }, 401);
  }
});

api.post('/check-in', async (c) => {
  try {
    const subredditId = requireSubredditId();
    const userId = requireUserId();

    await ensureChallengeConfig(subredditId);

    const day = utcDayNumber(new Date());
    const existing = await getUserState(subredditId, userId);
    if (!existing) {
      return c.json<ErrorResponse>(
        {
          status: 'error',
          message: 'You must join the challenge before checking in',
        },
        403
      );
    }

    if (!canCheckIn(existing, day)) {
      return c.json<ErrorResponse>(
        {
          status: 'error',
          message: 'You already checked in for this UTC day',
        },
        409
      );
    }

    const updated = await recordCheckIn(subredditId, userId, day);
    if (!updated) {
      return c.json<ErrorResponse>(
        {
          status: 'error',
          message: 'Failed to persist check-in',
        },
        500
      );
    }

    return c.json({
      type: 'check-in',
      userId,
      user: updated,
      utcDay: day,
      previewNext: applyCheckIn(updated, day + 1),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json<ErrorResponse>({ status: 'error', message }, 401);
  }
});

api.post('/privacy', async (c) => {
  try {
    const subredditId = requireSubredditId();
    const userId = requireUserId();
    const input = await c.req.json<PrivacyRequest>();

    const privacy = parsePrivacy(input.privacy);
    const user = await setPrivacy(subredditId, userId, privacy);
    if (!user) {
      return c.json<ErrorResponse>(
        {
          status: 'error',
          message: 'You must join before changing privacy settings',
        },
        404
      );
    }

    return c.json({
      type: 'privacy',
      userId,
      user,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json<ErrorResponse>({ status: 'error', message }, 401);
  }
});

api.get('/leaderboard', async (c) => {
  try {
    const subredditId = requireSubredditId();
    await ensureChallengeConfig(subredditId);

    const leaderboard = await getLeaderboard(subredditId, 25);

    return c.json({
      type: 'leaderboard',
      subredditId,
      leaderboard,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

api.get('/init', async (c) => {
  try {
    const subredditId = requireSubredditId();
    const challenge = await ensureChallengeConfig(subredditId);

    const userId = context.userId;
    const day = utcDayNumber(new Date());
    const user = userId ? await getUserState(subredditId, userId) : null;

    return c.json({
      type: 'init',
      challenge,
      user,
      utcDay: day,
      canCheckIn: user ? canCheckIn(user, day) : false,
      leaderboard: await getLeaderboard(subredditId, 25),
      username: context.username ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});
