import { settings } from '@devvit/web/server';

export type DebugGateInfo = {
  enabled: boolean;
  reason: string;
  build: string;
};

type DebugGateContext = {
  subredditId?: string;
};

const GIT_SHA_ENV_KEYS = [
  'APP_GIT_SHA',
  'GIT_SHA',
  'VERCEL_GIT_COMMIT_SHA',
  'GITHUB_SHA',
  'COMMIT_SHA',
] as const;

const getReason = (envEnabled: boolean, settingEnabled: boolean): string => {
  if (envEnabled && settingEnabled) {
    return 'both';
  }

  if (envEnabled) {
    return 'env(playtest)';
  }

  if (settingEnabled) {
    return 'setting(devToolsEnabled)';
  }

  return 'off';
};

const getShortGitSha = (): string | null => {
  for (const key of GIT_SHA_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (!value) {
      continue;
    }

    return value.slice(0, 7);
  }

  return null;
};

const getBuildVersion = (): string => {
  const version =
    process.env.APP_VERSION?.trim() || process.env.npm_package_version?.trim() || '0.0.0';
  const gitSha = getShortGitSha();

  if (!gitSha) {
    return version;
  }

  return `${version}+${gitSha}`;
};

const runDebugGateSanityCheck = (): void => {
  console.assert(getReason(false, false) === 'off', 'debug gate reason check failed for off');
  console.assert(
    getReason(true, false) === 'env(playtest)',
    'debug gate reason check failed for env(playtest)'
  );
  console.assert(
    getReason(false, true) === 'setting(devToolsEnabled)',
    'debug gate reason check failed for setting(devToolsEnabled)'
  );
  console.assert(getReason(true, true) === 'both', 'debug gate reason check failed for both');
};

runDebugGateSanityCheck();

export const getDebugGateInfo = async (_context: DebugGateContext): Promise<DebugGateInfo> => {
  const envEnabled = process.env.DEV_TOOLS_ENABLED === 'true';

  let settingEnabled = false;
  try {
    settingEnabled = (await settings.get<boolean>('devToolsEnabled')) === true;
  } catch {
    settingEnabled = false;
  }

  return {
    enabled: envEnabled || settingEnabled,
    reason: getReason(envEnabled, settingEnabled),
    build: getBuildVersion(),
  };
};
