# Deploy 60'6" Scout — production checklist

## Recommended stack (camp → scale)

| Piece | Choice |
|---|---|
| Database | **MongoDB Atlas** (M10+, daily backups) |
| Files | **Cloudflare R2** or AWS S3 |
| Mail | **Resend** |
| API + web | Docker on Fly.io / Render / a VPS, or compose behind Caddy |
| Errors | **Sentry** (`SENTRY_DSN`) |

Keep FastAPI. Scale by adding API replicas + Atlas; do not split into microservices yet.

---

## 1. Create managed services

### MongoDB Atlas
1. Create a cluster + database user.
2. Network access: allow your host IPs (or `0.0.0.0/0` only if you must, then tighten).
3. Copy the `mongodb+srv://…` URI → `MONGO_URL`.
4. Enable continuous / daily backups.

### Cloudflare R2 (S3-compatible)
1. Create a bucket (private).
2. Create an API token with Object Read & Write.
3. Set:
   ```bash
   STORAGE_BACKEND=s3
   S3_BUCKET=your-bucket
   S3_REGION=auto
   S3_ENDPOINT_URL=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   S3_ACCESS_KEY=…
   S3_SECRET_KEY=…
   ```

### Resend
1. Verify your sending domain.
2. Set `MAIL_PROVIDER=resend`, `RESEND_API_KEY`, `MAIL_FROM=Scout <noreply@yourdomain.com>`.

### Sentry
Create a FastAPI project → paste DSN into `SENTRY_DSN`.

---

## 2. Secrets

```bash
export JWT_SECRET="$(openssl rand -hex 32)"
export APP_ENV=production
export DB_NAME=pbg_scout
export MONGO_URL='mongodb+srv://USER:PASS@cluster…/pbg_scout'
export CORS_ORIGINS=https://app.yourdomain.com
export APP_PUBLIC_URL=https://app.yourdomain.com
# REACT_APP_BACKEND_URL empty when nginx proxies /api (compose web service)
export REACT_APP_BACKEND_URL=
```

Copy `.env.example` → `.env` and fill every production field. Config **refuses to boot** if JWT/mail/CORS are weak.

---

## 3. Deploy with Docker Compose (VPS)

```bash
# On the server, with .env filled for Atlas + Resend (+ R2 optional)
docker compose build
docker compose up -d

# First owner (does NOT wipe data)
docker compose exec api python bootstrap_admin.py \
  --org "60'6 Athletics" \
  --email you@yourdomain.com \
  --name "Your Name" \
  --password 'long-random-password'
```

Put **Caddy** or **Nginx** in front with HTTPS terminating on `app.yourdomain.com` → `web:80`.

Local Mongo only for rehearsal:

```bash
ALLOW_COMPOSE_MONGO=1 MONGO_URL=mongodb://mongo:27017 \
  docker compose --profile local-db up -d
```

---

## 4. Deploy API on Fly.io (sketch)

```bash
# from repo root
fly launch --no-deploy   # choose app name
fly secrets set \
  APP_ENV=production \
  JWT_SECRET=… \
  MONGO_URL=… \
  DB_NAME=pbg_scout \
  CORS_ORIGINS=https://app.yourdomain.com \
  APP_PUBLIC_URL=https://app.yourdomain.com \
  MAIL_PROVIDER=resend \
  RESEND_API_KEY=… \
  MAIL_FROM='Scout <noreply@yourdomain.com>' \
  STORAGE_BACKEND=s3 \
  S3_BUCKET=… S3_ENDPOINT_URL=… S3_ACCESS_KEY=… S3_SECRET_KEY=… \
  SENTRY_DSN=…
fly deploy --dockerfile backend/Dockerfile
```

Host the CRA build on Cloudflare Pages with `REACT_APP_BACKEND_URL=https://api.yourdomain.com`.

---

## 5. Go-live checklist

- [ ] Fresh Atlas DB (no demo seed)
- [ ] `bootstrap_admin.py` owner created; password in a password manager
- [ ] Resend test invite received
- [ ] Upload a photo (R2/S3 or persistent volume)
- [ ] Sentry test event
- [ ] `/ready` returns 200
- [ ] Phone dress rehearsal: evaluate offline → sync → submit
- [ ] Coach check-in + Head Scout review
- [ ] Backups enabled on Atlas
- [ ] `seed.py` never run in prod (blocked unless override)

---

## 6. What not to do

- Do not run `python seed.py` against Atlas (wipes data; blocked in production).
- Do not commit `.env` or JWT secrets.
- Do not rely on compose Mongo alone for a real camp without backups.
- Do not leave `MAIL_PROVIDER=stdout` in production (boot fails on purpose).
