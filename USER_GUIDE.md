# 60'6" ID — User Guide

Complete guide to logins, roles, organizations, programs, events, player onboarding, evaluations, and the athlete experience.

**Product name:** 60'6" ID  
**Tagline:** Every Player. Every Rep. Every Season Tells the Story.  
**Motto:** Train. Elevate. Succeed.  
**Live app (fully hosted):** https://606-scout.surge.sh  
**Local app:** http://localhost:3000  
**API docs (local):** http://localhost:8000/docs  

> **Cold start:** First load after idle can take 30–60 seconds while the free hosted API wakes up — wait once, then it is responsive.

---

## 1. Demo logins (after `seed.py`)

All staff passwords below are **`Scout2025!`** unless noted.

### PBG Midwest (main demo org)

| Email | Password | Role | Best for trying… |
|---|---|---|---|
| `owner@pbgscout.com` | `Scout2025!` | Organization Owner | Org switcher, staff, settings, full camp ops |
| `admin@pbgscout.com` | `Scout2025!` | Administrator | Same as owner minus some owner-only settings |
| `headscout@pbgscout.com` | `Scout2025!` | Head Scout | Review queue, approve/return evals, awards |
| `coach@pbgscout.com` | `Scout2025!` | Coach | Check-in, programs, metrics, development plans |
| `eval1@pbgscout.com` | `Scout2025!` | Evaluator | Station scoring, autosave, submit |
| `eval2@pbgscout.com` | `Scout2025!` | Evaluator | Same |
| `eval3@pbgscout.com` | `Scout2025!` | Evaluator | Same |
| `eval4@pbgscout.com` | `Scout2025!` | Evaluator | Same |
| `demo.athlete.5a6b8b@example.com` | `Athlete2026!` | Athlete | My ID, photo, public story, milestones |

### PBG South (second org — multi-org demo)

| Email | Password | Role | Notes |
|---|---|---|---|
| `owner@pbgscout.com` | `Scout2025!` | Owner | Same user; **switch org** in the sidebar |
| `coach.south@pbgscout.com` | `Scout2025!` | Coach | Only belongs to PBG South |

**How to switch orgs (owner):** Sign in → sidebar **Organization** dropdown → choose **PBG Midwest** or **PBG South**. Lists of players, events, and programs change with the org.

---

## 2. Mental model (how the product is structured)

```
Organization (tenant)
├── Staff (owner, admin, head scout, coach, evaluator)
├── Athletes / Players
├── Programs          ← long-term (seasons, training blocks)
│   ├── Sessions
│   ├── Enrollments
│   └── Attendance
└── Events            ← short-term (camps, clinics, evaluation days)
    ├── Roster + Check-In
    ├── Groups
    ├── Stations + Templates
    ├── Evaluator assignments
    └── Evaluations → Review → Reports
```

**Rule of thumb**

| Thing | Time horizon | Use when… |
|---|---|---|
| **Organization** | Permanent | A club, academy, or region with its own people & data |
| **Program** | Weeks–months | Year-round development, recurring training |
| **Event** | Hours–days | Camp/clinic/eval day with stations and scores |

Every query is filtered by `organization_id`. Org A never sees Org B’s athletes, events, or staff.

---

## 3. Roles & powers

### Summary matrix

| Capability | Owner | Admin | Head Scout | Coach | Evaluator | Athlete | Parent |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Switch / view own orgs | ✓ | ✓* | ✓* | ✓* | ✓* | ✓* | ✓* |
| Edit org settings | ✓ | | | | | | |
| Invite / manage staff | ✓ | ✓ | view | | | | |
| Templates & drills admin | ✓ | ✓ | | | | | |
| Audit log | ✓ | ✓ | | | | | |
| Create programs & events | ✓ | ✓ | | | | | |
| Player directory CRUD / import | ✓ | ✓ | ✓ | ✓ | limited | | |
| Check-in on events | ✓ | ✓ | ✓ | ✓ | | | |
| Assign evaluators / invite codes | ✓ | ✓ | | | | | |
| Score at assigned station | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| Review queue (approve/return) | ✓ | ✓ | ✓ | | | | |
| Verified metrics / generate plan | ✓ | ✓ | ✓ | ✓ | | | |
| Approve awards | ✓ | ✓ | ✓ | | | | |
| Media consent (staff) | ✓ | ✓ | ✓ | ✓ | | | |
| My ID / public story | | | | | | ✓ | ✓ |
| Approve child’s media | | | | | | | ✓ |

\*Users only see orgs they have an active membership in. Most demo staff are Midwest-only; the owner is in Midwest + South.

### Organization Owner
- Full control of the **active** organization.
- Staff invites, templates, drills, audit log, settings.
- Sees Programs + Events + Review + everything coaches see.
- Can belong to multiple orgs and **switch** between them.
- Typical camp lead / academy director.

### Administrator
- Same day-to-day powers as owner for ops (staff, events, players, review).
- Cannot change owner-only org fields the same way (owner is the primary settings owner).
- Good for ops managers who run camp day.

### Head Scout
- Quality control of evaluations.
- **Review Queue:** approve or return submitted evals with notes.
- Can unlock/edit in authorized review flows (audited).
- Sees players, programs, events, reports, development.
- Approves awards and can work verified-metric workflows with coaches.

### Coach
- Roster, check-in, programs/sessions/attendance.
- Player profiles: assessments, goals, verified metrics, development plans, media upload.
- Cannot access Review Queue or staff admin.
- Strong day-of operator without scoring every station unless also assigned.

### Evaluator
- Narrow lane: **Dashboard → Evaluate** for their station/group assignments.
- Autosave scores, submit & lock, see returned evals to fix.
- Cannot see guardian PII the way admins can; cannot run Review Queue.
- Optional join via **event redeem code** (`/redeem`).

### Athlete
- Lands on **My ID** only (staff areas blocked).
- Edit bio; upload profile photo (under-18 needs consent).
- See evaluations, milestones, verified metrics, awards (allowed statuses).
- Opt-in **Public ID Story** + QR.
- In-app notifications (bell).

### Parent / Guardian
- Same portal shell as athlete (**My ID**) for their linked child.
- Approve/reject pending media consent for under-age athletes.
- Receives consent / milestone style notifications when linked.

---

## 4. Organizations

### What an organization is
A tenant: name, tagline, contact, feature flags, and all child data (athletes, staff memberships, programs, events, media, metrics).

### How login picks an org
1. JWT includes the active `organization_id`.
2. Preference stored as `active_organization_id` on the user.
3. **Switch organization** issues a new token and reloads the app into that org’s data.

### Walkthrough — owner multi-org
1. Sign in as `owner@pbgscout.com`.
2. Sidebar shows **Organization: PBG Midwest**.
3. Open **Players** — ~30 Midwest athletes.
4. Switch to **PBG South**.
5. **Players** now shows ~6 South athletes; **Events** shows the South clinic; **Programs** shows the South long-term block.
6. Switch back to Midwest for full camp demo.

### Creating orgs in real use
- Demo data: `python seed.py` (wipes local DB — never on production).
- Production: `python bootstrap_admin.py --org "…" --email …` creates the first org + owner (see `DEPLOY.md`).

---

## 5. Programs (long-term)

**Nav:** Programs  

Programs are the year-round chassis: training blocks, multi-week camps as ongoing products, coaching clinics as series.

### Concepts
- **Program** — named block with type, dates, capacity, status.
- **Session** — a date on the calendar under a program (optional link to an event).
- **Enrollment** — athlete joined to the program.
- **Attendance** — present/absent (etc.) per session.

### Walkthrough — coach
1. Sign in as `coach@pbgscout.com`.
2. **Programs** → open or create a program.
3. Add **sessions** (dates / focus).
4. **Enroll** athletes from the org directory.
5. Mark **attendance** on session days.

Programs do **not** replace event check-in or the evaluation Review Queue.

---

## 6. Events (short-term camps / clinics / eval days)

**Nav:** Events  

An event is a single evaluation day (or short camp) with roster, stations, and scoring.

### Typical event lifecycle (statuses)
Draft → Registration Open → Registration Closed → Check-In Open → **Evaluation Active** → Evaluation Complete → Reports Under Review → Closed  

Camp day should be **Evaluation Active**.

### Event tabs (staff)
| Tab | Purpose |
|---|---|
| Overview | Status, counts, basics |
| Roster | Add players from directory; optional groups |
| Check-In | Mark checked in; bib #; group assignment |
| Groups | Optional lanes (e.g. 12U A) |
| Stations | Scoring lanes + evaluation templates |
| Evaluators | Assign staff to station/group; **invite codes** |
| Live Progress | Completion by station / evaluator |
| Results | Leaderboard / CSV export |

### Walkthrough — morning setup (owner/admin/coach)
1. Open the Midwest evaluation event.
2. Set status to **Evaluation Active** (if not already).
3. **Check-In:** search athlete → check in → bib / group.
4. Confirm **Stations** and **Evaluators** assignments.
5. Optional: **Evaluators** tab → **Generate code** → share `/redeem` with a guest evaluator.

### Walkthrough — redeem invite code
1. Owner generates a 6-character code on the event.
2. Guest opens `/redeem` (no login yet).
3. Enters code, email, name, password → becomes coach/evaluator in that org and can be assigned to a station.

---

## 7. Player onboarding

### Path A — Staff creates the player (directory)
1. **Players →** add player (or **Import** CSV).
2. Fill name, DOB/age group, position, guardian email if known.
3. Player exists in the org directory even before they have a login.

### Path B — Invite to athlete / parent portal
1. Open **Players → [athlete]**.
2. Click **Invite to platform**.
3. System emails an accept link (`/accept-invitation`).
   - Under ~13: invite tends toward **guardian (parent)** role.
   - 13+: athlete email when present.
4. Recipient sets a password → lands on **My ID**.

### Path C — Athlete completes My ID
1. Sign in as athlete.
2. **My ID → Edit:** bio + photo.
3. Under-18 photos go to **pending consent** until coach/parent approves.
4. After approval, photo appears on the ID card (avatar).

### Path D — Public ID Story (opt-in)
1. Athlete toggles **Public ID Story** on My ID.
2. System ensures a `public_slug`.
3. QR / link opens `/story/{slug}` **without login**.
4. Story shows approved evals, verified metrics, milestones, approved media only.

---

## 8. Evaluations (camp scoring loop)

### Pieces
- **Template** — metrics/categories for a station (Templates admin).
- **Station** — physical/logical lane on an event, linked to a template.
- **Assignment** — which evaluator covers which station (+ optional groups).
- **Evaluation** — one athlete × station score sheet (draft → submitted → approved/returned).

### Walkthrough — evaluator
1. Sign in as `eval1@pbgscout.com`.
2. **Dashboard → Start / Continue Evaluating** (or **Evaluate**).
3. Wait for templates to cache (offline-friendly).
4. Pick a checked-in athlete in your lane.
5. Score metrics — watch autosave (**Saved**).
6. **Submit & Lock** when finished.
7. If Head Scout **returns** it, it appears as **Returned** — fix and resubmit.

### Walkthrough — head scout review
1. Sign in as `headscout@pbgscout.com`.
2. **Evaluations / Review Queue**.
3. Open a submitted eval → **Approve** or **Return** with a note.
4. Approved scores feed player summaries, reports, and development plans.

### Offline note
Opened drafts can keep working on device; starting a brand-new player or final submit needs connectivity.

---

## 9. Verified metrics, milestones, plans, awards

### Verified metrics (credibility loop)
1. Coach/owner opens **Players → [athlete] → Verified**.
2. Log e.g. Exit Velo / 60-yard / Pop Time.
3. If it beats prior best → **personal best milestone** + in-app notification to athlete/guardian.

### Development plan (rule-based, no live LLM)
1. Same player → **Development → Generate plan**.
2. Engine uses evaluation category strengths/weaknesses + drill library + position.
3. Stores weekly/monthly goals and recommended drills.

### Drills library
- Owner/admin: **Drills** nav — org catalog (seeded from Velo-style taxonomy).

### Awards
1. Staff submits on **Players → Awards**.
2. Owner / head scout **Approve** or **Reject**.
3. Approval can create a milestone + notify the athlete.

---

## 10. Media & consent

1. Staff upload on player **Media** tab (must confirm consent checkbox).
2. Athlete self-upload via My ID Edit.
3. Under-18 (athlete portal) / under-13 (staff upload rules) → `pending_consent` (not live as profile photo until approved).
4. **Approve** as coach on Media tab, or as parent on My ID banner.
5. Profile photo only applies when marked/recognized as profile photo and approved.

---

## 11. Notifications

- In-app bell (sidebar / mobile header).
- Fired for: personal bests, media consent needed / decided, awards pending/approved, event invite codes (when emailed user exists), etc.
- Email via Resend is for invites/resets in production config — not required for the in-app bell.

---

## 12. Role-by-role walkthroughs (quick scripts)

### A. Organization owner — “run the org”
1. Login `owner@pbgscout.com` / `Scout2025!`.
2. Confirm org name in sidebar; try switching Midwest ↔ South.
3. **Staff** — see roles; invite flow exists for new emails.
4. **Events** — open Midwest camp → Check-In / Evaluators / Progress.
5. **Programs** — long-term list for active org.
6. **Templates / Drills / Audit / Settings** — admin surfaces.

### B. Coach — “camp morning + development”
1. Login `coach@pbgscout.com`.
2. Event → Check-In a player.
3. Players → open athlete → Verified → log a metric.
4. Development → Generate plan.
5. Programs → attendance if running year-round work the same week.

### C. Evaluator — “score the station”
1. Login `eval1@pbgscout.com`.
2. Evaluate → score → submit.
3. Do not expect Review Queue or Staff admin.

### D. Head scout — “quality gate”
1. Login `headscout@pbgscout.com`.
2. Review Queue → return one, approve one.
3. Players → Awards → approve a pending award if present.

### E. Athlete — “My ID story”
1. Login `demo.athlete.5a6b8b@example.com` / `Athlete2026!`.
2. My ID → Edit photo/bio.
3. If pending consent, have coach approve on Media tab.
4. Toggle Public ID Story → open `/story/…`.
5. Check bell for milestones after coach logs a PB.

---

## 13. What each nav item is for

| Nav | Who sees it | Purpose |
|---|---|---|
| Dashboard | Staff | Day hub, start evaluating, counts |
| Programs | Owner–Coach | Long-term training |
| Events | Staff (evaluators: assigned) | Short-term camps / eval days |
| Players | Owner–Coach (+ head scout) | Directory & profiles |
| Evaluate | Evaluator (+ staff who score) | Station scoring |
| My Evaluations | Evaluator | Own sheets |
| Evaluations (Review) | Owner, Admin, Head Scout | Approve / return |
| Reports | Staff (varies) | Leaderboards, PDFs, CSV |
| Development | Owner–Coach | Goals / assessments hub |
| Staff | Owner, Admin | Memberships & invites |
| Templates | Owner, Admin | Metric sheets |
| Drills | Owner, Admin | Drill catalog |
| Audit Log | Owner, Admin | Who did what |
| Settings | Most roles | Org/account context |
| My ID | Athlete, Parent | Athlete-facing portal |

---

## 14. Security & tenancy notes (for operators)

- JWT identifies the user; **active org** is in the token (`org` claim) after login/switch.
- Cross-org reads return 403/404 — covered by `tests/test_org_isolation.py`.
- Evaluators are scoped to assignments; guardian fields are hidden from evaluator list views.
- Seed script **wipes** the local DB — never run against production.
- Production checklist: `DEPLOY.md` (Atlas, R2/S3, Resend, strong `JWT_SECRET`).

---

## 15. Local run (reminder)

```bash
# Mongo
docker start mongo-606 2>/dev/null || docker run -d --name mongo-606 -p 27017:27017 mongo:7

# API
cd backend
source .venv/bin/activate
python seed.py          # optional reset of demo data
uvicorn server:app --reload --host 127.0.0.1 --port 8000

# Web
cd frontend
echo 'REACT_APP_BACKEND_URL=http://127.0.0.1:8000' > .env
npm start
```

Camp smoke: `python camp_readiness_check.py`  
Isolation: `pytest ../tests/test_org_isolation.py -q`

---

## 16. Live demo (hosted)

- App: https://606-scout.surge.sh (Surge frontend + hosted API — laptop can be off)
- Cold starts: free API hosts may take 30–60s on first request after idle
- Deploy detail: `DEPLOY_HOSTED.md` · production domain path: `DOMAIN.md` (`id.606athletics.com` / `app.606athletics.com`)

---

## 17. Out of scope for the August camp cut

- Real Google OAuth (password + invites instead)
- Live LLM development plans (rule-based generator ships instead)
- Mobile push / APNs
- Fancy Cloudinary ID-card compositor (DOM/QR is enough)

---

*Document matches the 60'6" ID codebase. For deploy infrastructure, see `DEPLOY_HOSTED.md` and `DOMAIN.md`. Camp-day checklist: `README.md` → Camp day runbook.*
