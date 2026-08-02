#!/usr/bin/env bash
# Deploy API to Fly.io. Prerequisites: flyctl logged in, Atlas MONGO_URL ready.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v flyctl >/dev/null 2>&1 && ! command -v fly >/dev/null 2>&1; then
  echo "Install flyctl first: https://fly.io/docs/hands-on/install-flyctl/"
  exit 1
fi
FLY="$(command -v flyctl || command -v fly)"

APP="${FLY_APP:-sixohsix-scout-api}"
SURGE_URL="${SURGE_URL:-https://606-scout.surge.sh}"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"

if [[ -z "${MONGO_URL:-}" ]]; then
  echo "Set MONGO_URL to your Atlas connection string, e.g.:"
  echo "  export MONGO_URL='mongodb+srv://USER:PASS@cluster…/?retryWrites=true&w=majority'"
  exit 1
fi

echo "→ Ensuring app $APP exists…"
$FLY apps create "$APP" --org personal 2>/dev/null || true

echo "→ Ensuring uploads volume…"
$FLY volumes create scout_uploads --region iad --size 1 --app "$APP" --yes 2>/dev/null || true

echo "→ Setting secrets…"
$FLY secrets set -a "$APP" \
  JWT_SECRET="$JWT_SECRET" \
  MONGO_URL="$MONGO_URL" \
  DB_NAME="${DB_NAME:-pbg_scout}" \
  CORS_ORIGINS="$SURGE_URL,http://localhost:3000" \
  APP_PUBLIC_URL="$SURGE_URL" \
  DEMO_HOSTING=1 \
  MAIL_PROVIDER=stdout \
  MAIL_FROM=noreply@606athletics.demo \
  STORAGE_BACKEND=local \
  APP_ENV=production

echo "→ Deploying…"
$FLY deploy -a "$APP" --dockerfile backend/Dockerfile

API_URL="$($FLY status -a "$APP" --json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print('https://'+(d.get('Hostname') or d.get('Hostname') or ''))" 2>/dev/null || true)"
if [[ -z "$API_URL" || "$API_URL" == "https://" ]]; then
  API_URL="https://${APP}.fly.dev"
fi

echo ""
echo "API should be at: $API_URL"
echo "Health: $API_URL/ready"
echo ""
echo "Next:"
echo "  1) curl -s $API_URL/ready"
echo "  2) Bootstrap owner:"
echo "     $FLY ssh console -a $APP -C \"python bootstrap_admin.py --org \\\"60'6 Athletics\\\" --email you@example.com --name Owner --password 'ChangeMeNow!'\""
echo "  3) Rebuild Surge frontend:"
echo "     cd frontend && REACT_APP_BACKEND_URL=$API_URL npm run build && cp build/index.html build/200.html && surge ./build 606-scout.surge.sh"
