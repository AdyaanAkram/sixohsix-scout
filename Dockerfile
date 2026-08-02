FROM python:3.12-slim

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.local.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt \
  && pip install --no-cache-dir "sentry-sdk[fastapi]==2.19.2" || true

COPY backend/ /app/
RUN mkdir -p /app/uploads && chmod +x /app/start.sh

ENV APP_ENV=production
ENV PYTHONUNBUFFERED=1
ENV DEMO_HOSTING=1
ENV MAIL_PROVIDER=stdout
ENV MAIL_FROM=noreply@606athletics.demo
ENV STORAGE_BACKEND=local
ENV DB_NAME=pbg_scout
ENV CORS_ORIGINS=https://606-scout.surge.sh
ENV APP_PUBLIC_URL=https://606-scout.surge.sh
EXPOSE 8000

CMD ["/app/start.sh"]
