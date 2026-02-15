#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/test_api.sh <base_url> [cookie_file]

Examples:
  ./scripts/test_api.sh "https://<playtest-host>"
  ./scripts/test_api.sh "https://<playtest-host>" cookies.txt

Notes:
  - If your playtest API requires auth cookies, pass a Netscape-format cookie file
    exported from your browser as the second argument.
  - The script will run a smoke flow:
    1) GET /api/me
    2) POST /api/join
    3) POST /api/checkin (once)
    4) POST /api/checkin (again) to verify friendly error
    5) POST /api/privacy (private), GET /api/leaderboard
    6) POST /api/privacy (public), GET /api/leaderboard
EOF
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

BASE_URL="${1%/}"
COOKIE_FILE="${2:-}"

declare -a CURL_OPTS
CURL_OPTS=(-sS)
if [[ -n "$COOKIE_FILE" ]]; then
  CURL_OPTS+=(-b "$COOKIE_FILE" -c "$COOKIE_FILE")
fi

call_get() {
  local path="$1"
  echo
  echo ">>> GET $path"
  curl "${CURL_OPTS[@]}" "$BASE_URL$path"
  echo
}

call_post_json() {
  local path="$1"
  local body="$2"
  echo
  echo ">>> POST $path"
  echo "body: $body"
  curl "${CURL_OPTS[@]}" \
    -X POST \
    -H "Content-Type: application/json" \
    -d "$body" \
    "$BASE_URL$path"
  echo
}

echo "Base URL: $BASE_URL"
if [[ -n "$COOKIE_FILE" ]]; then
  echo "Cookie file: $COOKIE_FILE"
else
  echo "Cookie file: <none>"
fi

echo
echo "Running API smoke test..."

call_get "/api/me"
call_post_json "/api/join" "{}"
call_post_json "/api/checkin" "{}"
call_post_json "/api/checkin" "{}"
call_post_json "/api/privacy" '{"privacy":"private"}'
call_get "/api/leaderboard?limit=25"
call_post_json "/api/privacy" '{"privacy":"public"}'
call_get "/api/leaderboard?limit=25"

echo
echo "Smoke test flow complete."
