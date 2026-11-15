#!/usr/bin/env bash
# Build and serve this checkout the way the browser tests do: in-memory store, mock payments,
# never the real database (the Supabase variables are blanked whatever the shell holds).
# Usage: scripts/serve-local.sh [port]     staff PIN 2468, owner PIN 246810
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${1:-3200}"
export STAFF_PIN=2468 OWNER_PIN=246810 PAYMENTS=mock TEST_MODE=0
export NEXT_PUBLIC_SUPABASE_URL= SUPABASE_SECRET_KEY= SUPABASE_SERVICE_ROLE_KEY=
npx next build
exec npx next start -p "$PORT"
