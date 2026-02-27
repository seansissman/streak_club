import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { devvit } from '@devvit/start/vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const packageJsonText = readFileSync(new URL('./package.json', import.meta.url), 'utf8');
const packageJsonData: unknown = JSON.parse(packageJsonText);
const appVersion =
  typeof packageJsonData === 'object' &&
  packageJsonData !== null &&
  'version' in packageJsonData &&
  typeof packageJsonData.version === 'string'
    ? packageJsonData.version
    : '0.0.0';

const gitSha = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
})();

export default defineConfig({
  define: {
    'process.env.APP_VERSION': JSON.stringify(appVersion),
    'process.env.APP_GIT_SHA': JSON.stringify(gitSha),
  },
  plugins: [react(), tailwind(), devvit()],
});
