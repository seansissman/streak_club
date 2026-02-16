# Streak Engine

Streak Engine is a Devvit Web app for running and tracking streak-based gameplay on Reddit.

## WSL Setup (Ubuntu + bash)

1. Install Node.js and npm if needed:

```bash
node --version || sudo apt-get update && sudo apt-get install -y nodejs npm
```

2. Install dependencies:

```bash
npm install
```

3. Install the Devvit CLI if needed:

```bash
devvit --version || npm install -g devvit
```

4. Authenticate with Devvit:

```bash
devvit login
```

5. Upload and playtest:

```bash
npm run devvit:upload
npm run devvit:playtest
```

## Local Development

Run the local web build watcher:

```bash
npm run dev
```

Daily reset is at **00:00 UTC**.

## Creating your first challenge post

1. In your subreddit mod menu, click **Create a new post**.
2. On first run, the app opens a setup post and prompts moderators to configure the challenge.
3. In **Challenge Config (Moderator)**:
   - pick a template,
   - optionally edit title/description/badge thresholds,
   - click **Save**.
4. Click **Create a new post** again from the subreddit mod menu.
5. The created challenge post title is pulled from your saved config title (safely trimmed if needed).

After initial setup, config remains editable and future post creation uses the latest saved title.

Guardrail: only one active tracker post is allowed per subreddit. If a tracker already exists, the app will direct moderators to the existing post instead of creating another.

## Quick Command Reference

```bash
npm run devvit:upload
npm run devvit:playtest
```

## App linkage

This repo is linked to a Devvit app via `devvit.json`, specifically the `"name"` field.

- Current linked app: `"name": "streak-club"`
- This file is safe to commit and should be versioned to keep uploads stable across machines/sessions.
- Devvit auth/session tokens are stored outside the repo under `~/.devvit/` and should never be committed.

### Name guardrail

To prevent accidental app renames that can trigger new-app creation during upload, this repo includes:

- `.devvit-app-name` (expected app name)
- `scripts/check-devvit-name.sh` (validation script)

Run the check manually:

```bash
npm run check:name
```

If the app rename is intentional, update both `devvit.json` `"name"` and `.devvit-app-name` in the same change.

## DEV-only time offset endpoints

For playtest-only multi-day simulation, the server exposes:

- `GET /api/dev/time`
  - Returns `{ serverUtcNow, utcDayNumberNow, devDayOffset, effectiveDayNumber, nextResetUtcMs }`
- `POST /api/dev/time` (moderator only)
  - Body: `{ "devDayOffset": <integer> }`
  - Updates the per-subreddit DEV offset used to compute effective day numbers.

These endpoints are **DEV ONLY** tooling for testing and are labeled as such in the UI.

## Testing: multi-user and multi-day

### API smoke test script (curl)

Use the helper script:

```bash
./scripts/test_api.sh "https://<playtest-base-url>" [cookie_file]
```

Flow covered:

1. `GET /api/me`
2. `POST /api/join`
3. `POST /api/checkin` (once)
4. `POST /api/checkin` (again) to verify the friendly duplicate-checkin error
5. `POST /api/privacy` to private, then `GET /api/leaderboard`
6. `POST /api/privacy` to public, then `GET /api/leaderboard`

If auth cookies are required for your playtest URL:

- Export cookies from your browser into a Netscape-format cookie file (for example with a browser cookie export extension).
- Pass that file as the second argument so curl sends/updates the session cookie.

### Multi-user testing

Use separate browser profiles (or private windows with separate login sessions) to simulate different Reddit accounts:

- Profile A: moderator/admin account
- Profile B/C: regular user accounts

This lets you verify leaderboard ordering, privacy behavior, and per-user streak state independently.

### Multi-day testing (time travel)

Use the in-app **Dev Time Panel** (moderator-only) to set `devDayOffset`:

- `+1 day` to simulate tomorrow
- `-1 day` to simulate yesterday
- `Reset to 0` to return to real UTC day

Warning shown in UI/API: **DEV ONLY: Simulates day changes for testing.**

### Playtest smoke checklist

Latest run (WSL CLI): `devvit playtest` launched successfully and produced:

- URL: `https://www.reddit.com/r/streak_club_dev/?playtest=streak-club`
- Status: Playtest ready

Feature checklist to run in browser:

- [ ] New user: Join works
- [ ] Check-in works and shows checked-in state
- [ ] Privacy toggle hides user on leaderboard when private
- [ ] Privacy toggle shows user on leaderboard when public
- [ ] Leaderboard loads
- [ ] Dev day offset panel works (`-1`, `+1`, `reset`)

Note: from WSL shell we can validate build/upload/playtest launch, but the account-scoped UI interactions above must be confirmed in-browser.

## If upload starts creating new apps again

1. Verify the linked app name in `devvit.json`:

```bash
cat devvit.json
```

2. Confirm what app this directory resolves to:

```bash
devvit view
```

3. List existing apps to confirm the exact target name:

```bash
devvit list apps
```

4. Re-run upload after fixing the `devvit.json` `"name"` value:

```bash
devvit upload
```
