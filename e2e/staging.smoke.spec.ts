import { existsSync } from 'node:fs';
import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';

const stagingUrl = process.env.STREAK_CLUB_STAGING_URL;
const stagingSubreddit = process.env.STREAK_CLUB_STAGING_SUBREDDIT;
const modAuthPath = process.env.STREAK_CLUB_MOD_AUTH ?? 'playwright/.auth/reddit-mod.json';
const userAuthPath = process.env.STREAK_CLUB_USER_AUTH ?? 'playwright/.auth/reddit-user.json';
const canRun =
  Boolean(stagingUrl) &&
  Boolean(stagingSubreddit) &&
  existsSync(modAuthPath) &&
  existsSync(userAuthPath);

type AppHandle = {
  page: Page;
  root: Locator;
};

test.describe.configure({ mode: 'serial' });
test.skip(
  !canRun,
  'Set STREAK_CLUB_STAGING_URL/STREAK_CLUB_STAGING_SUBREDDIT and create both Reddit auth states before running staging smoke tests.'
);

const appTestId = 'streak-club-app';
const hhmmssPattern = /\b\d{2}:\d{2}:\d{2}\b/;

const waitForAppRoot = async (page: Page): Promise<Locator> => {
  await expect
    .poll(
      async () => {
        if ((await page.getByTestId(appTestId).count()) > 0) {
          return true;
        }

        for (const frame of page.frames()) {
          if ((await frame.getByTestId(appTestId).count()) > 0) {
            return true;
          }
        }

        return false;
      },
      {
        timeout: 60_000,
        message: 'waiting for Streak Club webview to render',
      }
    )
    .toBe(true);

  const pageRoot = page.getByTestId(appTestId).first();
  if ((await pageRoot.count()) > 0) {
    return pageRoot;
  }

  for (const frame of page.frames()) {
    const frameRoot = frame.getByTestId(appTestId).first();
    if ((await frameRoot.count()) > 0) {
      return frameRoot;
    }
  }

  throw new Error('Streak Club app root was not found after wait.');
};

const openTracker = async (browser: Browser, storageState: string): Promise<AppHandle> => {
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();
  await page.goto(stagingUrl ?? '', {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  const root = await waitForAppRoot(page);
  await expect(root).toBeVisible();
  return { page, root };
};

const isVisible = async (locator: Locator, timeout = 2_000): Promise<boolean> => {
  try {
    await locator.first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
};

const ensureJoined = async (root: Locator): Promise<void> => {
  const joinButton = root.getByTestId('join-button');
  if (await isVisible(joinButton)) {
    await joinButton.click();
    await expect(
      root.getByTestId('check-in-button').or(root.getByTestId('checked-in-state'))
    ).toBeVisible({ timeout: 30_000 });
  }
};

const checkInIfAvailable = async (root: Locator): Promise<void> => {
  const checkInButton = root.getByTestId('check-in-button');
  if (await isVisible(checkInButton)) {
    await checkInButton.click();
    await expect(
      root.getByTestId('checked-in-state').or(root.getByText(/already checked in/i))
    ).toBeVisible({ timeout: 30_000 });
  }
};

const expectNoDevOrAdminForUser = async (root: Locator): Promise<void> => {
  await expect(root.getByTestId('admin-panel')).toHaveCount(0);
  await expect(root.getByTestId('staging-test-controls')).toHaveCount(0);
  await expect(root.getByTestId('dev-tools-panel')).toHaveCount(0);
};

test('normal user can load staging tracker without admin or dev tools', async ({ browser }) => {
  const { page, root } = await openTracker(browser, userAuthPath);
  await expect(root).toContainText(/Streak|Challenge|Club/i);
  await expect(root.getByTestId('status-card')).toBeVisible();
  await expect(root.getByTestId('leaderboard')).toBeVisible();
  await expectNoDevOrAdminForUser(root);
  await page.context().close();
});

test('normal user join and check-in smoke path is tolerant of existing state', async ({ browser }) => {
  const { page, root } = await openTracker(browser, userAuthPath);
  await ensureJoined(root);
  await expect(
    root.getByTestId('check-in-button').or(root.getByTestId('checked-in-state'))
  ).toBeVisible({ timeout: 30_000 });

  await checkInIfAvailable(root);
  await expect(root.getByTestId('status-card')).toBeVisible();

  const checkInButton = root.getByTestId('check-in-button');
  if (await isVisible(checkInButton)) {
    await checkInButton.click();
    await expect(root).toBeVisible();
  }

  await page.context().close();
});

test('status card has stable row order and countdown formats', async ({ browser }) => {
  const { page, root } = await openTracker(browser, userAuthPath);
  await ensureJoined(root);
  const statusCard = root.getByTestId('status-card');
  await expect(statusCard).toBeVisible();

  const rowIds = [
    'last-check-in-row',
    'reset-countdown-row',
    'next-check-in-due-row',
    'my-rank-row',
    'privacy-toggle',
  ];
  const boxes = await Promise.all(
    rowIds.map(async (id) => {
      const box = await statusCard.getByTestId(id).boundingBox();
      if (!box) {
        throw new Error(`Missing status row ${id}`);
      }
      return box;
    })
  );

  expect(boxes[0].y).toBeLessThanOrEqual(boxes[1].y);
  expect(boxes[1].y).toBeLessThanOrEqual(boxes[2].y);
  expect(boxes[2].y).toBeLessThanOrEqual(boxes[3].y);
  expect(boxes[3].y).toBeLessThanOrEqual(boxes[4].y);
  await expect(statusCard.getByTestId('reset-countdown-row')).toContainText(
    /Resets at 00:00 UTC in/
  );
  await expect(statusCard.getByTestId('reset-countdown-row')).toContainText(
    hhmmssPattern
  );
  await expect(statusCard.getByTestId('next-check-in-due-row')).toContainText(
    /Next check-in due in/
  );
  await expect(statusCard.getByTestId('next-check-in-due-row')).toContainText(
    hhmmssPattern
  );
  await page.context().close();
});

test('privacy toggle updates and restores original visibility state', async ({ browser }) => {
  const { page, root } = await openTracker(browser, userAuthPath);
  await ensureJoined(root);

  const rankRow = root.getByTestId('my-rank-row');
  const originalText = await rankRow.textContent();
  const startedPrivate = originalText?.includes('hidden (private)') ?? false;
  const firstTarget = startedPrivate ? 'privacy-public-button' : 'privacy-private-button';
  const restoreTarget = startedPrivate ? 'privacy-private-button' : 'privacy-public-button';

  await root.getByTestId(firstTarget).click();
  await expect(rankRow).toContainText(
    startedPrivate ? /My rank:/ : /hidden \(private\)/,
    { timeout: 30_000 }
  );

  await root.getByTestId(restoreTarget).click();
  await expect(rankRow).toContainText(
    startedPrivate ? /hidden \(private\)/ : /My rank:/,
    { timeout: 30_000 }
  );

  await page.context().close();
});

test('moderator sees staging controls but not playtest dev tools in real staging install', async ({ browser }) => {
  const { page, root } = await openTracker(browser, modAuthPath);
  await expect(root.getByTestId('admin-panel')).toBeVisible({ timeout: 30_000 });
  await expect(root.getByTestId('staging-test-controls')).toBeVisible({
    timeout: 30_000,
  });
  await expect(root.getByTestId('dev-tools-panel')).toHaveCount(0);
  await page.context().close();
});
