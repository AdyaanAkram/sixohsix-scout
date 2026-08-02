# Root Dockerfile for Render (expects build context = repo root)
FROM python:3.12-slim

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
ENV DEMO_HOSTING=1
ENV MAIL_PROVIDER=stdout
ENV MAIL_FROM=noreply@606athletics.demo
ENV STORAGE_BACKEND=local
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD sh -c 'curl -fsS http://127.0.0.1:${PORT:-8000}/ready || exit 1'

CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --proxy-headers --forwarded-allow-ips '*'"]
