#!/usr/bin/env bash
# Start Impact Guard: API on :8000, web UI on :5273.
#
# Safe to run on a fresh clone: it installs frontend dependencies on first run
# and works with no configuration at all (demo mode needs no AWS account).
# Ctrl-C stops both.
set -euo pipefail
cd "$(dirname "$0")"

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

command -v python3 >/dev/null || { echo "python3 is required."; exit 1; }
command -v npm     >/dev/null || { echo "npm is required (Node 18+)."; exit 1; }

# A fresh clone has no node_modules, and `npm run dev` fails confusingly
# without them. Install once, quietly, rather than making it step 0 of the
# README that everyone forgets.
if [ ! -d frontend/node_modules ]; then
  echo "Installing frontend dependencies (first run only)..."
  ( cd frontend && npm install --silent )
fi

# boto3 is only needed for live AWS mode; demo mode is stdlib-only.
if ! python3 -c "import boto3" 2>/dev/null; then
  echo "note: boto3 is not installed, so only Demo mode will work."
  echo "      for live CloudTrail:  pip install boto3"
  echo
fi

echo "Impact Guard"
echo "  API  http://localhost:8000"
echo "  Web  http://localhost:5273"
[ -f .env ] || echo "  (no .env — defaulting to Demo mode; copy .env.example to change)"
echo

( cd backend  && python3 local_server.py --port 8000 ) &
( cd frontend && npm run dev -- --port 5273 ) &

wait
