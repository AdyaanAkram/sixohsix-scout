# ── Backend ──────────────────────────────────────────────
FROM python:3.12-slim AS backend

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.local.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt \
  && pip install --no-cache-dir "sentry-sdk[fastapi]==2.19.2" || true

COPY backend/ /app/
RUN mkdir -p /app/uploads

ENV APP_ENV=production
ENV PYTHONUNBUFFERED=1
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/ready || exit 1

# 2 workers for camp concurrency; scale replicas horizontally in cloud
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--proxy-headers", "--forwarded-allow-ips", "*"]
