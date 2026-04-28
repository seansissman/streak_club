import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createPost, isTrackerPostAccessible } from '../core/post';
import {
  getChallengeConfig,
  isConfigSetupRequired,
  setActiveTrackerPostId,
} from '../core/streak';
import { isModerator } from '../moderation';

export const menu = new Hono();

const toRedditCommentsUrl = (postId: string): string => {
  const barePostId = postId.startsWith('t3_') ? postId.slice(3) : postId;
  return `https://reddit.com/r/${context.subredditName}/comments/${barePostId}`;
};

menu.post('/post-create', async (c) => {
  try {
    const subredditId = context.subredditId;
    if (!subredditId) {
      throw new Error('subreddit context is required');
    }
    if (!(await isModerator(context))) {
      return c.json<UiResponse>(
        {
          showToast: 'Only subreddit moderators can create or open the Streak Club tracker.',
        },
        403
      );
    }

    let config = await getChallengeConfig(subredditId);
    const hadStaleActivePost = Boolean(config.activePostId);
    if (
      config.activePostId &&
      !(await isTrackerPostAccessible(config.activePostId, subredditId))
    ) {
      config = await setActiveTrackerPostId(subredditId, null);
    }

    if (config.activePostId) {
      return c.json<UiResponse>(
        {
          showToast: 'Opened the existing Streak Club tracker.',
          navigateTo: toRedditCommentsUrl(config.activePostId),
        },
        200
      );
    }

    const needsSetup = isConfigSetupRequired(config);

    if (needsSetup) {
      const setupPost = await createPost('Set up your challenge template');
      await setActiveTrackerPostId(subredditId, setupPost.id);
      return c.json<UiResponse>(
        {
          navigateTo: toRedditCommentsUrl(setupPost.id),
          showToast:
            'Complete setup in the tracker post before inviting members.',
        },
        200
      );
    }

    const post = await createPost(config.title);
    await setActiveTrackerPostId(subredditId, post.id);

    return c.json<UiResponse>(
      {
        navigateTo: toRedditCommentsUrl(post.id),
        showToast: hadStaleActivePost
          ? 'The previous tracker was no longer accessible, so a new one was created.'
          : 'Created a new Streak Club tracker.',
      },
      200
    );
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json<UiResponse>(
      {
        showToast: 'Failed to create post',
      },
      400
    );
  }
});
