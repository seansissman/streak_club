import './index.css';

import { context, getWebViewMode, requestExpandedMode } from '@devvit/web/client';
import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  getCompetitionRankAtIndex,
  isCheckedInToday,
  isUserJoined,
  shouldEnableInlineCardExpand,
  shouldRenderCheckInButton,
  shouldShowInlineExpandLink,
} from './state';
import { useAccessLevel, type AccessLevel } from './use_access_level';

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
  devMode: boolean;
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
  freezeTokens: number;
  freezeSaves: number;
  badges: string[];
  isParticipant: boolean;
};

type ConfigResponse = {
  status: 'ok';
  config: ChallengeConfig;
  configNeedsSetup?: boolean;
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
  canCheckInToday?: boolean;
  nextResetUtcTimestamp: number;
  myRank: number | null;
  isModerator: boolean;
  accessLevel: AccessLevel;
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
    if (apiError?.code !== undefined) {
      this.code = apiError.code;
    }
    if (apiError?.state !== undefined) {
      this.state = apiError.state;
    }
    if (apiError?.details !== undefined) {
      this.details = apiError.details;
    }
  }
}

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

type DevResetResponse = DevTimeResponse & {
  stateGeneration: number;
};

type DevStressResponse = {
  status: 'ok';
  reports: Array<{
    ok: boolean;
    label: string;
    details?: string;
  }>;
};

type DevStatsRepairResponse = {
  status: 'ok';
  utcDayNumber: number;
  oldCheckinsToday: number;
  newCheckinsToday: number;
  todaySetSize: number;
};

type DevStatsDebugResponse = {
  status: 'ok';
  utcDayNumber: number;
  lastStatsDay: number;
  participantsTotal: number;
  checkinsToday: number;
  checkinsAllTime: number;
  longestStreakAllTime: number;
  todaySetSize: number;
};

type CheckInResponse = {
  status: 'ok';
  state: UserState;
  checkedInToday: boolean;
  nextResetUtcTimestamp: number;
  usedFreeze: boolean;
  earnedFreeze: boolean;
  tokenCount: number;
  earnedBadge: string | null;
};

type CheckInFeedback = {
  day: number;
  usedFreeze: boolean;
  earnedFreeze: boolean;
  earnedBadge: string | null;
};

type SaveConfigResponse = {
  status: 'ok';
  config: ChallengeConfig;
};

type SaveConfigBody = {
  templateId: TemplateId;
  title: string;
  description: string;
  badgeThresholds: number[];
  devMode: boolean;
  confirmTemplateChange?: boolean;
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

const formatDays = (n: number): string => (n === 1 ? '1 day' : `${n} days`);

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

const BADGE_MILESTONES: Array<{ milestone: number; badge: string }> = [
  { milestone: 7, badge: 'Committed' },
  { milestone: 30, badge: 'Consistent' },
  { milestone: 90, badge: 'Disciplined' },
  { milestone: 180, badge: 'Unstoppable' },
  { milestone: 365, badge: 'Legend' },
];

const CHECKED_IN_MESSAGES = [
  'Checked in today! Great job!',
  'Checked in today! Way to go!',
  'Checked in today! Keep it going!',
  'Checked in today! Nice work!',
  'Checked in today! Hooray!',
  'Checked in today! Another one!',
  'Checked in today! Momentum!',
  'Checked in today! Onward!',
];

const hashSeed = (seed: string): number => {
  let total = 0;
  for (const char of seed) {
    total += char.charCodeAt(0);
  }
  return total;
};

const formatLeaderboardName = (
  displayName: string | undefined,
  userId: string
): string => {
  const trimmedDisplayName = displayName?.trim();
  if (trimmedDisplayName) {
    return trimmedDisplayName;
  }

  const trimmedUserId = userId.trim();
  if (!trimmedUserId) {
    return 'unknown';
  }

  if (trimmedUserId.startsWith('t2_')) {
    return `user_${trimmedUserId.slice(3)}`;
  }

  return trimmedUserId;
};

const getHighestBadge = (badges: string[]): string | null => {
  let highestBadge: string | null = null;
  let highestMilestone = -1;

  for (const badgeEntry of BADGE_MILESTONES) {
    if (badges.includes(badgeEntry.badge) && badgeEntry.milestone > highestMilestone) {
      highestBadge = badgeEntry.badge;
      highestMilestone = badgeEntry.milestone;
    }
  }

  return highestBadge;
};

const apiRequest = async <T,>(
  path: string,
  init?: RequestInit
): Promise<T> => {
  const method = init?.method?.toUpperCase() ?? 'GET';
  const requestInit: RequestInit =
    method === 'GET' ? { ...init, cache: 'no-store' } : (init ?? {});
  const response = await fetch(path, requestInit);
  const data = (await response.json()) as
    | T
    | ApiError
    | ValidationErrorResponse;

  if (!response.ok) {
    const validationError = (data as ValidationErrorResponse).error;
    const apiError: ApiError = validationError
      ? validationError.details
        ? {
            status: 'error',
            code: validationError.code,
            message: validationError.message,
            details: validationError.details,
          }
        : {
            status: 'error',
            code: validationError.code,
            message: validationError.message,
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
  const accessLevel = useAccessLevel();
  const [config, setConfig] = useState<ChallengeConfig | null>(null);
  const [participantsTotal, setParticipantsTotal] = useState(0);
  const [checkinsToday, setCheckinsToday] = useState(0);
  const [checkinsAllTime, setCheckinsAllTime] = useState(0);
  const [longestStreakAllTime, setLongestStreakAllTime] = useState(0);
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
  const [stressReports, setStressReports] = useState<DevStressResponse['reports']>([]);
  const [devStatsDebug, setDevStatsDebug] = useState<DevStatsDebugResponse | null>(
    null
  );
  const [configTemplateId, setConfigTemplateId] = useState<TemplateId>('custom');
  const [configTitle, setConfigTitle] = useState('');
  const [configDescription, setConfigDescription] = useState('');
  const [configBadgeThresholdsInput, setConfigBadgeThresholdsInput] = useState('');
  const [configDevMode, setConfigDevMode] = useState(false);
  const [templateChangeConfirmOpen, setTemplateChangeConfirmOpen] = useState(false);
  const [pendingConfigSaveBody, setPendingConfigSaveBody] = useState<SaveConfigBody | null>(
    null
  );
  const [checkInFeedback, setCheckInFeedback] = useState<CheckInFeedback | null>(null);
  const [showCheckInCelebration, setShowCheckInCelebration] = useState(false);

  const loadAll = useCallback(async () => {
    const reqTs = Date.now();
    const [
      configRes,
      templatesRes,
      meRes,
      leaderboardRes,
      devTimeRes,
      devStatsDebugRes,
    ] = await Promise.all([
      apiRequest<ConfigResponse>(`/api/config?ts=${reqTs}`),
      apiRequest<TemplatesResponse>(`/api/templates?ts=${reqTs}`),
      apiRequest<MeResponse>(`/api/me?ts=${reqTs}`),
      apiRequest<LeaderboardResponse>(`/api/leaderboard?limit=10&ts=${reqTs}`),
      apiRequest<DevTimeResponse>(`/api/dev/time?ts=${reqTs}`).catch(() => null),
      apiRequest<DevStatsDebugResponse>(`/api/dev/stats/debug?ts=${reqTs}`).catch(
        () => null
      ),
    ]);

    setConfig(configRes.config);
    setConfigNeedsSetup(Boolean(configRes.configNeedsSetup));
    setTemplates(templatesRes.templates);
    setParticipantsTotal(configRes.stats.participantsTotal);
    setCheckinsToday(configRes.stats.checkinsToday);
    setCheckinsAllTime(configRes.stats.checkinsAllTime);
    setLongestStreakAllTime(configRes.stats.longestStreakAllTime);
    setMe(meRes);
    setLeaderboard(leaderboardRes.leaderboard);
    setDevTime(devTimeRes);
    setDevStatsDebug(devStatsDebugRes);
  }, []);

  useEffect(() => {
    if (!config) {
      return;
    }

    setConfigTemplateId(config.templateId);
    setConfigTitle(config.title);
    setConfigDescription(config.description);
    setConfigBadgeThresholdsInput(config.badgeThresholds.join(', '));
    setConfigDevMode(config.devMode === true);
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

  useEffect(() => {
    if (!showCheckInCelebration) {
      return;
    }

    const timer = window.setTimeout(() => {
      setShowCheckInCelebration(false);
    }, 1500);

    return () => window.clearTimeout(timer);
  }, [showCheckInCelebration]);

  const isJoined = useMemo(() => isUserJoined(me), [me]);
  const hasCheckedInToday = useMemo(() => isCheckedInToday(me, devTime), [devTime, me]);
  const canRenderCheckIn = useMemo(
    () => shouldRenderCheckInButton(me, devTime),
    [devTime, me]
  );
  const isPastEffectiveDayLocked =
    isJoined && !hasCheckedInToday && me?.canCheckInToday === false;
  const isCurrentCheckInFeedback =
    checkInFeedback?.day !== undefined &&
    checkInFeedback.day === me?.state?.lastCheckinDayUTC;
  const mode = getWebViewMode();
  const isTouch =
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
      ? true
      : window.matchMedia('(pointer: coarse)').matches;
  const isInlineMode = mode === 'inline';
  const shouldShowExpandButton = mode === 'inline' && isTouch;
  const isInlineExpandLinkVisible = shouldShowInlineExpandLink(isInlineMode);
  const shouldEnableCardExpand = shouldEnableInlineCardExpand(isInlineMode);
  const canUseModTools = accessLevel === 'mod' || accessLevel === 'dev';
  const showDevToolsPanel = accessLevel === 'dev';
  const highestBadge = me?.state ? getHighestBadge(me.state.badges) : null;
  const checkedInEncouragement = useMemo(() => {
    const effectiveUtcDay =
      devTime?.effectiveDayNumber ??
      me?.state?.lastCheckinDayUTC ??
      Math.floor(Date.now() / MILLIS_PER_DAY);
    const userSeed = context.username ?? me?.state?.joinedAt ?? 'anonymous';
    const seed = `${userSeed}:${effectiveUtcDay}`;
    const index = hashSeed(seed) % CHECKED_IN_MESSAGES.length;
    return CHECKED_IN_MESSAGES[index];
  }, [devTime?.effectiveDayNumber, me?.state?.joinedAt, me?.state?.lastCheckinDayUTC]);

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
      setCheckInFeedback(null);
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
      setCheckInFeedback(null);
      const checkInResult = await apiRequest<CheckInResponse>('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      setCheckInFeedback({
        day: checkInResult.state.lastCheckinDayUTC ?? -1,
        usedFreeze: checkInResult.usedFreeze,
        earnedFreeze: checkInResult.earnedFreeze,
        earnedBadge: checkInResult.earnedBadge,
      });
      setShowCheckInCelebration(true);
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
      const alreadyCheckedInState =
        err instanceof ApiRequestError ? err.state : null;
      if (
        err instanceof ApiRequestError &&
        err.code === 'ALREADY_CHECKED_IN' &&
        alreadyCheckedInState
      ) {
        setMe((prev) =>
          prev
            ? {
                ...prev,
                state: alreadyCheckedInState,
                checkedInToday: true,
              }
            : prev
        );
      }
      setCheckInFeedback(null);
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

  const onAdjustDevTimeOffset = useCallback(
    async (deltaSeconds: number) => {
      const currentOffset = devTime?.devTimeOffsetSeconds ?? 0;
      const nextOffset = currentOffset + deltaSeconds;
      try {
        setActionLoading(true);
        setError(null);
        await apiRequest<DevTimeResponse>('/api/dev/time', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ devTimeOffsetSeconds: nextOffset }),
        });
        await refreshAfterAction();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to update dev time offset';
        setError(message);
      } finally {
        setActionLoading(false);
      }
    },
    [devTime?.devTimeOffsetSeconds, refreshAfterAction]
  );

  const onSetDevTimeOffset = useCallback(
    async (nextOffsetSeconds: number) => {
      try {
        setActionLoading(true);
        setError(null);
        await apiRequest<DevTimeResponse>('/api/dev/time', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ devTimeOffsetSeconds: nextOffsetSeconds }),
        });
        await refreshAfterAction();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to set dev time offset';
        setError(message);
      } finally {
        setActionLoading(false);
      }
    },
    [refreshAfterAction]
  );

  const onRunBoundaryStress = useCallback(async () => {
    try {
      setActionLoading(true);
      setError(null);
      const result = await apiRequest<DevStressResponse>('/api/dev/stress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      setStressReports(result.reports);
      const passed = result.reports.filter((report) => report.ok).length;
      setDevNotice(`Boundary stress complete: ${passed}/${result.reports.length} checks passed.`);
      await refreshAfterAction();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to run boundary stress';
      setError(message);
    } finally {
      setActionLoading(false);
    }
  }, [refreshAfterAction]);

  const onRepairTodayStats = useCallback(async () => {
    try {
      setActionLoading(true);
      setError(null);
      const result = await apiRequest<DevStatsRepairResponse>('/api/dev/stats/repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      setDevNotice(
        `Repaired today stats (day ${result.utcDayNumber}): ${result.oldCheckinsToday} -> ${result.newCheckinsToday} (set size ${result.todaySetSize}).`
      );
      await refreshAfterAction();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to repair today stats';
      setError(message);
    } finally {
      setActionLoading(false);
    }
  }, [refreshAfterAction]);

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
        `Reset complete. Generation ${result.stateGeneration}; offset now ${result.devTimeOffsetSeconds}s.`
      );
      setStressReports([]);
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

  const saveConfig = useCallback(
    async (body: SaveConfigBody) => {
      try {
        setActionLoading(true);
        setConfigError(null);
        setConfigNotice(null);
        const result = await apiRequest<SaveConfigResponse>('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        setConfig(result.config);
        setConfigNotice('Configuration saved.');
        setTemplateChangeConfirmOpen(false);
        setPendingConfigSaveBody(null);
        await refreshAfterAction();
      } catch (err) {
        if (
          err instanceof ApiRequestError &&
          err.code === 'TEMPLATE_CHANGE_CONFIRM_REQUIRED'
        ) {
          setPendingConfigSaveBody(body);
          setTemplateChangeConfirmOpen(true);
          return;
        }

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
    },
    [refreshAfterAction]
  );

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
    await saveConfig({
      templateId: configTemplateId,
      title,
      description,
      badgeThresholds,
      devMode: configDevMode,
    });
  }, [
    configBadgeThresholdsInput,
    configDevMode,
    configDescription,
    configTemplateId,
    configTitle,
    saveConfig,
  ]);

  if (loading) {
    return (
      <div className="bg-slate-100 text-slate-900 p-6">
        <div className="max-w-3xl mx-auto">Loading...</div>
      </div>
    );
  }

  return (
    <div className="bg-slate-100 text-slate-900 p-3 sm:p-4">
      <div className="max-w-3xl mx-auto space-y-3">
        <section className="bg-white rounded-xl p-4 border border-slate-200 space-y-2">
          <h1 className="text-2xl font-bold">{config?.title ?? 'Streak Engine'}</h1>
          <p className="text-slate-700">
            {config?.description ?? 'Join and check in daily at 00:00 UTC.'}
            {isInlineExpandLinkVisible && (
              <>
                {' '}
                <button
                  className="text-xs text-slate-500 underline hover:text-slate-700 align-baseline"
                  onClick={(event) => requestExpandedMode(event.nativeEvent, 'app')}
                >
                  View full tracker
                </button>
              </>
            )}
          </p>

          {!isJoined && (
            <div className="flex justify-center">
              <button
                className="w-3/4 h-12 rounded-lg border border-blue-800/30 bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-60"
                onClick={onJoin}
                disabled={actionLoading}
              >
                Join Challenge
              </button>
            </div>
          )}

          {(canRenderCheckIn || (isJoined && hasCheckedInToday)) && (
            <div className="flex flex-col items-center">
              {canRenderCheckIn ? (
                <button
                  className="w-3/4 h-12 rounded-lg border border-emerald-800/30 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-60"
                  onClick={onCheckIn}
                  disabled={actionLoading}
                >
                  Check in for today
                </button>
              ) : (
                <div className="w-3/4 h-12 rounded-lg border border-emerald-300 bg-emerald-100 text-emerald-800 font-semibold flex items-center justify-center">
                  {checkedInEncouragement}
                </div>
              )}
              {showCheckInCelebration && (
                <div className="mt-1 text-center text-sm font-semibold text-emerald-700">
                  🎉👏✨
                </div>
              )}
            </div>
          )}

          {configNeedsSetup && accessLevel === 'user' && (
            <div className="w-full rounded-lg bg-amber-50 text-amber-800 border border-amber-200 p-3 text-sm">
              Challenge configuration is not set yet. A moderator needs to pick a
              template and save the challenge settings first.
            </div>
          )}

          {isPastEffectiveDayLocked && (
            <div className="w-full rounded-lg bg-amber-50 text-amber-800 border border-amber-200 p-3 text-sm text-center">
              This effective day is before your latest check-in. Move dev day
              offset forward to continue testing.
            </div>
          )}

          {me?.state && isCurrentCheckInFeedback && checkInFeedback.usedFreeze && (
            <div className="w-full rounded-lg bg-sky-50 text-sky-800 border border-sky-200 px-3 py-2 text-sm">
              ❄️ Freeze Token used - your streak stayed alive.
            </div>
          )}

          {me?.state && isCurrentCheckInFeedback && checkInFeedback.earnedFreeze && (
            <div className="w-full rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 px-3 py-2 text-sm">
              🎉 You earned a Freeze Token!
            </div>
          )}

          {me?.state &&
            isCurrentCheckInFeedback &&
            checkInFeedback.earnedBadge !== null && (
              <div className="w-full rounded-lg bg-amber-50 text-amber-800 border border-amber-200 px-3 py-2 text-sm">
                🏅 New Badge Unlocked: {checkInFeedback.earnedBadge}
              </div>
            )}

          {me?.state && (
            <div
              className={`rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm ${
                shouldEnableCardExpand ? 'cursor-pointer' : ''
              }`}
              onClick={
                shouldEnableCardExpand
                  ? (event) => requestExpandedMode(event.nativeEvent, 'app')
                  : undefined
              }
            >
              <div className="text-base font-semibold text-slate-900">
                🔥 Current Streak: {formatDays(me.state.currentStreak)}
              </div>
              <div className="text-sm text-slate-700">
                ❄️ Freeze Tokens: {me.state.freezeTokens}
              </div>
              {me.state.freezeTokens === 0 && (
                <div className="text-xs text-slate-600 mt-1">
                  Reach a 7-day streak to unlock protection.
                </div>
              )}
              <div className="text-xs text-slate-600 mt-1">
                One token preserves your streak for one missed day.
              </div>
            </div>
          )}

          {me?.state && (
            <div
              className={`rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm ${
                shouldEnableCardExpand ? 'cursor-pointer' : ''
              }`}
              onClick={
                shouldEnableCardExpand
                  ? (event) => requestExpandedMode(event.nativeEvent, 'app')
                  : undefined
              }
            >
              <div className="text-base font-semibold text-slate-900">
                🔥 Best Streak: {formatDays(me.state.bestStreak)}
              </div>
              <div className="text-sm text-slate-700">🏅 Badge: {highestBadge ?? '—'}</div>
            </div>
          )}

          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 space-y-2">
            <div className="flex items-center justify-between text-sm text-slate-600">
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

              <div className="inline-flex rounded-lg border border-slate-300">
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
          </div>

          {shouldShowExpandButton && (
            <div className="flex justify-center py-1">
              <button
                className="text-xs text-slate-600 underline hover:text-slate-800"
                onClick={(event) => requestExpandedMode(event.nativeEvent, 'app')}
              >
                Expand
              </button>
            </div>
          )}

          {me?.state && (
            <div
              className={`rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm flex items-center justify-between ${
                shouldEnableCardExpand ? 'cursor-pointer' : ''
              }`}
              onClick={
                shouldEnableCardExpand
                  ? (event) => requestExpandedMode(event.nativeEvent, 'app')
                  : undefined
              }
            >
              <div className="text-slate-500">Last check-in</div>
              <div className="text-base font-semibold">
                {formatUtcDay(me.state.lastCheckinDayUTC)}
              </div>
            </div>
          )}

          {isInlineMode && (
            <div className="text-center text-[11px] text-slate-500">
              Tip: Tap a card to expand.
            </div>
          )}
        </section>

        <section className="bg-white rounded-xl p-4 border border-slate-200">
          <h2 className="text-lg font-semibold mb-3">Leaderboard</h2>
          {leaderboard.length === 0 ? (
            <p className="text-slate-600 text-sm">No ranked users yet.</p>
          ) : (
            <ol className="space-y-1.5">
              {leaderboard.map((entry, index) => (
                <li
                  key={entry.userId}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="w-7 shrink-0 text-left text-sm font-semibold text-slate-500">
                      #{getCompetitionRankAtIndex(leaderboard, index)}
                    </span>
                    <span className="min-w-0 flex-1 truncate whitespace-nowrap text-sm font-medium text-slate-900">
                      {formatLeaderboardName(entry.displayName, entry.userId)}
                    </span>
                  </div>
                  <div className="min-w-8 shrink-0 text-right text-sm font-semibold tabular-nums">
                    {entry.currentStreak}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="bg-white rounded-xl p-4 border border-slate-200">
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm space-y-1">
            <div className="font-semibold text-slate-800">📈 Stats</div>
            <div className="text-slate-700">• Participants: {participantsTotal}</div>
            <div className="text-slate-700">• Check-ins today (UTC): {checkinsToday}</div>
            <div className="text-slate-700">• Total check-ins: {checkinsAllTime}</div>
            <div className="text-slate-700">
              • Longest streak: {longestStreakAllTime} days
            </div>
          </div>
        </section>

        {canUseModTools && (
          <section className="bg-white rounded-xl p-4 border border-slate-200 space-y-2">
            <h2 className="text-base font-semibold">Setup / Admin</h2>
            {config?.activePostId ? (
              <p className="text-sm text-slate-700">
                Active tracker post:{' '}
                <a
                  className="underline font-medium"
                  href={`https://reddit.com/comments/${config.activePostId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {config.activePostId}
                </a>
                . If this post is unpinned, engagement will drop.
              </p>
            ) : (
              <p className="text-sm text-amber-700">
                No active tracker post found. Create one to start.
              </p>
            )}
            <p className="text-xs text-slate-600">
              After posting, pin this tracker post in your subreddit.
            </p>
            <p className="text-xs text-slate-600">
              Changing templates does not change streak rules (copy-only).
            </p>
            <p className="text-xs text-slate-600">
              Do not delete the active post; it will break continuity.
            </p>
            <div className="pt-1">
              <button
                className="px-3 py-2 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 text-sm font-medium"
                onClick={onRepairTodayStats}
                disabled={actionLoading}
              >
                Repair Today Stats
              </button>
            </div>
          </section>
        )}

        {canUseModTools && (
          <section className="bg-white rounded-xl p-5 border border-indigo-200 space-y-3">
            <h2 className="text-lg font-semibold">Challenge Config (Moderator)</h2>
            <p className="text-xs text-slate-500">Only one active tracker per subreddit.</p>
            {configNeedsSetup && (
              <p className="text-sm text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
                First-time setup: pick a template, adjust fields, and save before
                creating your first challenge post.
              </p>
            )}

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
              <h3 className="text-sm font-semibold text-slate-800">Template Selection</h3>
              <p className="text-xs text-slate-600">
                Templates provide recommended wording and badge milestones.
              </p>
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
            </div>

            <div className="rounded-lg border border-slate-200 p-3 space-y-3">
              <h3 className="text-sm font-semibold text-slate-800">Editable Fields</h3>
              <p className="text-xs text-slate-600">
                You can edit these anytime without affecting user streaks.
              </p>
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
                  onChange={(event) =>
                    setConfigBadgeThresholdsInput(event.target.value)
                  }
                  placeholder="3, 7, 14, 30"
                  disabled={actionLoading}
                />
              </label>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={configDevMode}
                  onChange={(event) => setConfigDevMode(event.target.checked)}
                  disabled={actionLoading}
                />
                Enable dev tools in production (mods only)
              </label>
            </div>

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

        {showDevToolsPanel && devTime && (
          <section className="bg-white rounded-xl p-5 border border-amber-200 space-y-3">
            <h2 className="text-lg font-semibold">UTC Reset Test Panel</h2>
            <p className="text-sm text-amber-700">
              DEV ONLY: Simulates UTC time to stress reset boundaries.
            </p>
            {devNotice && (
              <p className="text-sm text-amber-800 bg-amber-100 border border-amber-300 rounded-lg px-3 py-2">
                {devNotice}
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                <div className="text-slate-500">Simulated UTC</div>
                <div className="text-sm font-semibold break-all">
                  {devTime.simulatedUtcNow}
                </div>
              </div>
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                <div className="text-slate-500">UTC day now</div>
                <div className="text-lg font-semibold">{devTime.utcDayNumberNow}</div>
              </div>
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                <div className="text-slate-500">Seconds until reset</div>
                <div className="text-lg font-semibold">{devTime.secondsUntilReset}s</div>
              </div>
            </div>
            <div className="text-sm text-slate-600">
              Offset: {devTime.devTimeOffsetSeconds}s
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                onClick={() => onAdjustDevTimeOffset(10)}
                disabled={actionLoading}
              >
                +10s
              </button>
              <button
                className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                onClick={() => onAdjustDevTimeOffset(60)}
                disabled={actionLoading}
              >
                +60s
              </button>
              <button
                className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                onClick={() => onAdjustDevTimeOffset(600)}
                disabled={actionLoading}
              >
                +10m
              </button>
              <button
                className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                onClick={() => onAdjustDevTimeOffset(3600)}
                disabled={actionLoading}
              >
                +1h
              </button>
              <button
                className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                onClick={() => onAdjustDevTimeOffset(82_800)}
                disabled={actionLoading}
              >
                +23h
              </button>
              <button
                className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                onClick={() => onAdjustDevTimeOffset(86_400)}
                disabled={actionLoading}
              >
                +24h
              </button>
              <button
                className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                onClick={() => onAdjustDevTimeOffset(90_000)}
                disabled={actionLoading}
              >
                +25h
              </button>
              <button
                className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                onClick={() => onSetDevTimeOffset(0)}
                disabled={actionLoading}
              >
                Reset offset (0)
              </button>
              <button
                className="px-3 py-2 rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-700 text-sm font-medium"
                onClick={onRunBoundaryStress}
                disabled={actionLoading}
              >
                Run Boundary Stress
              </button>
              <button
                className="px-3 py-2 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 text-sm font-medium"
                onClick={onRepairTodayStats}
                disabled={actionLoading}
              >
                Repair Today Stats
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
            {stressReports.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-1 text-sm">
                {stressReports.map((report, index) => (
                  <div key={`${report.label}-${index}`} className="text-slate-700">
                    {report.ok ? '✅' : '❌'} {report.label}
                    {report.details ? ` (${report.details})` : ''}
                  </div>
                ))}
              </div>
            )}
            {devStatsDebug && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 font-mono break-all">
                utcDay={devStatsDebug.utcDayNumber} lastStatsDay={devStatsDebug.lastStatsDay}{' '}
                participants={devStatsDebug.participantsTotal} checkinsToday=
                {devStatsDebug.checkinsToday} checkinsAllTime=
                {devStatsDebug.checkinsAllTime} longestStreak=
                {devStatsDebug.longestStreakAllTime} todaySetSize=
                {devStatsDebug.todaySetSize}
              </div>
            )}
          </section>
        )}

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {error}
          </div>
        )}
      </div>

      {templateChangeConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <h3 className="text-lg font-semibold">Confirm Template Change</h3>
            <p className="text-sm text-slate-700">
              Changing template affects all users. Continue?
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                onClick={() => {
                  setTemplateChangeConfirmOpen(false);
                  setPendingConfigSaveBody(null);
                }}
                disabled={actionLoading}
              >
                Cancel
              </button>
              <button
                className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-60"
                onClick={async () => {
                  if (!pendingConfigSaveBody) {
                    return;
                  }
                  await saveConfig({
                    ...pendingConfigSaveBody,
                    confirmTemplateChange: true,
                  });
                }}
                disabled={actionLoading || !pendingConfigSaveBody}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
