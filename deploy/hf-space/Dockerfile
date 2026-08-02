FROM python:3.12-slim

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

# Context is repo root when built via our deploy script
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
ENV PORT=7860

EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:7860/ready || exit 1

# Hugging Face Spaces expects the app on 7860
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "7860", "--proxy-headers", "--forwarded-allow-ips", "*"]
