import 'dotenv/config';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { chromium } from '@playwright/test';

const modAuthPath =
  process.env.STREAK_CLUB_MOD_AUTH ?? 'playwright/.auth/reddit-mod.json';
const userAuthPath =
  process.env.STREAK_CLUB_USER_AUTH ?? 'playwright/.auth/reddit-user.json';
const redditLoginUrl = process.env.STREAK_CLUB_REDDIT_LOGIN_URL ?? 'https://www.reddit.com/login';

const waitForEnter = async (label) => {
  if (!process.stdin.isTTY) {
    throw new Error(
      `Manual auth setup for ${label} requires an interactive terminal.`
    );
  }

  const readline = createInterface({ input, output });
  try {
    await readline.question(
      `Log in to Reddit as the ${label} account in the opened browser, then return here and press Enter to save storage state. `
    );
  } finally {
    readline.close();
  }
};

const saveAuthState = async ({ label, authPath }) => {
  await mkdir(dirname(authPath), { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log(`Opening Reddit for ${label} auth setup...`);
    await page.goto(redditLoginUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await waitForEnter(label);
    await context.storageState({ path: authPath });
    console.log(`Saved ${label} auth state to ${authPath}`);
  } finally {
    await browser.close();
  }
};

await saveAuthState({
  label: 'moderator/admin',
  authPath: modAuthPath,
});

await saveAuthState({
  label: 'normal user',
  authPath: userAuthPath,
});

console.log('Reddit auth setup complete.');
