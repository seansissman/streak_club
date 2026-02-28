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

const runModeratorCheck = async (
  ctx: unknown
): Promise<{
  username: string | null;
  subredditName: string | null;
  subredditId: string | null;
  isMatch: boolean;
}> => {
  const username = await resolveUsername(ctx);
  const { subredditName, subredditId } = await resolveSubredditName(ctx);

  if (!username || !subredditName) {
    return { username, subredditName, subredditId, isMatch: false };
  }

  try {
    const moderators = await reddit
      .getModerators({
        subredditName,
        username,
      })
      .all();
    const normalized = username.toLowerCase();
    const isMatch = moderators.some(
      (mod) => mod.username.toLowerCase() === normalized
    );
    return { username, subredditName, subredditId, isMatch };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.warn(
      `[moderation] failed to verify moderator username=${username} subreddit=${subredditName} subredditId=${subredditId ?? 'null'} error=${message}`
    );
    return { username, subredditName, subredditId, isMatch: false };
  }
};

export const isModerator = async (ctx: unknown): Promise<boolean> => {
  const result = await runModeratorCheck(ctx);
  return result.isMatch;
};
