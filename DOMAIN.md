# Domain cutover — 60'6" ID

Live demo today: **https://606-scout.surge.sh** (Surge frontend + hosted API).

## Target hostnames

| Hostname | Role |
|----------|------|
| `id.606athletics.com` | Primary product app (preferred) |
| `app.606athletics.com` | Alternate / alias (same frontend) |
| `api.606athletics.com` | Optional dedicated API host (or keep Render/Fly URL behind a CNAME) |

Keep `606-scout.surge.sh` as a staging/demo URL until DNS and TLS are verified on the production names.

## Cutover checklist

1. **DNS**
   - Point `id.606athletics.com` (and optionally `app.606athletics.com`) at the frontend host (Surge custom domain, Cloudflare Pages, or CDN).
   - Point `api.606athletics.com` (or use the existing Render/Fly hostname) at the API service.
2. **TLS** — issue certificates for each hostname (Let’s Encrypt / host panel).
3. **API env**
   - `APP_PUBLIC_URL=https://id.606athletics.com`
   - `CORS_ORIGINS` includes `https://id.606athletics.com` and `https://app.606athletics.com`
4. **Frontend build**
   - `REACT_APP_BACKEND_URL=https://api.606athletics.com` (or the stable API origin)
   - Redeploy the SPA; ensure SPA fallback (`200.html` / rewrite to `index.html`) for client routes.
5. **Smoke** — sign-in, redeem invite, evaluation submit, reports CSV, media signed URL.
6. **Optional** — redirect `606-scout.surge.sh` → `id.606athletics.com` after cutover.

See `DEPLOY_HOSTED.md` for the current free-host stack (Atlas + Render + Surge).
