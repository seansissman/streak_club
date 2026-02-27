import { reddit, settings } from '@devvit/web/server';

export type AccessLevel = 'user' | 'mod' | 'dev';

export const normalizeUsername = (value: string): string => {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith('u/')) {
    return trimmed.slice(2);
  }

  return trimmed;
};

export const parseDevUsernames = (value: string | undefined): Set<string> => {
  if (!value) {
    return new Set<string>();
  }

  return new Set(
    value
      .split(',')
      .map((entry) => normalizeUsername(entry))
      .filter((entry) => entry.length > 0)
  );
};

const getContextUsername = (ctx: unknown): string | null => {
  if (typeof ctx !== 'object' || ctx === null) {
    return null;
  }

  if ('username' in ctx && typeof ctx.username === 'string') {
    const normalized = normalizeUsername(ctx.username);
    return normalized.length > 0 ? normalized : null;
  }

  if (
    'user' in ctx &&
    typeof ctx.user === 'object' &&
    ctx.user !== null &&
    'username' in ctx.user &&
    typeof ctx.user.username === 'string'
  ) {
    const normalized = normalizeUsername(ctx.user.username);
    return normalized.length > 0 ? normalized : null;
  }

  return null;
};

const getContextSubredditName = (ctx: unknown): string | null => {
  if (
    typeof ctx === 'object' &&
    ctx !== null &&
    'subredditName' in ctx &&
    typeof ctx.subredditName === 'string' &&
    ctx.subredditName.trim().length > 0
  ) {
    return ctx.subredditName;
  }

  return null;
};

const isModerator = async (
  subredditName: string,
  username: string
): Promise<boolean> => {
  try {
    const mods = await reddit
      .getModerators({
        subredditName,
        username,
        limit: 1,
        pageSize: 1,
      })
      .all();

    return mods.some((mod) => normalizeUsername(mod.username) === username);
  } catch {
    return false;
  }
};

export const getAccessLevel = async (ctx: unknown): Promise<AccessLevel> => {
  const username = getContextUsername(ctx);
  if (!username) {
    return 'user';
  }

  let allowlistRaw: string | undefined;
  try {
    allowlistRaw = await settings.get<string>('dev_usernames');
  } catch {
    allowlistRaw = undefined;
  }

  if (parseDevUsernames(allowlistRaw).has(username)) {
    return 'dev';
  }

  const subredditName = getContextSubredditName(ctx);
  if (!subredditName) {
    return 'user';
  }

  return (await isModerator(subredditName, username)) ? 'mod' : 'user';
};

export const isMod = (level: AccessLevel): boolean =>
  level === 'mod' || level === 'dev';

export const isDev = (level: AccessLevel): boolean => level === 'dev';
