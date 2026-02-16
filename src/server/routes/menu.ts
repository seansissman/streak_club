import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createPost } from '../core/post';
import { getChallengeConfig, isConfigSetupRequired } from '../core/streak';

export const menu = new Hono();

menu.post('/post-create', async (c) => {
  try {
    const subredditId = context.subredditId;
    if (!subredditId) {
      throw new Error('subreddit context is required');
    }

    const config = await getChallengeConfig(subredditId);
    const needsSetup = isConfigSetupRequired(config);

    if (needsSetup) {
      const setupPost = await createPost('Set up your challenge template');
      return c.json<UiResponse>(
        {
          navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${setupPost.id}`,
          showToast:
            'Choose a template and save config in the mod panel, then create the challenge post.',
        },
        200
      );
    }

    const post = await createPost(config.title);

    return c.json<UiResponse>(
      {
        navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${post.id}`,
        showToast: `Created challenge post: ${config.title}`,
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
