# Staging E2E Smoke Tests

These Playwright tests exercise the real Reddit staging install of Streak Club. They are intentionally separate from `npm run test` and should not run in CI by default.

Use them only against explicitly configured test subreddits. The staging subreddit is `SacDevTest`, whose hardcoded staging subreddit ID is `t5_gqefuq`. Do not point these tests at production communities.

## Coverage

- Basic user can load the staging tracker without setup/admin/test/dev controls.
- Basic user can join and check in, while tolerating already-joined or already-checked-in state.
- Status card row order and countdown format are sane.
- Privacy toggle updates and is restored to the original state.
- Developer/mod account can see safe setup/admin tools and staging test controls in `SacDevTest`.
- Playtest/dev-only tools are not expected in real installed subreddit URLs.
- Optional: a configured non-staging test subreddit moderator can see safe setup/admin tools but not staging simulation or playtest/dev tools.

The staging permission tests do not click `Simulate +1 day` or `Simulate +7 days`. Those controls mutate shared staging state and should be used manually only when you have a cleanup/reset plan.

## Environment

Create a local `.env` from `.env.example` or export these variables in your shell. The Playwright test runner reads environment variables from the shell; if you use a `.env` file, load it before running the command.

```bash
STREAK_CLUB_STAGING_URL=https://www.reddit.com/r/SacDevTest/comments/YOUR_STAGING_TRACKER_POST_ID/
STREAK_CLUB_STAGING_SUBREDDIT=SacDevTest
STREAK_CLUB_NON_STAGING_URL=https://www.reddit.com/r/streak_club_dev/comments/YOUR_NON_STAGING_TRACKER_POST_ID/
STREAK_CLUB_NON_STAGING_SUBREDDIT=streak_club_dev
STREAK_CLUB_MOD_AUTH=playwright/.auth/reddit-mod.json
STREAK_CLUB_USER_AUTH=playwright/.auth/reddit-user.json
```

Required for staging tests:

- `STREAK_CLUB_STAGING_URL` points to the Streak Club tracker post in `SacDevTest`.
- `STREAK_CLUB_STAGING_SUBREDDIT` is `SacDevTest`.
- `STREAK_CLUB_MOD_AUTH` points to the developer/mod account auth state.
- `STREAK_CLUB_USER_AUTH` points to the normal user auth state.

Optional non-staging moderator test:

- Set `STREAK_CLUB_NON_STAGING_URL` and `STREAK_CLUB_NON_STAGING_SUBREDDIT` to a real, non-production, non-staging test subreddit, such as `r/streak_club_dev`.
- The test first tries `STREAK_CLUB_USER_AUTH`, which is useful when the normal user is a moderator of that non-staging subreddit but is still the basic user in `SacDevTest`.
- If that account is not a moderator there, the test tries `STREAK_CLUB_MOD_AUTH`.
- If neither auth state is a moderator of the configured non-staging subreddit, the optional test skips with a clear message.

## Accounts

- In `SacDevTest`, `STREAK_CLUB_MOD_AUTH` should be a subreddit moderator.
- In `SacDevTest`, `STREAK_CLUB_USER_AUTH` should be a basic non-moderator user.
- In the optional non-staging subreddit, at least one configured auth state should be a moderator if you want that optional test to run.

Do not create fake Reddit accounts for this suite. Use existing test accounts only.

## Save Auth State

The auth setup does not automate Reddit credentials. It opens Reddit in headed Chromium and waits for you to manually log in with existing Reddit accounts.

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

Never commit files under `playwright/.auth/`. They contain live browser auth state and are ignored by git.

## Run Staging Smoke Tests

After env vars are set and auth state files exist:

```bash
npm run test:e2e:staging
```

Playwright runs headless by default because this is faster, less flaky in automation, and avoids opening Reddit browser windows unless you ask for them. To watch the browser:

```bash
npx playwright test e2e/staging.smoke.spec.ts --headed
```

The tests run serially and collect screenshots, videos, and traces on failure under Playwright's normal output folders. Those folders are ignored by git.
