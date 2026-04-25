# Staging E2E Smoke Tests

These Playwright tests are a small smoke suite for the real Reddit staging install of Streak Club. They are intentionally separate from `npm run test` and should not run in CI by default.

Use them only against the dedicated staging subreddit. The staging subreddit ID is `t5_gqefuq`.

## Coverage

- Normal user can load the tracker without admin or dev/playtest controls.
- Normal user can join and check in, while tolerating already-joined or already-checked-in state.
- Status card row order and countdown format are sane.
- Privacy toggle updates and is restored to the original state.
- Moderator can see setup/admin and staging controls in staging.
- Playtest-only dev tools are not expected in the real staging install.

The optional +1 day staging simulation is manual-only for now. It mutates shared staging state and should be run only when you have a clear cleanup/reset plan.

## Install Playwright

If `@playwright/test` is not installed, run:

```bash
npm install --save-dev @playwright/test
npx playwright install chromium
```

The package install could not be completed in the Codex environment because npm registry access returned `EAI_AGAIN`.

## Environment

Create a local `.env` or export these variables in your shell. Do not commit real auth files or secrets.

```bash
STREAK_CLUB_STAGING_URL=https://www.reddit.com/r/YOUR_STAGING_SUBREDDIT/comments/YOUR_TRACKER_POST_ID/
STREAK_CLUB_STAGING_SUBREDDIT=YOUR_STAGING_SUBREDDIT
STREAK_CLUB_MOD_AUTH=playwright/.auth/reddit-mod.json
STREAK_CLUB_USER_AUTH=playwright/.auth/reddit-user.json
```

`STREAK_CLUB_STAGING_URL` should point to the actual staging tracker/post URL, not a production subreddit and not Playtest.

## Save Auth State

The auth setup does not automate Reddit credentials. It is a plain Node script that opens Reddit in a headed Chromium browser and waits for you to manually log in with the existing Reddit account.

```bash
npm run test:e2e:auth
```

Steps:

1. The script opens `https://www.reddit.com/login` for the moderator/admin account.
2. Log in manually to Reddit if needed.
3. Return to the terminal and press Enter to save `playwright/.auth/reddit-mod.json`.
4. The script opens a second browser window for the normal user account.
5. Log in manually to Reddit if needed.
6. Return to the terminal and press Enter to save `playwright/.auth/reddit-user.json`.

The auth directory is ignored by git.

## Run Staging Smoke Tests

After Playwright is installed, env vars are set, and auth state files exist:

```bash
npm run test:e2e:staging
```

The tests run serially and collect screenshots, videos, and traces on failure under Playwright's normal output folders. Those folders are ignored by git.
