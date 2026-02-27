import { settings } from '@devvit/web/server';

export type DevToolsGate = {
  enabled: boolean;
  reason: string;
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
    return 'env';
  }

  if (settingEnabled) {
    return 'setting';
  }

  return 'off';
};

export const getDevToolsGate = async (_context: unknown): Promise<DevToolsGate> => {
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
  };
};

const getShortGitSha = (): string | null => {
  for (const key of GIT_SHA_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value) {
      return value.slice(0, 7);
    }
  }

  return null;
};

export const getDevBuildLabel = (): string => {
  const version = process.env.APP_VERSION?.trim() || process.env.npm_package_version?.trim() || '0.0.0';
  const shortSha = getShortGitSha();

  return shortSha ? `${version}+${shortSha}` : version;
};

/*
Manual verification checklist:
1) Playtest with DEV_TOOLS_ENABLED=true -> dev panel visible
2) Playtest with DEV_TOOLS_ENABLED unset and devToolsEnabled=false -> dev panel hidden
3) Published install -> dev panel hidden
*/
