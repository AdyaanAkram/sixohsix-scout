---
title: 606 Scout API
emoji: ⚾
colorFrom: green
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
license: mit
---

# 60'6" Athletics Scout — API (demo)

Free-hosted FastAPI backend for the Scout app. Frontend: [606-scout.surge.sh](https://606-scout.surge.sh).

Set **Space secrets** (Settings → Variables and secrets):

| Secret | Value |
|--------|--------|
| `MONGO_URL` | Atlas `mongodb+srv://…` |
| `JWT_SECRET` | long random string (32+) |
| `DB_NAME` | `pbg_scout` |
| `CORS_ORIGINS` | `https://606-scout.surge.sh` |
| `APP_PUBLIC_URL` | `https://606-scout.surge.sh` |
| `DEMO_HOSTING` | `1` |
| `MAIL_PROVIDER` | `stdout` |
| `APP_ENV` | `production` |
| `STORAGE_BACKEND` | `local` |
