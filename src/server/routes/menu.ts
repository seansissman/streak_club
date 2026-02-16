import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createPost } from '../core/post';
import {
  getChallengeConfig,
  isConfigSetupRequired,
  setActiveTrackerPostId,
} from '../core/streak';

export const menu = new Hono();

type PostCreateUiResponse = UiResponse & {
  activePostId?: string;
};

menu.post('/post-create', async (c) => {
  try {
    const subredditId = context.subredditId;
    if (!subredditId) {
      throw new Error('subreddit context is required');
    }

    const config = await getChallengeConfig(subredditId);
    if (config.activePostId) {
      return c.json<PostCreateUiResponse>(
        {
          showToast:
            'A streak tracker already exists. Open the existing tracker instead.',
          activePostId: config.activePostId,
          navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${config.activePostId}`,
        },
        200
      );
    }

    const needsSetup = isConfigSetupRequired(config);

    if (needsSetup) {
      const setupPost = await createPost('Set up your challenge template');
      await setActiveTrackerPostId(subredditId, setupPost.id);
      return c.json<PostCreateUiResponse>(
        {
          navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${setupPost.id}`,
          showToast:
            'Choose a template and save config in the mod panel, then create the challenge post.',
          activePostId: setupPost.id,
        },
        200
      );
    }

    const post = await createPost(config.title);
    await setActiveTrackerPostId(subredditId, post.id);

    return c.json<PostCreateUiResponse>(
      {
        navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${post.id}`,
        showToast: `Created challenge post: ${config.title}`,
        activePostId: post.id,
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
