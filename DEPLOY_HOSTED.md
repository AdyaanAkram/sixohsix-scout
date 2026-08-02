# Hosted deploy (laptop can be off)

**Recommended free stack (2026):**

| Piece | Host |
|--------|------|
| Database | **MongoDB Atlas** (free M0) — already set up |
| API | **Render** free web service (`*.onrender.com`) |
| Frontend | **Surge** (`606-scout.surge.sh`) pointing at the Render API |

Repo for deploy: https://github.com/AdyaanAkram/sixohsix-scout  

> Fly.io needs a card for ongoing apps. Hugging Face Docker Spaces now need Pro. Render’s **free** plan is the practical $0 option (service **sleeps when idle**; first request can take ~30–60s).

One-click Blueprint: https://render.com/deploy?repo=https://github.com/AdyaanAkram/sixohsix-scout

---

## Legacy notes (Fly / HF)

Fly/HF paths below are kept for reference if you later pay for always-on.

---

## Step 1 — MongoDB Atlas (you do this in the browser)

1. Go to https://cloud.mongodb.com and create / sign in.
2. **Build a database** → free **M0** → pick a cloud region (e.g. Virginia / `us-east-1`).
3. Create a database user (username + strong password). Save the password.
4. **Network Access** → **Add IP Address** → **Allow Access from Anywhere** (`0.0.0.0/0`) for the demo  
   (tighten later for real camps).
5. **Database → Connect → Drivers** → copy the URI, like:
   ```
   mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
6. Replace `<password>` with the real password (URL-encode special characters).

Keep that URI handy as `MONGO_URL`.

---

## Step 2 — Fly.io login (one-time)

In a terminal:

```bash
export PATH="$HOME/.fly/bin:$PATH"
flyctl auth login
```

Complete the browser login.

---

## Step 3 — Deploy the API

From the project root on your Mac:

```bash
export PATH="$HOME/.fly/bin:$PATH"
cd ~/Desktop/606-audit/PBG-Scout-App-Concept-

export MONGO_URL='mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority'
export SURGE_URL='https://606-scout.surge.sh'

./scripts/deploy-fly.sh
```

This creates app `sixohsix-scout-api`, a small uploads volume, secrets, and deploys the Docker API.

Check:

```bash
curl -s https://sixohsix-scout-api.fly.dev/ready
```

---

## Step 4 — Create the first owner (empty Atlas DB)

```bash
export PATH="$HOME/.fly/bin:$PATH"
flyctl ssh console -a sixohsix-scout-api -C \
  "python bootstrap_admin.py --org \"60'6 Athletics\" --email owner@example.com --name \"Your Name\" --password 'PickAStrongPassword!'"
```

Use that email/password to sign in on the website.

**Optional demo data** (wipes that Atlas DB — only on an empty demo cluster):

```bash
flyctl ssh console -a sixohsix-scout-api -C \
  "ALLOW_PROD_SEED=I_UNDERSTAND_WIPE APP_ENV=production python seed.py"
```

Then use the usual `*@pbgscout.com` / `Scout2025!` logins from `USER_GUIDE.md`.

---

## Step 5 — Point Surge at the hosted API

```bash
cd ~/Desktop/606-audit/PBG-Scout-App-Concept-/frontend
REACT_APP_BACKEND_URL=https://sixohsix-scout-api.fly.dev npm run build
cp build/index.html build/200.html
surge ./build 606-scout.surge.sh
```

Share: **https://606-scout.surge.sh**

---

## Later upgrades (real camp)

- Set `DEMO_HOSTING=0`, `MAIL_PROVIDER=resend`, and a real `RESEND_API_KEY`.
- Move files to R2/S3 (`STORAGE_BACKEND=s3`).
- Restrict Atlas Network Access to Fly IPs / known ranges.
- Keep `min_machines_running = 1` in `fly.toml` if cold starts bother you on camp day.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `/ready` fails | `flyctl logs -a sixohsix-scout-api` — usually bad `MONGO_URL` or Atlas IP allowlist |
| Login CORS error | Rebuild Surge after API URL change; ensure `CORS_ORIGINS` includes `https://606-scout.surge.sh` |
| App sleeps / slow first load | Free Fly machines auto-stop; first request wakes them (~30s). Set `min_machines_running = 1` to keep warm |
| Invites don’t email | Expected with `DEMO_HOSTING=1` / stdout mail — use bootstrap passwords or add Resend |
