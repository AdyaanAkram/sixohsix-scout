#!/bin/sh
set -e
echo "[start] PORT=${PORT:-8000} APP_ENV=${APP_ENV} DEMO_HOSTING=${DEMO_HOSTING}"
echo "[start] MONGO_URL set: $([ -n \"$MONGO_URL\" ] && echo yes || echo NO)"
echo "[start] JWT_SECRET set: $([ -n \"$JWT_SECRET\" ] && echo yes || echo NO)"
exec uvicorn server:app --host 0.0.0.0 --port "${PORT:-8000}" --workers 1 --proxy-headers --forwarded-allow-ips '*'
