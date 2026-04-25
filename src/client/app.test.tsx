// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const devvitClient = vi.hoisted(() => {
  const context = {
    username: 'test_user',
  };
  let mode = 'expanded';
  return {
    context,
    getWebViewMode: vi.fn(() => mode),
    requestExpandedMode: vi.fn(),
    setMode: (nextMode: string) => {
      mode = nextMode;
    },
  };
});

vi.mock('@devvit/web/client', () => ({
  context: devvitClient.context,
  getWebViewMode: devvitClient.getWebViewMode,
  requestExpandedMode: devvitClient.requestExpandedMode,
}));

import { App } from './app';

type Privacy = 'public' | 'private';
type TemplateId = 'custom' | 'habit_30';

type UserState = {
  joinedAt: string;
  privacy: Privacy;
  currentStreak: number;
  bestStreak: number;
  streakStartDayUTC: number | null;
  lastCheckinDayUTC: number | null;
  freezeTokens: number;
  freezeSaves: number;
  badges: string[];
  isParticipant: boolean;
};

type ConfigResponse = {
  status: 'ok';
  config: {
    templateId: TemplateId;
    title: string;
    description: string;
    timezone: 'UTC';
    badgeThresholds: number[];
    devMode: boolean;
    activePostId: string | null;
    updatedAt: number;
    createdAt: number;
  };
  isStaging: boolean;
  testingMode: boolean;
  testingDevTimeOffsetSeconds: number;
  configNeedsSetup: boolean;
  stats: {
    participantsTotal: number;
    checkinsToday: number;
    checkinsAllTime: number;
    longestStreakAllTime: number;
  };
};

type MeResponse = {
  status: 'ok';
  state: UserState | null;
  checkedInToday: boolean;
  canCheckInToday: boolean;
  nextResetUtcTimestamp: number;
  myRank: number | null;
  isModerator: boolean;
};

type LeaderboardEntry = {
  userId: string;
  displayName?: string;
  rank: number;
  currentStreak: number;
  streakStartDayUTC: number | null;
};

type DevTimeResponse = {
  status: 'ok';
  note: string;
  serverUtcNow: string;
  simulatedUtcNow: string;
  utcDayNumberNow: number;
  effectiveDayNumber: number;
  devTimeOffsetSeconds: number;
  nextResetUtcMs: number;
  secondsUntilReset: number;
};

type ApiServerState = {
  config: ConfigResponse;
  templates: {
    status: 'ok';
    templates: Array<{
      id: TemplateId;
      label: string;
      title: string;
      description: string;
      badgeThresholds: number[];
    }>;
  };
  me: MeResponse;
  leaderboard: {
    status: 'ok';
    leaderboard: LeaderboardEntry[];
  };
  devTime: DevTimeResponse | null;
  devStats: Record<string, unknown> | null;
  configError: string | null;
  checkinErrorOnce: boolean;
  requests: Array<{ path: string; method: string; body: unknown }>;
};

type RenderedApp = {
  container: HTMLDivElement;
  root: Root;
  server: ApiServerState;
};

const MILLIS_PER_DAY = 86_400_000;
const NOW_MS = Date.parse('2026-02-16T23:00:00.000Z');
const TODAY = Math.floor(NOW_MS / MILLIS_PER_DAY);

const createDeferred = <T,>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} => {
  let resolveFn: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    resolveFn = resolve;
  });
  return {
    promise,
    resolve: resolveFn,
  };
};

const makeUserState = (overrides: Partial<UserState> = {}): UserState => ({
  joinedAt: '2026-02-16T00:00:00.000Z',
  privacy: 'public',
  currentStreak: 1,
  bestStreak: 1,
  streakStartDayUTC: TODAY,
  lastCheckinDayUTC: null,
  freezeTokens: 0,
  freezeSaves: 0,
  badges: [],
  isParticipant: true,
  ...overrides,
});

const makeConfig = (
  overrides: Partial<ConfigResponse> = {}
): ConfigResponse => ({
  status: 'ok',
  config: {
    templateId: 'habit_30',
    title: 'Streak Club',
    description: 'Build the daily streak.',
    timezone: 'UTC',
    badgeThresholds: [7, 30],
    devMode: false,
    activePostId: 't3_tracker',
    updatedAt: NOW_MS,
    createdAt: NOW_MS,
  },
  isStaging: false,
  testingMode: false,
  testingDevTimeOffsetSeconds: 0,
  configNeedsSetup: false,
  stats: {
    participantsTotal: 3,
    checkinsToday: 1,
    checkinsAllTime: 8,
    longestStreakAllTime: 5,
  },
  ...overrides,
});

const makeMe = (overrides: Partial<MeResponse> = {}): MeResponse => ({
  status: 'ok',
  state: null,
  checkedInToday: false,
  canCheckInToday: true,
  nextResetUtcTimestamp: (TODAY + 1) * MILLIS_PER_DAY,
  myRank: null,
  isModerator: false,
  ...overrides,
});

const makeDevTime = (): DevTimeResponse => ({
  status: 'ok',
  note: 'DEV ONLY',
  serverUtcNow: new Date(NOW_MS).toISOString(),
  simulatedUtcNow: new Date(NOW_MS).toISOString(),
  utcDayNumberNow: TODAY,
  effectiveDayNumber: TODAY,
  devTimeOffsetSeconds: 0,
  nextResetUtcMs: (TODAY + 1) * MILLIS_PER_DAY,
  secondsUntilReset: 3600,
});

const createApiServer = (
  overrides: Partial<ApiServerState> = {}
): ApiServerState => ({
  config: makeConfig(),
  templates: {
    status: 'ok',
    templates: [
      {
        id: 'habit_30',
        label: '30-day habit',
        title: 'Streak Club',
        description: 'Build the daily streak.',
        badgeThresholds: [7, 30],
      },
    ],
  },
  me: makeMe(),
  leaderboard: {
    status: 'ok',
    leaderboard: [],
  },
  devTime: null,
  devStats: null,
  configError: null,
  checkinErrorOnce: false,
  requests: [],
  ...overrides,
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });

const readRequestBody = (init: RequestInit | undefined): unknown => {
  if (typeof init?.body !== 'string') {
    return null;
  }

  return JSON.parse(init.body);
};

const installFetchMock = (
  server: ApiServerState,
  deferredConfig?: { promise: Promise<Response> }
): void => {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input), window.location.href);
      const method = init?.method?.toUpperCase() ?? 'GET';
      const body = readRequestBody(init);
      server.requests.push({ path: url.pathname, method, body });

      if (url.pathname === '/api/config') {
        if (server.configError) {
          return jsonResponse(
            {
              status: 'error',
              code: 'CONFIG_READ_FAILED',
              message: server.configError,
            },
            500
          );
        }
        if (deferredConfig) {
          return await deferredConfig.promise;
        }
        return jsonResponse(server.config);
      }
      if (url.pathname === '/api/templates') {
        return jsonResponse(server.templates);
      }
      if (url.pathname === '/api/me') {
        return jsonResponse(server.me);
      }
      if (url.pathname === '/api/leaderboard') {
        return jsonResponse(server.leaderboard);
      }
      if (url.pathname === '/api/dev/time') {
        return server.devTime
          ? jsonResponse(server.devTime)
          : jsonResponse({ status: 'error', message: 'No dev time' }, 403);
      }
      if (url.pathname === '/api/dev/stats/debug') {
        return jsonResponse(
          server.devStats ?? {
            status: 'ok',
            utcDayNumber: TODAY,
            lastStatsDay: TODAY,
            participantsTotal: 3,
            checkinsToday: 1,
            checkinsAllTime: 8,
            longestStreakAllTime: 5,
            todaySetSize: 1,
          }
        );
      }
      if (url.pathname === '/api/join') {
        server.me = makeMe({
          state: makeUserState({
            currentStreak: 0,
            bestStreak: 0,
            streakStartDayUTC: null,
            lastCheckinDayUTC: null,
          }),
          checkedInToday: false,
          myRank: null,
        });
        return jsonResponse({ status: 'ok', state: server.me.state });
      }
      if (url.pathname === '/api/checkin') {
        if (server.checkinErrorOnce && server.me.state) {
          server.checkinErrorOnce = false;
          server.me = {
            ...server.me,
            checkedInToday: true,
          };
          return jsonResponse(
            {
              status: 'error',
              code: 'ALREADY_CHECKED_IN',
              message: 'You already checked in today (UTC).',
              state: {
                ...server.me.state,
                lastCheckinDayUTC: TODAY,
              },
            },
            409
          );
        }
        const nextState = makeUserState({
          ...server.me.state,
          currentStreak: Math.max(server.me.state?.currentStreak ?? 0, 0) + 1,
          bestStreak: Math.max(server.me.state?.bestStreak ?? 0, 1),
          lastCheckinDayUTC: TODAY,
          streakStartDayUTC: server.me.state?.streakStartDayUTC ?? TODAY,
          privacy: server.me.state?.privacy ?? 'public',
        });
        server.me = {
          ...server.me,
          state: nextState,
          checkedInToday: true,
          canCheckInToday: false,
        };
        return jsonResponse({
          status: 'ok',
          state: nextState,
          checkedInToday: true,
          nextResetUtcTimestamp: (TODAY + 1) * MILLIS_PER_DAY,
          usedFreeze: false,
          earnedFreeze: false,
          tokenCount: nextState.freezeTokens,
          earnedBadge: null,
        });
      }
      if (url.pathname === '/api/privacy') {
        const privacy =
          isPrivacyBody(body) && body.privacy === 'private' ? 'private' : 'public';
        if (server.me.state) {
          server.me = {
            ...server.me,
            state: {
              ...server.me.state,
              privacy,
            },
            myRank: privacy === 'private' ? null : server.me.myRank,
          };
        }
        return jsonResponse({ status: 'ok', state: server.me.state });
      }
      if (url.pathname === '/api/mod/testing-mode') {
        server.config = {
          ...server.config,
          testingMode: !server.config.testingMode,
        };
        return jsonResponse({
          status: 'ok',
          testingMode: server.config.testingMode,
          devTimeOffsetSeconds: server.config.testingDevTimeOffsetSeconds,
        });
      }

      return jsonResponse({ status: 'error', message: 'Unhandled request' }, 404);
    }
  );
  vi.stubGlobal('fetch', fetchMock);
};

const isPrivacyBody = (value: unknown): value is { privacy: Privacy } =>
  typeof value === 'object' &&
  value !== null &&
  'privacy' in value &&
  (value.privacy === 'public' || value.privacy === 'private');

const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const renderApp = async (
  server: ApiServerState = createApiServer(),
  options: { deferredConfig?: { promise: Promise<Response> }; wait?: boolean } = {}
): Promise<RenderedApp> => {
  installFetchMock(server, options.deferredConfig);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<App />);
    if (options.wait !== false) {
      await settle();
    }
  });

  return { container, root, server };
};

const text = (container: HTMLElement): string => container.textContent ?? '';

const findButton = (container: HTMLElement, name: RegExp): HTMLButtonElement => {
  const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
    name.test(candidate.textContent ?? '')
  );
  if (!button) {
    throw new Error(`Button not found: ${String(name)}`);
  }
  return button;
};

const clickButton = async (container: HTMLElement, name: RegExp): Promise<void> => {
  const button = findButton(container, name);
  await act(async () => {
    button.click();
    await settle();
  });
};

const expectText = (container: HTMLElement, expected: string | RegExp): void => {
  if (typeof expected === 'string') {
    expect(text(container)).toContain(expected);
    return;
  }
  expect(text(container)).toMatch(expected);
};

let mountedRoots: Root[] = [];

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    value: true,
  });
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
  devvitClient.context.username = 'test_user';
  devvitClient.setMode('expanded');
  devvitClient.requestExpandedMode.mockClear();
  devvitClient.getWebViewMode.mockClear();
  window.history.pushState({}, '', '/');
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn(() => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  mountedRoots = [];
});

afterEach(() => {
  for (const root of mountedRoots) {
    act(() => {
      root.unmount();
    });
  }
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const track = (rendered: RenderedApp): RenderedApp => {
  mountedRoots.push(rendered.root);
  return rendered;
};

describe('Streak Club App UI', () => {
  it('renders loading first, then the loaded app without crashing', async () => {
    const server = createApiServer();
    const deferred = createDeferred<Response>();
    const rendered = track(
      await renderApp(server, { deferredConfig: deferred, wait: false })
    );

    expectText(rendered.container, 'Loading...');

    await act(async () => {
      deferred.resolve(jsonResponse(server.config));
      await settle();
    });

    expectText(rendered.container, 'Streak Club');
    expectText(rendered.container, 'Leaderboard');
  });

  it('renders an API error fallback when initial load fails', async () => {
    const rendered = track(
      await renderApp(createApiServer({ configError: 'Config exploded' }))
    );

    expectText(rendered.container, 'Streak Engine');
    expectText(rendered.container, 'Config exploded');
  });

  it('lets an unjoined user join and then shows check-in availability', async () => {
    const rendered = track(await renderApp());

    expectText(rendered.container, 'Join Challenge');
    await clickButton(rendered.container, /Join Challenge/);

    expect(rendered.server.requests.some((request) => request.path === '/api/join')).toBe(
      true
    );
    expectText(rendered.container, 'Check in for today');
    expectText(rendered.container, 'My rank: unranked');
  });

  it('lets a joined user check in and then shows the checked-in-today state', async () => {
    const server = createApiServer({
      me: makeMe({
        state: makeUserState({
          currentStreak: 0,
          bestStreak: 0,
          lastCheckinDayUTC: null,
          streakStartDayUTC: null,
        }),
        checkedInToday: false,
        canCheckInToday: true,
      }),
    });
    const rendered = track(await renderApp(server));

    expectText(rendered.container, 'Check in for today');
    await clickButton(rendered.container, /Check in for today/);

    expect(
      rendered.server.requests.some((request) => request.path === '/api/checkin')
    ).toBe(true);
    expectText(rendered.container, /Checked in today!/);
    expectText(rendered.container, 'Current Streak: 1 day');
  });

  it('handles duplicate 409 check-in responses without a broken state', async () => {
    const server = createApiServer({
      me: makeMe({
        state: makeUserState({
          currentStreak: 1,
          bestStreak: 1,
          lastCheckinDayUTC: null,
        }),
        checkedInToday: false,
        canCheckInToday: true,
      }),
      checkinErrorOnce: true,
    });
    const rendered = track(await renderApp(server));

    await clickButton(rendered.container, /Check in for today/);

    expectText(rendered.container, 'You already checked in today (UTC).');
    expectText(rendered.container, /Checked in today!/);
  });

  it('renders status rows in the expected order with explicit date and countdown copy', async () => {
    const rendered = track(
      await renderApp(
        createApiServer({
          me: makeMe({
            state: makeUserState({
              currentStreak: 3,
              bestStreak: 4,
              lastCheckinDayUTC: TODAY,
            }),
            checkedInToday: true,
            myRank: 2,
          }),
        })
      )
    );
    const body = text(rendered.container);

    expect(body).toContain('Last check-in');
    expect(body).toContain('2026-02-16 00:00:00 UTC');
    expect(body).toContain('Resets at 00:00 UTC in 01:00:00');
    expect(body).toContain('Next check-in due in 25:00:00');
    expect(body).toContain('My rank: #2');

    expect(body.indexOf('Last check-in')).toBeLessThan(
      body.indexOf('Resets at 00:00 UTC in')
    );
    expect(body.indexOf('Resets at 00:00 UTC in')).toBeLessThan(
      body.indexOf('Next check-in due in')
    );
    expect(body.indexOf('Next check-in due in')).toBeLessThan(
      body.indexOf('My rank: #2')
    );
    expect(body.indexOf('My rank: #2')).toBeLessThan(
      body.indexOf('Leaderboard visibility')
    );
    expect(body.indexOf('Leaderboard visibility')).toBeLessThan(
      body.indexOf('Public')
    );
  });

  it('renders leaderboard rows and tie ranks from API state', async () => {
    const rendered = track(
      await renderApp(
        createApiServer({
          me: makeMe({
            state: makeUserState(),
            checkedInToday: true,
            myRank: 1,
          }),
          leaderboard: {
            status: 'ok',
            leaderboard: [
              {
                userId: 't2_a',
                displayName: 'Alpha',
                rank: 1,
                currentStreak: 8,
                streakStartDayUTC: TODAY - 7,
              },
              {
                userId: 't2_b',
                displayName: 'Beta',
                rank: 1,
                currentStreak: 8,
                streakStartDayUTC: TODAY - 7,
              },
              {
                userId: 't2_c',
                displayName: 'Gamma',
                rank: 3,
                currentStreak: 5,
                streakStartDayUTC: TODAY - 4,
              },
            ],
          },
        })
      )
    );
    const body = text(rendered.container);

    expect(body).toContain('Alpha');
    expect(body).toContain('Beta');
    expect(body).toContain('Gamma');
    expect(body).toContain('My rank: #1');
    const leaderboardRows = Array.from(
      rendered.container.querySelectorAll('ol li')
    ).map((row) => row.textContent ?? '');
    expect(leaderboardRows.filter((row) => row.includes('#1')).length).toBe(2);
    expect(body).toContain('#3');
    expect(body).not.toContain('Private User');
  });

  it('updates privacy after clicking the private toggle', async () => {
    const rendered = track(
      await renderApp(
        createApiServer({
          me: makeMe({
            state: makeUserState({ privacy: 'public' }),
            checkedInToday: true,
            myRank: 4,
          }),
        })
      )
    );

    expectText(rendered.container, 'My rank: #4');
    await clickButton(rendered.container, /^Private$/);

    const privacyRequest = rendered.server.requests.find(
      (request) => request.path === '/api/privacy'
    );
    expect(privacyRequest?.body).toEqual({ privacy: 'private' });
    expectText(rendered.container, 'My rank: hidden (private)');
  });

  it('hides moderator and staging controls from normal users and non-staging config', async () => {
    const rendered = track(await renderApp());
    const body = text(rendered.container);

    expect(body).not.toContain('Setup / Admin');
    expect(body).not.toContain('Challenge Config (Moderator)');
    expect(body).not.toContain('Staging test mode');
    expect(body).not.toContain('UTC Reset Test Panel');
  });

  it('shows moderator controls and staging controls only when API state allows them', async () => {
    const nonStaging = track(
      await renderApp(
        createApiServer({
          config: makeConfig({ isStaging: false }),
          me: makeMe({ isModerator: true }),
        })
      )
    );
    expectText(nonStaging.container, 'Setup / Admin');
    expectText(nonStaging.container, 'Challenge Config (Moderator)');
    expect(text(nonStaging.container)).not.toContain('Staging test mode');

    act(() => {
      nonStaging.root.unmount();
    });
    mountedRoots = mountedRoots.filter((root) => root !== nonStaging.root);
    document.body.replaceChildren();

    const staging = track(
      await renderApp(
        createApiServer({
          config: makeConfig({
            isStaging: true,
            testingMode: true,
            testingDevTimeOffsetSeconds: 86_400,
          }),
          me: makeMe({ isModerator: true }),
        })
      )
    );

    expectText(staging.container, 'Staging test mode (staging subreddit only)');
    expectText(staging.container, 'Status: ON');
    expectText(staging.container, 'Current time offset: 86400s');
  });

  it('shows playtest-only dev controls only with playtest context and dev API state', async () => {
    const normal = track(
      await renderApp(
        createApiServer({
          me: makeMe({ isModerator: true }),
          devTime: makeDevTime(),
        })
      )
    );
    expect(text(normal.container)).not.toContain('UTC Reset Test Panel');

    act(() => {
      normal.root.unmount();
    });
    mountedRoots = mountedRoots.filter((root) => root !== normal.root);
    document.body.replaceChildren();
    window.history.pushState(
      {},
      '',
      `/?context=${encodeURIComponent(JSON.stringify({ subredditName: 'streak_club_dev' }))}`
    );

    const playtest = track(
      await renderApp(
        createApiServer({
          me: makeMe({ isModerator: true }),
          devTime: makeDevTime(),
        })
      )
    );

    expectText(playtest.container, 'UTC Reset Test Panel');
    expectText(playtest.container, 'Simulated UTC');
    expect(
      playtest.server.requests.some((request) => request.path === '/api/dev/time')
    ).toBe(true);
  });
});
