import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

type MockContext = {
  userId: string;
  username: string;
  subredditId: string;
  subredditName: string;
};

type HashValue = Record<string, string>;

type SortedSetEntry = {
  member: string;
  score: number;
};

type ZRangeOptions = {
  reverse?: boolean;
};

type MockPost = {
  id: string;
  subredditId: string;
  title: string;
};

type MockUser = {
  username: string;
  displayName: string;
};

type ApiRoute = {
  request: (path: string, init?: RequestInit) => Response | Promise<Response>;
};

type StreakCore = typeof import('../core/streak');

const DEFAULT_CONTEXT: MockContext = {
  userId: 't2_user_a',
  username: 'user_a',
  subredditId: 't5_sub',
  subredditName: 'streak_club',
};

const BASE_NOW = new Date('2026-02-15T12:00:00.000Z');
const DAY_SECONDS = 86_400;

const context: MockContext = { ...DEFAULT_CONTEXT };

class FakeRedis {
  readonly strings = new Map<string, string>();
  readonly hashes = new Map<string, Map<string, string>>();
  readonly sortedSets = new Map<string, Map<string, number>>();

  clear(): void {
    this.strings.clear();
    this.hashes.clear();
    this.sortedSets.clear();
  }

  async get(key: string): Promise<string | undefined> {
    return this.strings.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    this.strings.set(key, String(value));
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      const removed =
        this.strings.delete(key) ||
        this.hashes.delete(key) ||
        this.sortedSets.delete(key);
      if (removed) {
        deleted += 1;
      }
    }
    return deleted;
  }

  async hGet(key: string, field: string): Promise<string | undefined> {
    return this.hashes.get(key)?.get(field);
  }

  async hGetAll(key: string): Promise<HashValue> {
    const hash = this.hashes.get(key);
    if (!hash) {
      return {};
    }

    return Object.fromEntries(hash.entries());
  }

  async hSet(key: string, values: HashValue): Promise<number> {
    let hash = this.hashes.get(key);
    if (!hash) {
      hash = new Map<string, string>();
      this.hashes.set(key, hash);
    }

    let added = 0;
    for (const [field, value] of Object.entries(values)) {
      if (!hash.has(field)) {
        added += 1;
      }
      hash.set(field, String(value));
    }
    return added;
  }

  async hLen(key: string): Promise<number> {
    return this.hashes.get(key)?.size ?? 0;
  }

  async hIncrBy(key: string, field: string, increment: number): Promise<number> {
    const current = Number.parseInt((await this.hGet(key, field)) ?? '0', 10);
    const next = (Number.isNaN(current) ? 0 : current) + increment;
    await this.hSet(key, { [field]: String(next) });
    return next;
  }

  async zAdd(key: string, entry: SortedSetEntry): Promise<void> {
    let set = this.sortedSets.get(key);
    if (!set) {
      set = new Map<string, number>();
      this.sortedSets.set(key, set);
    }
    set.set(entry.member, entry.score);
  }

  async zRem(key: string, members: string[]): Promise<number> {
    const set = this.sortedSets.get(key);
    if (!set) {
      return 0;
    }

    let removed = 0;
    for (const member of members) {
      if (set.delete(member)) {
        removed += 1;
      }
    }
    return removed;
  }

  async zRange(
    key: string,
    start: number,
    stop: number,
    options?: ZRangeOptions
  ): Promise<SortedSetEntry[]> {
    const set = this.sortedSets.get(key);
    if (!set) {
      return [];
    }

    const sorted = Array.from(set.entries())
      .map(([member, score]) => ({ member, score }))
      .sort((a, b) => {
        if (a.score !== b.score) {
          return a.score - b.score;
        }
        return a.member.localeCompare(b.member);
      });

    const ordered = options?.reverse ? sorted.reverse() : sorted;
    const inclusiveStop = stop < 0 ? ordered.length : stop + 1;
    return ordered.slice(start, inclusiveStop);
  }
}

class FakeReddit {
  readonly moderators = new Set<string>();
  readonly users = new Map<string, MockUser>();
  readonly posts = new Map<string, MockPost>();
  postSequence = 0;

  clear(): void {
    this.moderators.clear();
    this.users.clear();
    this.posts.clear();
    this.postSequence = 0;
  }

  addModerator(username: string): void {
    this.moderators.add(username.toLowerCase());
  }

  getModerators(input: { username: string }): { all: () => Promise<MockUser[]> } {
    return {
      all: async () => {
        if (!this.moderators.has(input.username.toLowerCase())) {
          return [];
        }
        return [
          {
            username: input.username,
            displayName: input.username,
          },
        ];
      },
    };
  }

  async getCurrentUsername(): Promise<string> {
    return context.username;
  }

  async getSubredditInfoById(subredditId: string): Promise<{ name: string; id: string }> {
    return {
      id: subredditId,
      name: context.subredditName,
    };
  }

  async getUserById(userId: string): Promise<MockUser> {
    return (
      this.users.get(userId) ?? {
        username: userId,
        displayName: userId,
      }
    );
  }

  async getPostById(postId: string): Promise<MockPost> {
    const post = this.posts.get(postId);
    if (!post) {
      throw new Error(`missing post ${postId}`);
    }
    return post;
  }

  async submitCustomPost(input: { title: string }): Promise<MockPost> {
    this.postSequence += 1;
    const post = {
      id: `t3_post${this.postSequence}`,
      subredditId: context.subredditId,
      title: input.title,
    };
    this.posts.set(post.id, post);
    return post;
  }
}

const redis = new FakeRedis();
const reddit = new FakeReddit();

vi.doMock('@devvit/web/server', () => ({
  context,
  reddit,
  redis,
}));

const resetHarness = (): void => {
  redis.clear();
  reddit.clear();
  Object.assign(context, DEFAULT_CONTEXT);
  vi.useFakeTimers();
  vi.setSystemTime(BASE_NOW);
};

const loadServer = async (
  overrides: Partial<MockContext> = {}
): Promise<{ api: ApiRoute; menu: ApiRoute; streak: StreakCore }> => {
  vi.resetModules();
  resetHarness();
  Object.assign(context, overrides);
  const apiModule = await import('./api');
  const menuModule = await import('./menu');
  const streak = await import('../core/streak');
  return { api: apiModule.api, menu: menuModule.menu, streak };
};

const BASIC_USER_CONTEXT: Partial<MockContext> = {
  userId: 't2_basic_user',
  username: 'basic_user',
  subredditId: 't5_prod',
  subredditName: 'streak_club',
};

const NORMAL_MODERATOR_CONTEXT: Partial<MockContext> = {
  userId: 't2_mod_user',
  username: 'mod_user',
  subredditId: 't5_prod',
  subredditName: 'streak_club',
};

const STAGING_MODERATOR_CONTEXT: Partial<MockContext> = {
  userId: 't2_mod_user',
  username: 'mod_user',
  subredditId: 't5_gqefuq',
  subredditName: 'streak_club',
};

const PLAYTEST_DEV_CONTEXT: Partial<MockContext> = {
  userId: 't2_dev_user',
  username: 'dev_user',
  subredditId: 't5_dev',
  subredditName: 'streak_club_dev',
};

const validConfigBody = (): Record<string, unknown> => ({
  templateId: 'habit_30',
  title: 'Streak Club',
  description: 'Build the daily streak.',
  badgeThresholds: [7, 30],
});

const configureChallenge = async (streak: StreakCore): Promise<void> => {
  await streak.setChallengeConfig(context.subredditId, {
    templateId: 'habit_30',
    title: 'Streak Club',
    description: 'Build the daily streak.',
    badgeThresholds: [7, 30],
  });
};

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

const postJson = (body: Record<string, unknown> = {}): RequestInit => ({
  method: 'POST',
  headers: {
    'content-type': 'application/json',
  },
  body: JSON.stringify(body),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isRecordArray = (value: unknown): value is Array<Record<string, unknown>> =>
  Array.isArray(value) && value.every(isRecord);

const jsonRecord = async (response: Response): Promise<Record<string, unknown>> => {
  const payload: unknown = await response.json();
  if (!isRecord(payload)) {
    throw new Error('Expected response JSON object');
  }
  return payload;
};

const recordField = (
  record: Record<string, unknown>,
  field: string
): Record<string, unknown> => {
  const value = record[field];
  if (!isRecord(value)) {
    throw new Error(`Expected object field ${field}`);
  }
  return value;
};

const arrayField = (
  record: Record<string, unknown>,
  field: string
): Array<Record<string, unknown>> => {
  const value = record[field];
  if (!isRecordArray(value)) {
    throw new Error(`Expected array field ${field}`);
  }
  return value;
};

const numberField = (record: Record<string, unknown>, field: string): number => {
  const value = record[field];
  if (typeof value !== 'number') {
    throw new Error(`Expected number field ${field}`);
  }
  return value;
};

const stringField = (record: Record<string, unknown>, field: string): string => {
  const value = record[field];
  if (typeof value !== 'string') {
    throw new Error(`Expected string field ${field}`);
  }
  return value;
};

const validUiResponseKeys = ['navigateTo', 'showToast', 'showForm'];

const expectUiResponseKeys = (
  body: Record<string, unknown>,
  expectedKeys: string[]
): void => {
  const actualKeys = Object.keys(body).sort();
  for (const key of actualKeys) {
    expect(validUiResponseKeys).toContain(key);
  }
  expect(actualKeys).toEqual(expectedKeys.slice().sort());
};

const setActor = (userId: string, username: string): void => {
  context.userId = userId;
  context.username = username;
};

const advanceWallClock = (seconds: number): void => {
  vi.setSystemTime(new Date(Date.now() + seconds * 1000));
};

describe('api route integration behavior', () => {
  it('keeps the subreddit moderator menu label specific to tracker recovery', () => {
    const configText = readFileSync('devvit.json', 'utf8');

    expect(configText).toContain('"label": "Create/Open Streak Club Tracker"');
    expect(configText).not.toContain('"label": "Create a new post"');
  });

  it('rejects non-moderators using the tracker creation menu route', async () => {
    const { menu } = await loadServer(BASIC_USER_CONTEXT);

    const response = await menu.request('/post-create', postJson());
    const body = await jsonRecord(response);

    expect(response.status).toBe(403);
    expectUiResponseKeys(body, ['showToast']);
    expect(body.showToast).toBe(
      'Only subreddit moderators can create or open the Streak Club tracker.'
    );
    expect(reddit.posts.size).toBe(0);
  });

  it('opens the existing tracker from the menu route without creating a duplicate', async () => {
    const { menu, streak } = await loadServer(NORMAL_MODERATOR_CONTEXT);
    reddit.addModerator('mod_user');
    await configureChallenge(streak);
    await streak.setActiveTrackerPostId(context.subredditId, 't3_existing');
    reddit.posts.set('t3_existing', {
      id: 't3_existing',
      subredditId: context.subredditId,
      title: 'Streak Club',
    });

    const response = await menu.request('/post-create', postJson());
    const body = await jsonRecord(response);

    expect(response.status).toBe(200);
    expectUiResponseKeys(body, ['navigateTo', 'showToast']);
    expect(body.showToast).toBe('Opened the existing Streak Club tracker.');
    expect(body.navigateTo).toBe(
      'https://reddit.com/r/streak_club/comments/existing'
    );
    expect(reddit.posts.size).toBe(1);
  });

  it('creates a new tracker from the menu route with only valid UiResponse fields', async () => {
    const { menu, streak } = await loadServer(NORMAL_MODERATOR_CONTEXT);
    reddit.addModerator('mod_user');
    await configureChallenge(streak);

    const response = await menu.request('/post-create', postJson());
    const body = await jsonRecord(response);

    expect(response.status).toBe(200);
    expectUiResponseKeys(body, ['navigateTo', 'showToast']);
    expect(body.showToast).toBe('Created a new Streak Club tracker.');
    expect(body.navigateTo).toBe('https://reddit.com/r/streak_club/comments/post1');
    expect(await redis.get(streak.keys.activePostId(context.subredditId))).toBe(
      't3_post1'
    );
  });

  it('returns only valid UiResponse fields when setup is still required', async () => {
    const { menu, streak } = await loadServer(NORMAL_MODERATOR_CONTEXT);
    reddit.addModerator('mod_user');

    const response = await menu.request('/post-create', postJson());
    const body = await jsonRecord(response);

    expect(response.status).toBe(200);
    expectUiResponseKeys(body, ['navigateTo', 'showToast']);
    expect(body.showToast).toBe(
      'Complete setup in the tracker post before inviting members.'
    );
    expect(body.navigateTo).toBe('https://reddit.com/r/streak_club/comments/post1');
    expect(await redis.get(streak.keys.activePostId(context.subredditId))).toBe(
      't3_post1'
    );
  });

  it('clears a deleted tracker id and recreates from the menu route', async () => {
    const { menu, streak } = await loadServer(NORMAL_MODERATOR_CONTEXT);
    reddit.addModerator('mod_user');
    await configureChallenge(streak);
    await streak.setActiveTrackerPostId(context.subredditId, 't3_deleted');

    const response = await menu.request('/post-create', postJson());
    const body = await jsonRecord(response);

    expect(response.status).toBe(200);
    expectUiResponseKeys(body, ['navigateTo', 'showToast']);
    expect(body.showToast).toBe(
      'The previous tracker was no longer accessible, so a new one was created.'
    );
    expect(body.navigateTo).toBe('https://reddit.com/r/streak_club/comments/post1');
    expect(await redis.get(streak.keys.activePostId(context.subredditId))).toBe(
      't3_post1'
    );
  });

  it('joins a new user once, stores username, and preserves default public privacy', async () => {
    const { api, streak } = await loadServer();

    const join = await jsonRecord(await api.request('/join', postJson()));
    const state = recordField(join, 'state');

    expect(join.status).toBe('ok');
    expect(state.privacy).toBe('public');
    expect(state.currentStreak).toBe(0);
    expect(await redis.hGet(streak.keys.participants(context.subredditId), context.userId)).toBe(
      '1'
    );
    expect(await redis.hGet(streak.keys.usernames(context.subredditId), context.userId)).toBe(
      context.username
    );

    advanceWallClock(3);
    const duplicateJoin = await jsonRecord(await api.request('/join', postJson()));
    const stats = await streak.getChallengeStats(
      context.subredditId,
      streak.utcDayNumber(new Date())
    );

    expect(duplicateJoin.status).toBe('ok');
    expect(stats.participantsTotal).toBe(1);
  });

  it('checks in a joined user once and keeps duplicate/rate-limited attempts from mutating stats', async () => {
    const { api, streak } = await loadServer();
    await api.request('/join', postJson());

    const first = await jsonRecord(await api.request('/checkin', postJson()));
    const firstState = recordField(first, 'state');

    expect(first.status).toBe('ok');
    expect(firstState.currentStreak).toBe(1);
    expect(first.checkedInToday).toBe(true);

    const today = streak.utcDayNumber(new Date());
    const statsAfterFirst = await streak.getChallengeStats(context.subredditId, today);
    expect(statsAfterFirst.checkinsToday).toBe(1);
    expect(statsAfterFirst.checkinsAllTime).toBe(1);
    expect(statsAfterFirst.longestStreakAllTime).toBe(1);

    const rateLimited = await jsonRecord(await api.request('/checkin', postJson()));
    expect(rateLimited.code).toBe('CHECKIN_RATE_LIMITED');

    const statsAfterRateLimit = await streak.getChallengeStats(context.subredditId, today);
    expect(statsAfterRateLimit.checkinsToday).toBe(1);
    expect(statsAfterRateLimit.checkinsAllTime).toBe(1);

    advanceWallClock(3);
    const duplicate = await jsonRecord(await api.request('/checkin', postJson()));
    expect(duplicate.code).toBe('ALREADY_CHECKED_IN');

    const statsAfterDuplicate = await streak.getChallengeStats(context.subredditId, today);
    expect(statsAfterDuplicate.checkinsToday).toBe(1);
    expect(statsAfterDuplicate.checkinsAllTime).toBe(1);
  });

  it('uses devTimeOffsetSeconds through the check-in route for next-day increments and missed-day breaks', async () => {
    const { api, streak } = await loadServer();
    await api.request('/join', postJson());
    await api.request('/checkin', postJson());

    await streak.setDevTimeOffsetSeconds(context.subredditId, DAY_SECONDS);
    const nextDay = await jsonRecord(await api.request('/checkin', postJson()));
    expect(recordField(nextDay, 'state').currentStreak).toBe(2);

    await streak.setDevTimeOffsetSeconds(context.subredditId, DAY_SECONDS * 4);
    const afterGap = await jsonRecord(await api.request('/checkin', postJson()));
    const afterGapState = recordField(afterGap, 'state');

    expect(afterGapState.currentStreak).toBe(1);
    expect(afterGapState.freezeTokens).toBe(0);
  });

  it('applies freeze earn, cap, preservation, and duplicate non-consumption through server state', async () => {
    const { api, streak } = await loadServer();
    await api.request('/join', postJson());

    for (let dayOffset = 0; dayOffset < 21; dayOffset += 1) {
      await streak.setDevTimeOffsetSeconds(context.subredditId, dayOffset * DAY_SECONDS);
      const checkin = await jsonRecord(await api.request('/checkin', postJson()));
      const state = recordField(checkin, 'state');
      expect(numberField(state, 'currentStreak')).toBe(dayOffset + 1);
    }

    const day21State = await streak.getUserState(context.subredditId, context.userId);
    expect(day21State?.freezeTokens).toBe(2);

    const rateLimitedDuplicate = await jsonRecord(
      await api.request('/checkin', postJson())
    );
    expect(rateLimitedDuplicate.code).toBe('CHECKIN_RATE_LIMITED');
    expect((await streak.getUserState(context.subredditId, context.userId))?.freezeTokens).toBe(
      2
    );

    advanceWallClock(3);
    const duplicate = await jsonRecord(await api.request('/checkin', postJson()));
    expect(duplicate.code).toBe('ALREADY_CHECKED_IN');
    expect((await streak.getUserState(context.subredditId, context.userId))?.freezeTokens).toBe(
      2
    );

    await streak.setDevTimeOffsetSeconds(context.subredditId, 22 * DAY_SECONDS);
    const freezeSave = await jsonRecord(await api.request('/checkin', postJson()));
    const freezeSaveState = recordField(freezeSave, 'state');

    expect(freezeSave.usedFreeze).toBe(true);
    expect(freezeSaveState.currentStreak).toBe(22);
    expect(freezeSaveState.freezeTokens).toBe(1);
  });

  it('keeps public/private leaderboard visibility and my rank consistent', async () => {
    const { api, streak } = await loadServer();

    await api.request('/join', postJson());
    await api.request('/checkin', postJson());

    setActor('t2_user_b', 'user_b');
    await api.request('/join', postJson());
    await api.request('/privacy', postJson({ privacy: 'private' }));
    await api.request('/checkin', postJson());

    let leaderboard = arrayField(
      await jsonRecord(await api.request('/leaderboard?limit=10')),
      'leaderboard'
    );
    expect(leaderboard.map((entry) => entry.userId)).toEqual(['t2_user_a']);

    setActor('t2_user_a', 'user_a');
    const mePublic = await jsonRecord(await api.request('/me'));
    expect(mePublic.myRank).toBe(1);

    setActor('t2_user_b', 'user_b');
    const mePrivate = await jsonRecord(await api.request('/me'));
    expect(mePrivate.myRank).toBeNull();

    await api.request('/privacy', postJson({ privacy: 'public' }));
    leaderboard = arrayField(
      await jsonRecord(await api.request('/leaderboard?limit=10')),
      'leaderboard'
    );

    expect(leaderboard.map((entry) => entry.rank)).toEqual([1, 1]);
    expect(await redis.hGet(streak.keys.usernames(context.subredditId), 't2_user_b')).toBe(
      'user_b'
    );
  });

  it('requires moderators for challenge config updates', async () => {
    const { api } = await loadServer(BASIC_USER_CONTEXT);

    let response = await jsonRecord(await api.request('/config', postJson(validConfigBody())));
    expect(response.code).toBe('MODERATOR_REQUIRED');

    const moderator = await loadServer(NORMAL_MODERATOR_CONTEXT);
    reddit.addModerator('mod_user');
    response = await jsonRecord(await moderator.api.request('/config', postJson(validConfigBody())));
    expect(response.status).toBe('ok');
    expect(recordField(response, 'config').title).toBe('Streak Club');
  });

  it("requires moderators for Repair Today's Stats", async () => {
    const { api } = await loadServer(BASIC_USER_CONTEXT);

    let response = await jsonRecord(await api.request('/dev/stats/repair', postJson()));
    expect(response.code).toBe('MODERATOR_REQUIRED');

    const moderator = await loadServer(NORMAL_MODERATOR_CONTEXT);
    reddit.addModerator('mod_user');
    response = await jsonRecord(await moderator.api.request('/dev/stats/repair', postJson()));
    expect(response.status).toBe('ok');
    expect(typeof response.utcDayNumber).toBe('number');
    expect(typeof response.todaySetSize).toBe('number');
  });

  it('allows staging simulation only for moderators in the hardcoded staging subreddit with testing mode enabled', async () => {
    const { api, streak } = await loadServer({
      ...STAGING_MODERATOR_CONTEXT,
      username: 'not_mod',
    });

    let response = await jsonRecord(
      await api.request('/mod/testing-mode', postJson({ enabled: true }))
    );
    expect(response.code).toBe('MODERATOR_REQUIRED');
    expect(await redis.get(streak.keys.testingMode(context.subredditId))).toBeUndefined();

    reddit.addModerator('mod_user');
    context.username = 'mod_user';
    context.userId = 't2_mod_user';

    response = await jsonRecord(
      await api.request('/mod/testing/advance', postJson({ daysToAdvance: 1 }))
    );
    expect(response.code).toBe('TESTING_MODE_REQUIRED');

    response = await jsonRecord(
      await api.request('/mod/testing-mode', postJson({ enabled: true }))
    );
    expect(response.status).toBe('ok');
    expect(response.testingMode).toBe(true);
    expect(await redis.get(streak.keys.testingMode(context.subredditId))).toBe('on');

    response = await jsonRecord(
      await api.request('/mod/testing/advance', postJson({ daysToAdvance: 1 }))
    );
    expect(response.status).toBe('ok');
    expect(response.daysToAdvance).toBe(1);
    expect(response.devTimeOffsetSeconds).toBe(DAY_SECONDS);
  });

  it('rejects staging simulation endpoints outside the hardcoded staging subreddit', async () => {
    const nonStaging = await loadServer(NORMAL_MODERATOR_CONTEXT);
    reddit.addModerator('mod_user');

    let response = await jsonRecord(
      await nonStaging.api.request('/mod/testing-mode', postJson({ enabled: true }))
    );
    expect(response.code).toBe('STAGING_ONLY');

    response = await jsonRecord(
      await nonStaging.api.request('/mod/testing/advance', postJson({ daysToAdvance: 1 }))
    );
    expect(response.code).toBe('STAGING_ONLY');

    response = await jsonRecord(
      await nonStaging.api.request('/mod/testing/reset-offset', postJson())
    );
    expect(response.code).toBe('STAGING_ONLY');

    await nonStaging.streak.setTestingMode(context.subredditId, true);
    await nonStaging.streak.setDevTimeOffsetSeconds(context.subredditId, 3_600);
    const config = await jsonRecord(await nonStaging.api.request('/config'));
    expect(config.isStaging).toBe(false);
    expect(config.testingMode).toBe(false);
    expect(config.testingDevTimeOffsetSeconds).toBe(0);
  });

  it('rejects staging simulation endpoints for non-moderators in the staging subreddit', async () => {
    const { api, streak } = await loadServer({
      ...STAGING_MODERATOR_CONTEXT,
      username: 'basic_user',
      userId: 't2_basic_user',
    });
    await streak.setTestingMode(context.subredditId, true);

    let response = await jsonRecord(
      await api.request('/mod/testing-mode', postJson({ enabled: false }))
    );
    expect(response.code).toBe('MODERATOR_REQUIRED');

    response = await jsonRecord(
      await api.request('/mod/testing/advance', postJson({ daysToAdvance: 1 }))
    );
    expect(response.code).toBe('MODERATOR_REQUIRED');

    response = await jsonRecord(await api.request('/mod/testing/reset-offset', postJson()));
    expect(response.code).toBe('MODERATOR_REQUIRED');
  });

  it('keeps playtest/dev endpoints closed outside the current playtest subreddit-name condition', async () => {
    const { api } = await loadServer(NORMAL_MODERATOR_CONTEXT);
    reddit.addModerator('mod_user');

    const rejectedRoutes = [
      await api.request('/dev/time'),
      await api.request('/dev/time', postJson({ devTimeOffsetSeconds: 3_600 })),
      await api.request('/dev/reset', postJson()),
      await api.request('/dev/stress', postJson()),
      await api.request('/dev/stats/debug'),
    ];

    for (const response of rejectedRoutes) {
      expect((await jsonRecord(response)).code).toBe('PLAYTEST_REQUIRED');
    }
  });

  it('allows playtest-only dev routes for playtest subreddit names', async () => {
    const { api, streak } = await loadServer(PLAYTEST_DEV_CONTEXT);

    const response = await jsonRecord(
      await api.request('/dev/time', postJson({ devTimeOffsetSeconds: 3_600 }))
    );

    expect(response.status).toBe('ok');
    expect(response.devTimeOffsetSeconds).toBe(3_600);
    expect(await redis.get(streak.keys.devTimeOffsetSeconds(context.subredditId))).toBe(
      '3600'
    );
  });

  it('uses canonical active tracker keys, backfills legacy config values, and recovers missing posts', async () => {
    const { api, streak } = await loadServer();
    await redis.hSet(streak.keys.challengeConfig(context.subredditId), {
      templateId: 'habit_30',
      title: 'Habit tracker',
      description: 'Track the habit',
      timezone: 'UTC',
      badgeThresholds: '[7]',
      devMode: '0',
      activePostId: 'abc123',
      updatedAt: String(Date.now()),
      createdAt: String(Date.now()),
    });

    const fromLegacy = await streak.ensureChallengeConfig(context.subredditId);
    expect(fromLegacy.activePostId).toBe('abc123');
    expect(await redis.get(streak.keys.activePostId(context.subredditId))).toBe('abc123');

    await streak.setActiveTrackerPostId(context.subredditId, 'gonepost');
    const config = await jsonRecord(await api.request('/config'));
    const configBody = recordField(config, 'config');
    expect(configBody.activePostId).toBeNull();
    expect(await redis.get(streak.keys.activePostId(context.subredditId))).toBeUndefined();
  });

  it('uses canonical dev time and testing-mode keys with legacy dev settings backfill', async () => {
    const { streak } = await loadServer();

    await streak.setDevTimeOffsetSeconds(context.subredditId, 7_200);
    expect(await redis.get(streak.keys.devTimeOffsetSeconds(context.subredditId))).toBe(
      '7200'
    );
    expect(await redis.hGet(streak.keys.devSettings(context.subredditId), 'devTimeOffsetSeconds')).toBe(
      '7200'
    );

    await redis.del(streak.keys.devTimeOffsetSeconds(context.subredditId));
    await redis.hSet(streak.keys.devSettings(context.subredditId), {
      devTimeOffsetSeconds: '5400',
    });

    expect(await streak.getDevTimeOffsetSeconds(context.subredditId)).toBe(5_400);
    expect(await redis.get(streak.keys.devTimeOffsetSeconds(context.subredditId))).toBe(
      '5400'
    );

    await streak.setTestingMode(context.subredditId, true);
    expect(await redis.get(streak.keys.testingMode(context.subredditId))).toBe('on');
  });

  it('recovers config with no activePostId without crashing', async () => {
    const { api } = await loadServer();

    const response = await jsonRecord(await api.request('/config'));
    const config = recordField(response, 'config');
    const stats = recordField(response, 'stats');

    expect(response.status).toBe('ok');
    expect(config.activePostId).toBeNull();
    expect(numberField(stats, 'participantsTotal')).toBe(0);
  });

  it('exposes stable rank ties after next-day public check-ins', async () => {
    const { api, streak } = await loadServer();

    await api.request('/join', postJson());
    await api.request('/checkin', postJson());
    await streak.setDevTimeOffsetSeconds(context.subredditId, DAY_SECONDS);
    await api.request('/checkin', postJson());

    setActor('t2_user_b', 'user_b');
    await api.request('/join', postJson());
    await api.request('/checkin', postJson());
    await streak.setUserState(context.subredditId, 't2_user_b', {
      joinedAt: new Date().toISOString(),
      privacy: 'public',
      currentStreak: 2,
      bestStreak: 2,
      streakStartDayUTC: streak.utcDayNumber(new Date()) - 1,
      lastCheckinDayUTC: streak.utcDayNumber(new Date()),
      freezeTokens: 0,
      freezeSaves: 0,
      badges: [],
      isParticipant: true,
    });
    await streak.setPrivacy(context.subredditId, 't2_user_b', 'public');

    const leaderboard = arrayField(
      await jsonRecord(await api.request('/leaderboard?limit=10')),
      'leaderboard'
    );
    expect(leaderboard.map((entry) => entry.rank)).toEqual([1, 1]);

    const me = await jsonRecord(await api.request('/me'));
    expect(me.myRank).toBe(1);
    expect(stringField(leaderboard[0] ?? {}, 'userId')).toMatch(/^t2_user_/);
  });
});
