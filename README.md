# 60'6" Athletics Scout

Identify. Evaluate. Develop. Train.

Web platform for evaluations, athlete IDs, and year-round programmes (camps / clinics / training blocks).

## Local development

**Prereqs:** Docker (Mongo), Python 3.12+, Node 20+

```bash
# Mongo
docker start mongo-606 2>/dev/null || docker run -d --name mongo-606 -p 27017:27017 mongo:7

# Backend
cd backend
cp ../.env.example .env   # adjust if needed
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.local.txt
python seed.py            # demo users *@pbgscout.com / Scout2025!
uvicorn server:app --reload --port 8000

# Frontend (other terminal)
cd frontend
echo 'REACT_APP_BACKEND_URL=http://127.0.0.1:8000' > .env
npm install
npm start
```

- App: http://localhost:3000  
- API docs: http://localhost:8000/docs  
- Health: http://localhost:8000/health · Ready: http://localhost:8000/ready  

## Production

See **[DEPLOY.md](./DEPLOY.md)** for Atlas + R2/S3 + Resend + Sentry and the go-live checklist.

```bash
# Example: compose with Atlas (fill .env first)
docker compose build && docker compose up -d
docker compose exec api python bootstrap_admin.py \
  --org "60'6 Athletics" --email you@domain.com --name "Director" --password '…'
```

Never run `seed.py` against production data.

## Tests

```bash
# API must be running
cd backend && source .venv/bin/activate
pytest ../tests/test_org_isolation.py -n 0 -q
python camp_readiness_check.py
```

CI runs the isolation suite on every push (`.github/workflows/ci.yml`).

## Architecture notes

| Concern | Approach |
|---|---|
| Multi-tenant | Every query filters `organization_id` |
| Evaluation days | `events` + stations + assignments |
| Year-round training | `programs` → `sessions` → `enrollments` → `attendance` |
| Athlete portal | `/my-id` + age-gated invites |
| Media | `STORAGE_BACKEND=local` or `s3` (R2/S3) via `storage.py` |
| Secrets | Validated at boot (`config.py`); weak JWT / stdout mail rejected in production |

## Demo logins (after seed)

| Email | Password | Role |
|---|---|---|
| `owner@pbgscout.com` | `Scout2025!` | Owner |
| `admin@pbgscout.com` | `Scout2025!` | Admin |
| `headscout@pbgscout.com` | `Scout2025!` | Head Scout |
| `coach@pbgscout.com` | `Scout2025!` | Coach |
| `eval1@pbgscout.com` … `eval4@` | `Scout2025!` | Evaluator |
| `demo.athlete.5a6b8b@example.com` | `Athlete2026!` | Athlete (My ID) |

## Camp day runbook

**Events** = evaluation day (stations, Evaluate, Review Queue). **Programs** = year-round camps/clinics (sessions, attendance). Do not look for Review Queue on a Program.

### Morning setup (owner / admin / coach)
1. Open the evaluation **Event** → status **Evaluation Active**.
2. **Check-In** tab: search → Check In → assign bib # / group. Walk-ups: add from admin roster tools.
3. Confirm **Stations** + **Evaluators** assignments (each evaluator sees only their station on Dashboard → Evaluate).
4. Coaches can run Programs attendance in parallel; it does not replace event check-in.

### Evaluators (phones / tablets)
1. Sign in as `evalN@pbgscout.com` → **Dashboard** → **Start / Continue Evaluating**.
2. Wait for “templates cached for offline” on the station list (stay on wifi once at the start of the day).
3. Score → autosave pill should hit Saved. Submit & Lock when the player finishes the station.
4. **Full roster** hand-off: search any checked-in player if they arrive out of group order (audited).
5. If Head Scout returns an eval, it appears as **Returned** at the top of Todo — fix the note and resubmit.
6. Offline: already-opened drafts keep working on device; you cannot start a *new* player or Submit until back online.

### Head Scout
1. **Review Queue** → approve or return with a short note.
2. Use unlock only for authorized edits after approve (audit logged).

### Students / parents
1. Staff opens player profile → **Invite to platform** (needs athlete or guardian email).
2. Recipient opens `/accept-invitation` link → sets password → lands on **My ID**.
3. Under-13 invites go to the guardian (`parent` role); 13+ to the athlete when email is present.

### Pre-deploy dress rehearsal
```bash
cd backend && source .venv/bin/activate
python camp_readiness_check.py
pytest ../tests/test_org_isolation.py -n 0 -q
```
Then on a phone: sign in as evaluator, open one player, toggle airplane mode, change a score, reconnect, confirm sync, submit.
