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
