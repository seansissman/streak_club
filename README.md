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
