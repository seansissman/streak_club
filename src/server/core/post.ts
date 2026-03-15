import { reddit } from '@devvit/web/server';

const DEFAULT_POST_TITLE = 'Streak Challenge';
const MAX_POST_TITLE_LENGTH = 120;
const T3_PREFIX = 't3_';
const BASE36_ID_PATTERN = /^[a-z0-9]+$/i;
const T3_POST_ID_PATTERN = /^t3_[a-z0-9]+$/i;

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

const isT3PostId = (value: string): value is `t3_${string}` =>
  T3_POST_ID_PATTERN.test(value);

const toPrefixedPostId = (postId: string): `t3_${string}` | null => {
  const normalized = postId.trim();
  if (!normalized) {
    return null;
  }

  const withoutPrefix = normalized.startsWith(T3_PREFIX)
    ? normalized.slice(T3_PREFIX.length)
    : normalized;
  if (!withoutPrefix || !BASE36_ID_PATTERN.test(withoutPrefix)) {
    return null;
  }

  const candidate = `${T3_PREFIX}${withoutPrefix.toLowerCase()}`;
  return isT3PostId(candidate) ? candidate : null;
};

export const isTrackerPostAccessible = async (
  postId: string,
  subredditId: string
): Promise<boolean> => {
  const normalizedPostId = toPrefixedPostId(postId);
  if (!normalizedPostId) {
    return false;
  }

  try {
    const post = await reddit.getPostById(normalizedPostId);
    return post.subredditId === subredditId;
  } catch {
    return false;
  }
};
