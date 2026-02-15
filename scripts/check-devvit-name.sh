#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_FILE="$ROOT_DIR/.devvit-app-name"
CONFIG_FILE="$ROOT_DIR/devvit.json"

if [[ ! -f "$EXPECTED_FILE" ]]; then
  echo "Error: missing $EXPECTED_FILE"
  exit 1
fi

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Error: missing $CONFIG_FILE"
  exit 1
fi

expected_name="$(tr -d '[:space:]' < "$EXPECTED_FILE")"
if [[ -z "$expected_name" ]]; then
  echo "Error: $EXPECTED_FILE is empty"
  exit 1
fi

current_name="$(node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.stdout.write(String(p.name||''));" "$CONFIG_FILE")"

if [[ "$current_name" != "$expected_name" ]]; then
  echo "Error: devvit app name guardrail failed"
  echo "  expected: $expected_name"
  echo "  actual:   $current_name"
  echo
  echo "If this rename is intentional, update .devvit-app-name in the same change."
  exit 1
fi

echo "OK: devvit.json name matches expected app name ($expected_name)"
