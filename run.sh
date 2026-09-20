#!/usr/bin/env bash
# Start Impact Guard: API on :8000, web UI on :5273.
#
# Configuration comes from .env (see .env.example). Nothing needs to be
# exported by hand. Ctrl-C stops both.
set -euo pipefail
cd "$(dirname "$0")"

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "Impact Guard"
echo "  API  http://localhost:8000"
echo "  Web  http://localhost:5273"
echo

( cd backend  && python3 local_server.py --port 8000 ) &
( cd frontend && npm run dev -- --port 5273 ) &

wait
