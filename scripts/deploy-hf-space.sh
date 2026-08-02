#!/usr/bin/env bash
# Deploy API to a free Hugging Face Docker Space (no credit card).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

HF_USER="${HF_USER:-}"
SPACE="${HF_SPACE:-sixohsix-scout-api}"
SURGE_URL="${SURGE_URL:-https://606-scout.surge.sh}"

if [[ -z "${HF_TOKEN:-}" ]]; then
  echo "Set HF_TOKEN to a Write token from https://huggingface.co/settings/tokens"
  exit 1
fi

if [[ -z "$HF_USER" ]]; then
  HF_USER="$(python3 - <<'PY'
import os, urllib.request, json
req = urllib.request.Request(
  "https://huggingface.co/api/whoami-v2",
  headers={"Authorization": f"Bearer {os.environ['HF_TOKEN']}"},
)
print(json.load(urllib.request.urlopen(req))["name"])
PY
)"
fi

echo "→ HF user: $HF_USER  space: $SPACE"

python3 -m pip install -q -U "huggingface_hub[cli]"

# Staging dir with Dockerfile + backend sources
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp deploy/hf-space/README.md "$STAGE/"
cp deploy/hf-space/Dockerfile "$STAGE/Dockerfile.space"
# Flatten: Dockerfile expects backend/ relative to context — rewrite for flat stage
cat > "$STAGE/Dockerfile" <<'EOF'
FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt \
  && pip install --no-cache-dir "sentry-sdk[fastapi]==2.19.2" || true
COPY . /app/
RUN mkdir -p /app/uploads
ENV APP_ENV=production PYTHONUNBUFFERED=1 DEMO_HOSTING=1 \
    MAIL_PROVIDER=stdout MAIL_FROM=noreply@606athletics.demo STORAGE_BACKEND=local
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:7860/ready || exit 1
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "7860", "--proxy-headers", "--forwarded-allow-ips", "*"]
EOF
cp backend/requirements.local.txt "$STAGE/requirements.txt"
# copy backend python modules (exclude venv)
rsync -a --exclude '.venv' --exclude '__pycache__' --exclude 'uploads' --exclude '*.pyc' \
  backend/ "$STAGE/"

export HF_TOKEN
huggingface-cli upload "${HF_USER}/${SPACE}" "$STAGE" . --repo-type=space --private=false 2>/dev/null \
  || huggingface-cli upload "${HF_USER}/${SPACE}" "$STAGE" . --repo-type=space

API_URL="https://${HF_USER}-${SPACE}.hf.space"
# HF URL slug often lowercases and replaces
API_URL="https://huggingface.co/spaces/${HF_USER}/${SPACE}"
echo ""
echo "Space: https://huggingface.co/spaces/${HF_USER}/${SPACE}"
echo "App URL (after build): https://${HF_USER,,}-${SPACE}.hf.space  (check Space → App)"
echo ""
echo "IMPORTANT: In the Space → Settings → Variables and secrets, set:"
echo "  MONGO_URL, JWT_SECRET, DB_NAME=pbg_scout,"
echo "  CORS_ORIGINS=${SURGE_URL}, APP_PUBLIC_URL=${SURGE_URL},"
echo "  DEMO_HOSTING=1, MAIL_PROVIDER=stdout, APP_ENV=production, STORAGE_BACKEND=local"
echo "Then Factory reboot the Space."
