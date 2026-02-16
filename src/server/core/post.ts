import { reddit } from '@devvit/web/server';

const DEFAULT_POST_TITLE = 'Streak Challenge';
const MAX_POST_TITLE_LENGTH = 120;

const derivePostTitle = (inputTitle?: string): string => {
  const normalized = inputTitle?.trim();
  if (!normalized) {
    return DEFAULT_POST_TITLE;
  }

  if (normalized.length <= MAX_POST_TITLE_LENGTH) {
    return normalized;
  }

  return normalized.slice(0, MAX_POST_TITLE_LENGTH).trimEnd();
};

export const createPost = async (title?: string) => {
  return await reddit.submitCustomPost({
    title: derivePostTitle(title),
  });
};
