import type { Context as DevvitContext } from '@devvit/web/server';

const STAGING_SUBREDDIT_IDS = new Set(['t5_gqefuq']);

export const isStagingSubreddit = (ctx: DevvitContext): boolean =>
  STAGING_SUBREDDIT_IDS.has(ctx.subredditId);
