import { settings } from '@devvit/web/server';

export type DevToolsGate = {
  enabled: boolean;
  reason: string;
  debug: {
    envVarTrue: boolean;
    settingTrue: boolean;
    isPlaytest: boolean;
  };
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

const isPlaytestContext = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  if ('isPlaytest' in value && value.isPlaytest === true) {
    return true;
  }

  if ('appVersion' in value && typeof value.appVersion === 'string') {
    const appVersion = value.appVersion.trim();
    const numericParts = appVersion
      .split('.')
      .map((part) => Number.parseInt(part, 10))
      .filter((part) => Number.isInteger(part));
    if (numericParts.length >= 4) {
      return true;
    }
  }

  if (
    'subredditName' in value &&
    typeof value.subredditName === 'string' &&
    value.subredditName.toLowerCase().endsWith('_dev')
  ) {
    return true;
  }

  if (
    !('metadata' in value) ||
    typeof value.metadata !== 'object' ||
    value.metadata === null
  ) {
    return false;
  }

  return Object.entries(value.metadata).some(([key, metadataValue]) => {
    if (key.toLowerCase().includes('playtest')) {
      return true;
    }

    if (
      typeof metadataValue !== 'object' ||
      metadataValue === null ||
      !('values' in metadataValue) ||
      !Array.isArray(metadataValue.values)
    ) {
      return false;
    }

    return metadataValue.values.some(
      (entry: unknown) =>
        typeof entry === 'string' && entry.toLowerCase().includes('playtest')
    );
  });
};

export const getDevToolsGate = async (context: unknown): Promise<DevToolsGate> => {
  const envVarTrue = process.env.DEV_TOOLS_ENABLED === 'true';
  const isPlaytest = isPlaytestContext(context);
  const envEnabled = envVarTrue && isPlaytest;

  let settingEnabled = false;
  try {
    settingEnabled = (await settings.get<boolean>('devToolsEnabled')) === true;
  } catch {
    settingEnabled = false;
  }

  return {
    enabled: settingEnabled || envEnabled,
    reason: getReason(envEnabled, settingEnabled),
    debug: {
      envVarTrue,
      settingTrue: settingEnabled,
      isPlaytest,
    },
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
