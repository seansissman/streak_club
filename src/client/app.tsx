import './index.css';

import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { isCheckedInToday, isUserJoined, shouldRenderCheckInButton } from './state';

type Privacy = 'public' | 'private';
type TemplateId =
  | 'custom'
  | 'habit_30'
  | 'coding_daily'
  | 'fitness_daily'
  | 'study_daily';

type ChallengeConfig = {
  templateId: TemplateId;
  title: string;
  description: string;
  timezone: 'UTC';
  badgeThresholds: number[];
  activePostId: string | null;
  updatedAt: number;
  createdAt: number;
};

type ChallengeTemplate = {
  id: TemplateId;
  label: string;
  title: string;
  description: string;
  badgeThresholds: number[];
};

type UserState = {
  joinedAt: string;
  privacy: Privacy;
  currentStreak: number;
  bestStreak: number;
  streakStartDayUTC: number | null;
  lastCheckinDayUTC: number | null;
};

type ConfigResponse = {
  status: 'ok';
  config: ChallengeConfig;
  configNeedsSetup?: boolean;
  stats: {
    participantsCount: number;
    checkedInTodayCount: number;
  };
};

type MeResponse = {
  status: 'ok';
  state: UserState | null;
  checkedInToday: boolean;
  canCheckInToday?: boolean;
  nextResetUtcTimestamp: number;
  myRank: number | null;
  isModerator: boolean;
};

type LeaderboardResponse = {
  status: 'ok';
  leaderboard: Array<{
    userId: string;
    displayName?: string;
    currentStreak: number;
    streakStartDayUTC: number | null;
  }>;
};

type TemplatesResponse = {
  status: 'ok';
  templates: ChallengeTemplate[];
};

type ApiError = {
  status: 'error';
  code: string;
  message: string;
  state?: UserState | null;
  details?: Record<string, string | string[]>;
};

class ApiRequestError extends Error {
  readonly code?: string;
  readonly state?: UserState | null;
  readonly details?: Record<string, string | string[]>;

  constructor(message: string, apiError?: ApiError) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = apiError?.code;
    this.state = apiError?.state;
    this.details = apiError?.details;
  }
}

type DevTimeResponse = {
  status: 'ok';
  note: string;
  serverUtcNow: string;
  utcDayNumberNow: number;
  devDayOffset: number;
  effectiveDayNumber: number;
  nextResetUtcMs: number;
};

type DevResetResponse = DevTimeResponse & {
  stateGeneration: number;
};

type CheckInResponse = {
  status: 'ok';
  state: UserState;
  checkedInToday: boolean;
  nextResetUtcTimestamp: number;
};

type SaveConfigResponse = {
  status: 'ok';
  config: ChallengeConfig;
};

type ValidationErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: Record<string, string | string[]>;
  };
};

const MILLIS_PER_DAY = 86_400_000;

const formatUtcDay = (day: number | null): string => {
  if (day === null) {
    return 'Never';
  }

  return new Date(day * MILLIS_PER_DAY).toISOString().slice(0, 10);
};

const formatCountdown = (target: number): string => {
  const diffMs = Math.max(target - Date.now(), 0);
  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600)
    .toString()
    .padStart(2, '0');
  const minutes = Math.floor((totalSeconds % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');

  return `${hours}:${minutes}:${seconds}`;
};

const parseBadgeThresholdInput = (value: string): number[] | null => {
  const values = value
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((num) => Number.isInteger(num) && num > 0);

  if (values.length === 0) {
    return null;
  }

  return Array.from(new Set(values)).sort((a, b) => a - b);
};

const formatValidationDetails = (
  details?: Record<string, string | string[]>
): string | null => {
  if (!details) {
    return null;
  }

  const parts = Object.entries(details).map(([field, detail]) => {
    const detailText = Array.isArray(detail) ? detail.join(', ') : detail;
    return `${field}: ${detailText}`;
  });

  if (parts.length === 0) {
    return null;
  }

  return parts.join(' | ');
};

const apiRequest = async <T,>(
  path: string,
  init?: RequestInit
): Promise<T> => {
  const method = init?.method?.toUpperCase() ?? 'GET';
  const response = await fetch(path, {
    ...init,
    cache: method === 'GET' ? 'no-store' : init?.cache,
  });
  const data = (await response.json()) as
    | T
    | ApiError
    | ValidationErrorResponse;

  if (!response.ok) {
    const validationError = (data as ValidationErrorResponse).error;
    const apiError: ApiError = validationError
      ? {
          status: 'error',
          code: validationError.code,
          message: validationError.message,
          details: validationError.details,
        }
      : (data as ApiError);
    throw new ApiRequestError(
      apiError.message || `Request failed: ${response.status}`,
      apiError
    );
  }

  return data as T;
};

const App = () => {
  const [config, setConfig] = useState<ChallengeConfig | null>(null);
  const [participantsCount, setParticipantsCount] = useState(0);
  const [checkedInTodayCount, setCheckedInTodayCount] = useState(0);
  const [configNeedsSetup, setConfigNeedsSetup] = useState(false);
  const [templates, setTemplates] = useState<ChallengeTemplate[]>([]);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardResponse['leaderboard']>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devNotice, setDevNotice] = useState<string | null>(null);
  const [configNotice, setConfigNotice] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState('00:00:00');
  const [devTime, setDevTime] = useState<DevTimeResponse | null>(null);
  const [resetConfirmArmed, setResetConfirmArmed] = useState(false);
  const [configTemplateId, setConfigTemplateId] = useState<TemplateId>('custom');
  const [configTitle, setConfigTitle] = useState('');
  const [configDescription, setConfigDescription] = useState('');
  const [configBadgeThresholdsInput, setConfigBadgeThresholdsInput] = useState('');

  const loadAll = useCallback(async () => {
    const reqTs = Date.now();
    const [configRes, templatesRes, meRes, leaderboardRes, devTimeRes] = await Promise.all([
      apiRequest<ConfigResponse>(`/api/config?ts=${reqTs}`),
      apiRequest<TemplatesResponse>(`/api/templates?ts=${reqTs}`),
      apiRequest<MeResponse>(`/api/me?ts=${reqTs}`),
      apiRequest<LeaderboardResponse>(`/api/leaderboard?limit=10&ts=${reqTs}`),
      apiRequest<DevTimeResponse>(`/api/dev/time?ts=${reqTs}`).catch(() => null),
    ]);

    setConfig(configRes.config);
    setConfigNeedsSetup(Boolean(configRes.configNeedsSetup));
    setTemplates(templatesRes.templates);
    setParticipantsCount(configRes.stats.participantsCount);
    setCheckedInTodayCount(configRes.stats.checkedInTodayCount);
    setMe(meRes);
    setLeaderboard(leaderboardRes.leaderboard);
    setDevTime(devTimeRes);
  }, []);

  useEffect(() => {
    if (!config) {
      return;
    }

    setConfigTemplateId(config.templateId);
    setConfigTitle(config.title);
    setConfigDescription(config.description);
    setConfigBadgeThresholdsInput(config.badgeThresholds.join(', '));
  }, [config]);

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        await loadAll();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load app';
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, [loadAll]);

  useEffect(() => {
    const nextReset = me?.nextResetUtcTimestamp;
    if (!nextReset) {
      return;
    }

    setCountdown(formatCountdown(nextReset));
    const timer = window.setInterval(() => {
      setCountdown(formatCountdown(nextReset));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [me?.nextResetUtcTimestamp]);

  const isJoined = useMemo(() => isUserJoined(me), [me]);
  const hasCheckedInToday = useMemo(() => isCheckedInToday(me, devTime), [devTime, me]);
  const canRenderCheckIn = useMemo(
    () => shouldRenderCheckInButton(me, devTime),
    [devTime, me]
  );
  const isPastEffectiveDayLocked =
    isJoined && !hasCheckedInToday && me?.canCheckInToday === false;

  const refreshAfterAction = useCallback(async () => {
    await loadAll();
  }, [loadAll]);

  const onJoin = useCallback(async () => {
    try {
      setActionLoading(true);
      setError(null);
      await apiRequest('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      await refreshAfterAction();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to join challenge';
      setError(message);
    } finally {
      setActionLoading(false);
    }
  }, [refreshAfterAction]);

  const onCheckIn = useCallback(async () => {
    if (!isJoined || hasCheckedInToday) {
      return;
    }

    try {
      setActionLoading(true);
      setError(null);
      const checkInResult = await apiRequest<CheckInResponse>('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      setMe((prev) =>
        prev
          ? {
              ...prev,
              state: checkInResult.state,
              checkedInToday: true,
              nextResetUtcTimestamp: checkInResult.nextResetUtcTimestamp,
            }
          : prev
      );
      await refreshAfterAction();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to check in';
      setError(message);
      if (err instanceof ApiRequestError && err.code === 'ALREADY_CHECKED_IN' && err.state) {
        setMe((prev) =>
          prev
            ? {
                ...prev,
                state: err.state,
                checkedInToday: true,
              }
            : prev
        );
      }
      await refreshAfterAction();
    } finally {
      setActionLoading(false);
    }
  }, [hasCheckedInToday, isJoined, refreshAfterAction]);

  const onSetPrivacy = useCallback(
    async (privacy: Privacy) => {
      if (!me?.state) {
        return;
      }

      try {
        setActionLoading(true);
        setError(null);
        await apiRequest('/api/privacy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ privacy }),
        });
        await refreshAfterAction();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to update privacy setting';
        setError(message);
      } finally {
        setActionLoading(false);
      }
    },
    [me?.state, refreshAfterAction]
  );

  const onAdjustDevDayOffset = useCallback(
    async (nextOffset: number) => {
      try {
        setActionLoading(true);
        setError(null);
        await apiRequest<DevTimeResponse>('/api/dev/time', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ devDayOffset: nextOffset }),
        });
        await refreshAfterAction();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to update dev day offset';
        setError(message);
      } finally {
        setActionLoading(false);
      }
    },
    [refreshAfterAction]
  );

  const onResetDevData = useCallback(async () => {
    if (!resetConfirmArmed) {
      setResetConfirmArmed(true);
      setDevNotice(
        'Press "Confirm reset data" to wipe streaks/check-ins/leaderboard for this subreddit.'
      );
      return;
    }

    try {
      setActionLoading(true);
      setError(null);
      setDevNotice(null);
      const result = await apiRequest<DevResetResponse>('/api/dev/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      setDevNotice(
        `Reset complete. Generation ${result.stateGeneration}; offset now ${result.devDayOffset}.`
      );
      setResetConfirmArmed(false);
      await refreshAfterAction();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reset dev data';
      setError(message);
      setResetConfirmArmed(false);
    } finally {
      setActionLoading(false);
    }
  }, [refreshAfterAction, resetConfirmArmed]);

  const onLoadTemplateDefaults = useCallback(() => {
    const selected = templates.find((template) => template.id === configTemplateId);
    if (!selected) {
      setConfigError('Template defaults could not be loaded.');
      return;
    }

    setConfigError(null);
    setConfigNotice(`Loaded defaults from "${selected.label}".`);
    setConfigTitle(selected.title);
    setConfigDescription(selected.description);
    setConfigBadgeThresholdsInput(selected.badgeThresholds.join(', '));
  }, [configTemplateId, templates]);

  const onSaveConfig = useCallback(async () => {
    const title = configTitle.trim();
    const description = configDescription.trim();
    const badgeThresholds = parseBadgeThresholdInput(configBadgeThresholdsInput);

    if (!title || !description) {
      setConfigError('Title and description are required.');
      return;
    }
    if (!badgeThresholds) {
      setConfigError('Badge thresholds must be positive integers, e.g. 3, 7, 14, 30.');
      return;
    }

    try {
      setActionLoading(true);
      setConfigError(null);
      setConfigNotice(null);
      const result = await apiRequest<SaveConfigResponse>('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: configTemplateId,
          title,
          description,
          badgeThresholds,
        }),
      });
      setConfig(result.config);
      setConfigNotice('Configuration saved.');
      await refreshAfterAction();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save config';
      if (err instanceof ApiRequestError && err.details) {
        const detailText = formatValidationDetails(err.details);
        setConfigError(detailText ? `${message}: ${detailText}` : message);
      } else {
        setConfigError(message);
      }
    } finally {
      setActionLoading(false);
    }
  }, [
    configBadgeThresholdsInput,
    configDescription,
    configTemplateId,
    configTitle,
    refreshAfterAction,
  ]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 text-slate-900 p-6">
        <div className="max-w-3xl mx-auto">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 p-4 sm:p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <section className="bg-white rounded-xl p-5 border border-slate-200 space-y-3">
          <h1 className="text-2xl font-bold">{config?.title ?? 'Streak Engine'}</h1>
          <p className="text-slate-700">
            {config?.description ?? 'Join and check in daily at 00:00 UTC.'}
          </p>
          {configNeedsSetup && !me?.isModerator && (
            <div className="w-full rounded-lg bg-amber-50 text-amber-800 border border-amber-200 p-3 text-sm">
              Challenge configuration is not set yet. A moderator needs to pick a
              template and save the challenge settings first.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
              <div className="text-slate-500">Participants</div>
              <div className="text-xl font-semibold">{participantsCount}</div>
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
              <div className="text-slate-500">Checked in today</div>
              <div className="text-xl font-semibold">{checkedInTodayCount}</div>
            </div>
          </div>

          {!isJoined && (
            <button
              className="w-full h-12 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-60"
              onClick={onJoin}
              disabled={actionLoading}
            >
              Join Challenge
            </button>
          )}

          {canRenderCheckIn && (
            <button
              className="w-full h-12 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-60"
              onClick={onCheckIn}
              disabled={actionLoading}
            >
              Check in for today
            </button>
          )}

          {isJoined && hasCheckedInToday && (
            <div className="w-full rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 p-3 font-semibold text-center">
              ✅ Checked in today
            </div>
          )}

          {isPastEffectiveDayLocked && (
            <div className="w-full rounded-lg bg-amber-50 text-amber-800 border border-amber-200 p-3 text-sm text-center">
              This effective day is before your latest check-in. Move dev day
              offset forward to continue testing.
            </div>
          )}

          {me?.state && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                <div className="text-slate-500">Current streak</div>
                <div className="text-xl font-semibold">{me.state.currentStreak}</div>
              </div>
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                <div className="text-slate-500">Best streak</div>
                <div className="text-xl font-semibold">{me.state.bestStreak}</div>
              </div>
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                <div className="text-slate-500">Last check-in (UTC)</div>
                <div className="text-base font-semibold">
                  {formatUtcDay(me.state.lastCheckinDayUTC)}
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between text-sm text-slate-600 border-t border-slate-200 pt-3">
            <span>Resets at 00:00 UTC</span>
            <span className="font-mono">{countdown}</span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-slate-600">
              {me?.state ? (
                me.state.privacy === 'private' ? (
                  <span>Private (not ranked)</span>
                ) : me.myRank ? (
                  <span>My rank: #{me.myRank}</span>
                ) : (
                  <span>Public</span>
                )
              ) : (
                <span>Join to set privacy</span>
              )}
            </div>

            <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden">
              <button
                className={`px-3 py-2 text-sm ${
                  me?.state?.privacy === 'public'
                    ? 'bg-slate-800 text-white'
                    : 'bg-white text-slate-700'
                }`}
                onClick={() => onSetPrivacy('public')}
                disabled={!me?.state || actionLoading}
              >
                Public
              </button>
              <button
                className={`px-3 py-2 text-sm ${
                  me?.state?.privacy === 'private'
                    ? 'bg-slate-800 text-white'
                    : 'bg-white text-slate-700'
                }`}
                onClick={() => onSetPrivacy('private')}
                disabled={!me?.state || actionLoading}
              >
                Private
              </button>
            </div>
          </div>
        </section>

        <section className="bg-white rounded-xl p-5 border border-slate-200">
          <h2 className="text-lg font-semibold mb-3">Leaderboard</h2>
          {leaderboard.length === 0 ? (
            <p className="text-slate-600 text-sm">No ranked users yet.</p>
          ) : (
            <ol className="space-y-2">
              {leaderboard.map((entry, index) => (
                <li
                  key={entry.userId}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-6 text-sm font-semibold text-slate-500">
                      #{index + 1}
                    </span>
                    <span className="truncate text-sm font-medium">
                      {entry.displayName ?? entry.userId}
                    </span>
                  </div>
                  <div className="text-sm font-semibold">{entry.currentStreak}</div>
                </li>
              ))}
            </ol>
          )}
        </section>

        {me?.isModerator && (
          <section className="bg-white rounded-xl p-5 border border-indigo-200 space-y-3">
            <h2 className="text-lg font-semibold">Challenge Config (Moderator)</h2>
            {config?.activePostId && (
              <p className="text-sm text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
                A streak tracker already exists. Open the existing tracker instead:{' '}
                <a
                  className="underline font-medium"
                  href={`https://reddit.com/comments/${config.activePostId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {config.activePostId}
                </a>
              </p>
            )}
            {configNeedsSetup && (
              <p className="text-sm text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
                First-time setup: pick a template, adjust fields, and save before
                creating your first challenge post.
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="block mb-1 text-slate-600">Template</span>
                <select
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  value={configTemplateId}
                  onChange={(event) =>
                    setConfigTemplateId(event.target.value as TemplateId)
                  }
                  disabled={actionLoading}
                >
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-end">
                <button
                  className="w-full sm:w-auto px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                  onClick={onLoadTemplateDefaults}
                  disabled={actionLoading || templates.length === 0}
                >
                  Load template
                </button>
              </div>
            </div>

            <label className="text-sm block">
              <span className="block mb-1 text-slate-600">Title</span>
              <input
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                value={configTitle}
                onChange={(event) => setConfigTitle(event.target.value)}
                disabled={actionLoading}
              />
            </label>

            <label className="text-sm block">
              <span className="block mb-1 text-slate-600">Description</span>
              <textarea
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 min-h-24"
                value={configDescription}
                onChange={(event) => setConfigDescription(event.target.value)}
                disabled={actionLoading}
              />
            </label>

            <label className="text-sm block">
              <span className="block mb-1 text-slate-600">
                Badge thresholds (comma-separated)
              </span>
              <input
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                value={configBadgeThresholdsInput}
                onChange={(event) => setConfigBadgeThresholdsInput(event.target.value)}
                placeholder="3, 7, 14, 30"
                disabled={actionLoading}
              />
            </label>

            <div className="flex items-center gap-2">
              <button
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-60"
                onClick={onSaveConfig}
                disabled={actionLoading}
              >
                Save
              </button>
              <span className="text-xs text-slate-500">Timezone is fixed to UTC.</span>
            </div>

            {configNotice && (
              <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                {configNotice}
              </p>
            )}
            {configError && (
              <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                {configError}
              </p>
            )}
          </section>
        )}

        {me?.isModerator && devTime && (
          <section className="bg-white rounded-xl p-5 border border-amber-200 space-y-3">
            <h2 className="text-lg font-semibold">Dev Time Panel</h2>
            <p className="text-sm text-amber-700">
              DEV ONLY: Simulates day changes for testing.
            </p>
            {devNotice && (
              <p className="text-sm text-amber-800 bg-amber-100 border border-amber-300 rounded-lg px-3 py-2">
                {devNotice}
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                <div className="text-slate-500">UTC day now</div>
                <div className="text-lg font-semibold">{devTime.utcDayNumberNow}</div>
              </div>
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                <div className="text-slate-500">Offset</div>
                <div className="text-lg font-semibold">{devTime.devDayOffset}</div>
              </div>
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                <div className="text-slate-500">Effective day</div>
                <div className="text-lg font-semibold">
                  {devTime.effectiveDayNumber}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                onClick={() =>
                  onAdjustDevDayOffset((devTime?.devDayOffset ?? 0) - 1)
                }
                disabled={actionLoading}
              >
                -1 day
              </button>
              <button
                className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                onClick={() =>
                  onAdjustDevDayOffset((devTime?.devDayOffset ?? 0) + 1)
                }
                disabled={actionLoading}
              >
                +1 day
              </button>
              <button
                className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                onClick={() => onAdjustDevDayOffset(0)}
                disabled={actionLoading}
              >
                Reset to 0
              </button>
              <button
                className="px-3 py-2 rounded-lg border border-rose-300 bg-rose-50 text-rose-700 text-sm font-medium"
                onClick={onResetDevData}
                disabled={actionLoading}
              >
                {resetConfirmArmed ? 'Confirm reset data' : 'Reset all test data'}
              </button>
              {resetConfirmArmed && (
                <button
                  className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                  onClick={() => {
                    setResetConfirmArmed(false);
                    setDevNotice(null);
                  }}
                  disabled={actionLoading}
                >
                  Cancel
                </button>
              )}
            </div>
          </section>
        )}

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {error}
          </div>
        )}
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
