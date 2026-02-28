import { reddit } from '@devvit/web/server';

type ContextLike = {
  username?: string;
  subredditName?: string;
  subredditId?: string;
  user?: {
    username?: string;
  };
  subreddit?: {
    name?: string;
    id?: string;
  };
};

export type ModeratorCheckDebug = {
  usernameUsed: string | null;
  subredditNameUsed: string | null;
  subredditIdUsed: string | null;
  apiMethod: string;
  moderatorsReturned: number;
  usernameMatched: boolean;
  error: string | null;
};

const normalizeNonEmpty = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isT5Id = (value: string): value is `t5_${string}` =>
  value.startsWith('t5_');

const asContextLike = (ctx: unknown): ContextLike =>
  typeof ctx === 'object' && ctx !== null ? (ctx as ContextLike) : {};

const resolveUsername = async (ctx: unknown): Promise<string | null> => {
  const contextValue = asContextLike(ctx);
  const fromContext =
    normalizeNonEmpty(contextValue.username) ??
    normalizeNonEmpty(contextValue.user?.username);
  if (fromContext) {
    return fromContext;
  }

  try {
    return normalizeNonEmpty(await reddit.getCurrentUsername());
  } catch {
    return null;
  }
};

const resolveSubredditName = async (ctx: unknown): Promise<{
  subredditName: string | null;
  subredditId: string | null;
}> => {
  const contextValue = asContextLike(ctx);
  const subredditId =
    normalizeNonEmpty(contextValue.subredditId) ??
    normalizeNonEmpty(contextValue.subreddit?.id);
  const fromContextName =
    normalizeNonEmpty(contextValue.subredditName) ??
    normalizeNonEmpty(contextValue.subreddit?.name);
  if (fromContextName) {
    return { subredditName: fromContextName, subredditId };
  }

  if (!subredditId) {
    return { subredditName: null, subredditId: null };
  }

  if (!isT5Id(subredditId)) {
    return { subredditName: null, subredditId };
  }

  try {
    const info = await reddit.getSubredditInfoById(subredditId);
    return {
      subredditName: normalizeNonEmpty(info.name),
      subredditId,
    };
  } catch {
    return { subredditName: null, subredditId };
  }
};

export const getModeratorCheckDebug = async (
  ctx: unknown
): Promise<ModeratorCheckDebug> => {
  const username = await resolveUsername(ctx);
  const { subredditName, subredditId } = await resolveSubredditName(ctx);
  const debug: ModeratorCheckDebug = {
    usernameUsed: username,
    subredditNameUsed: subredditName,
    subredditIdUsed: subredditId,
    apiMethod: 'reddit.getModerators({ subredditName, username }).all()',
    moderatorsReturned: 0,
    usernameMatched: false,
    error: null,
  };

  if (!username || !subredditName) {
    debug.error = 'MISSING_CONTEXT_IDENTIFIERS';
    return debug;
  }

  try {
    const moderators = await reddit
      .getModerators({
        subredditName,
        username,
      })
      .all();
    const normalized = username.toLowerCase();
    const matched = moderators.some(
      (mod) => mod.username.toLowerCase() === normalized
    );
    debug.moderatorsReturned = moderators.length;
    debug.usernameMatched = matched;
    return debug;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    debug.error = message;
    console.warn(
      `[moderation] failed to verify moderator username=${username} subreddit=${subredditName} subredditId=${subredditId ?? 'null'} error=${message}`
    );
    return debug;
  }
};

export const isModerator = async (ctx: unknown): Promise<boolean> => {
  const debug = await getModeratorCheckDebug(ctx);
  return debug.usernameMatched;
};
