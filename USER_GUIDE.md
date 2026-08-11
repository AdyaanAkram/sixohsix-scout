# 60'6" ID — User Guide & Test Playbook

**Product name:** 60'6" ID
**Tagline:** Every Player. Every Rep. Every Season Tells the Story.
**Motto:** Train. Elevate. Succeed.
**Live app (fully hosted):** https://606-scout.surge.sh
**Local app:** http://localhost:3000 · **API docs (local):** http://localhost:8000/docs

> **Cold start:** first load after idle can take 30–60 seconds while the free hosted API wakes up —
> wait once, then it is responsive. **Warm the app up before evaluators arrive on camp day.**

This guide is organized so that **testing comes first**. The platform has been verified by
automated tests and a full click-through of the live site — but the one thing no automation can
prove is how it behaves **in your hands, on your phones, on gym wifi**. Run Part 1 before the
event. Everything after Part 1 is reference.

---

# PART 1 — TEST IT BEFORE THE 16TH

## 1.1 What is already verified vs. what only you can verify

| Already verified (automated + live click-through) | Only YOU can verify |
|---|---|
| 30/30 cross-org isolation tests; 34/35 feature tests | The evaluation flow **on the actual phones evaluators will use** |
| Login, autosave round-trip, submit, review, reports on the live site | Behavior on the **venue's real wifi** (captive portals, dead zones) |
| Age/position template resolution (10U P ≠ 17U P) | Camera capture on iOS/Android hardware |
| Role dashboards, player card, scout board, grad-year filters | Touch-target comfort with real hands moving fast |
| Access-code expiry, note visibility, metric trust tiers | Your rubric: do the seeded templates match how you actually score? |

**The paper backup rule stands:** print blank scoring sheets for camp day. The software is solid,
but the event must not be able to fail on a dead phone battery or a venue with no signal at all.

## 1.2 THE CRITICAL TEST — 20 minutes, on a real phone

This is the single most important test in this document. It simulates exactly how evaluations get
lost at a ballpark. Do it on the same model of phone/tablet evaluators will use.

1. On the phone, open **https://606-scout.surge.sh**, sign in as `eval1@pbgscout.com` /
   `Scout2025!`, and tap **Continue Evaluating**. Wait for "templates cached for offline."
2. Open any player. Score 2–3 metrics. Watch the pill go **Synced**.
3. **Turn on Airplane Mode.** Keep scoring 3–4 more metrics. The pill should show
   offline/pending — **it must NOT claim Synced**.
4. Still offline: **force-quit the browser app entirely.** Reopen it, go back to the evaluation.
   → PASS: the app loads (offline shell) and every score you entered is still there.
5. Take a photo with the in-form camera button while still offline.
   → PASS: it queues rather than erroring out and disappearing.
6. **Turn Airplane Mode off.** Wait a few seconds.
   → PASS: pill returns to **Synced**; the queued photo uploads.
7. On a second device (or laptop), sign in as staff and open the same player.
   → PASS: every offline score is on the server. **No duplicates, no losses.**
8. Repeat steps 3–6 once on the **venue's actual wifi** (not your home network) if at all possible.
   Captive-portal wifi (login-page wifi) is precisely the historical failure mode.

**If ANY step fails:** note the phone model, browser, and step number — that exact report makes it
fixable in hours. Do not discover this on the 16th.

## 1.3 Event-day dress rehearsal — 45 minutes, whole crew

Run a miniature camp end-to-end, ideally with the real evaluators, a few days out:

1. **Owner/admin** (`owner@pbgscout.com`): create a small test event (or reuse the seeded camp),
   set status **Evaluation Active**, check in 4–6 athletes with bib numbers and groups.
2. **Access codes:** Evaluators tab → enter a helper's real personal email → generate a code →
   confirm the email arrives (production email must be configured) or relay the code shown
   on-screen. Helper signs in via `/redeem` and sees **only** their station.
3. **Evaluators** (2+ people at once, on phones): score players simultaneously at different
   stations. Verify prev/next by bib, missing-score warnings, and Submit.
4. **Site manager**: open the event's **Live Progress** tab while scoring is happening. Verify the
   counts move — checked-in, in progress, complete, missing — and click a player to see exactly
   which metrics are missing.
5. **Head scout** (`headscout@pbgscout.com`): Review Queue → **Return** one evaluation with a note
   (evaluator should see it come back), **Approve** another → open its **Results summary**.
6. **Reports**: open Reports, confirm the insight cards populate; export the CSV; generate one
   player PDF and confirm charts + 60'6" branding.
7. **Wrap-up:** revoke the helper's access from the Evaluators tab and confirm they are locked out
   immediately.

## 1.4 Role-by-role test checklists

Work through each role. Every line is a pass/fail check — the **Expected** column is what you
should see. Test on the live site.

### A. Evaluator — the field experience (highest priority)
Login: `eval1@pbgscout.com` / `Scout2025!`

| ✓ | Check | Expected |
|---|---|---|
| ☐ | Dashboard after login | "Evaluation Mode": N remaining, assignment cards, big Continue CTA — nothing else |
| ☐ | Evaluate loop | Roster shows photo, name, **bib badge**, group, done/draft/todo chips; Todo/All/Done filters; name-or-bib search ("7" finds #7, not #17) |
| ☐ | "Next · #N Name" quick-start button | Jumps straight into the next unscored player |
| ☐ | Open evaluation | Sticky header: photo, big red bib, name, position, completion % — stays while scrolling |
| ☐ | Score buttons | Big targets; tap → category gets a check; pill flips to **Synced**; completion % climbs |
| ☐ | Category relevance | A non-catcher does not see catching categories (a "Show all" toggle exists for utility players) |
| ☐ | Notes shortcut | The footer notes button jumps to comments in one tap |
| ☐ | Prev/next | Footer shows "#N LastName" both directions |
| ☐ | Submit with missing required scores | Warning "N required metrics still empty" — visible without scrolling |
| ☐ | Camera | Photo/video capture with preview + retake; consent flow appears for minors |
| ☐ | Lockout | No Review Queue, no Players directory, no admin nav anywhere |

### B. Site manager / Owner — Organization HQ & event ops
Login: `owner@pbgscout.com` / `Scout2025!`

| ✓ | Check | Expected |
|---|---|---|
| ☐ | Dashboard | "Organization HQ": org name prominent over "POWERED BY 60'6" ID", KPI row, grad-class chips, development pulse |
| ☐ | Org switcher | Midwest ↔ South switch changes players/events/programs completely |
| ☐ | Event → Live Progress | All counts: checked-in, in progress, complete, missing, flagged, active evaluators, videos awaiting approval; "Not enough data yet" where honest |
| ☐ | Player drill-down | Click a player in progress view → per-station complete/draft/missing + the exact missing metrics |
| ☐ | Grad chips | Clicking "2027 · N" opens Players filtered to that class |
| ☐ | Templates admin | Create a template, add/rename/reorder categories, set age band + positions, delete with confirm |
| ☐ | Settings | Org logo URL can be set (owner only, https required) |

### C. Head scout — quality gate
Login: `headscout@pbgscout.com` / `Scout2025!`

| ✓ | Check | Expected |
|---|---|---|
| ☐ | Dashboard | "Review Desk": awaiting-review hero + CTA, development pulse, Top Movers with grad classes and +change chips |
| ☐ | Review Queue | Return with note; Approve; "Results summary" link opens the visual results page |
| ☐ | Results page | Score, change, top-3 strengths/improvements, radar, verified measurements — prose behind "View Full Evaluation" |
| ☐ | Scout → Prospect Board | Grad chips, position filter, score-sorted cards, verified-metric chips with trust badges, Compare |
| ☐ | Compare | Up to 4 players, side-by-side cards + charts; a 5th is refused |
| ☐ | Reports | Six insight cards on top; all legacy tabs/CSV/PDF beneath |

### D. Coach — my athletes & development
Login: `coach@pbgscout.com` / `Scout2025!`

| ✓ | Check | Expected |
|---|---|---|
| ☐ | Dashboard | "My Athletes": goals first, event quick actions, athletes with active goals |
| ☐ | Player profile | Digital player card: big photo, "2029 \| SS/3B \| R/R" line, Verified pill, 6 KPIs with Development emphasized |
| ☐ | Development change | Profile, dashboard, and athlete view all show the SAME trend for the same player |
| ☐ | Goals | Create with recommended action, assigned coach, start/target/follow-up dates, progress % |
| ☐ | Verified metrics | Log one; source picker enforces trust tiers; a PB triggers a milestone |
| ☐ | Privacy | No Review Queue; no confidential scout notes anywhere coach-visible |

### E. Athlete / Parent — My Development
Login (live site): `athlete.demo@pbgscout.com` / `Scout2025!` (Miguel Reyes, two seasons)
Login (local seed): `demo.athlete.5a6b8b@example.com` / `Athlete2026!`

| ✓ | Check | Expected |
|---|---|---|
| ☐ | First screen | "MY DEVELOPMENT" + development headline (e.g. "↑ +14% development this season") before any score |
| ☐ | Priorities | "My current priorities" — max 3, baseline → target, never a 10-weakness dump |
| ☐ | Personal bests | PB chips with verification badges (e.g. Exit Velocity · EVENT VERIFIED) |
| ☐ | Permanent ID | `606-XXXXXXXX` visible on the page and the ID card |
| ☐ | Seasons | Both seasons listed under the one profile; Career Overview aggregates |
| ☐ | Lockout | No staff pages reachable; no other athlete's data |
| ☐ | Public story | Toggle Public ID Story → `/story/{slug}` works logged-out, shows only approved content |
| ☐ | Consent (parent) | A minor's uploaded photo sits in pending consent until approved |

## 1.5 Known quirks & failure playbook

| Symptom | Cause | What to do |
|---|---|---|
| First login takes 30–60 s | Free API host waking from sleep | Wait once; warm it up before camp; consider a paid tier for event day |
| "Too many attempts" on login | Rate limiter: 15 logins/min per network | Wait 60 s. On camp day, have evaluators sign in as they arrive, not all at once |
| Pill stuck on pending after reconnect | Wifi is captive-portal ("login page") wifi | Open any website, complete the portal login, return to the app — it flushes |
| Score entered but pill never says Synced | Truly offline | That is correct behavior — it will sync on reconnect; do not clear the browser |
| Invite email never arrives | Production email (Resend) not configured | Relay the on-screen code manually; set up Resend per `.env.example` |
| Blank page after an update | Stale cached shell | Hard-refresh once (pull-down on mobile); the app shell is version-stamped so this self-heals |

**Never do on camp day:** clear the browser's site data on an evaluator's phone (that is where
offline drafts live), reseed any database, or change event status mid-scoring without need.

---

# PART 2 — LOGINS

All seeded staff passwords are **`Scout2025!`**.

### PBG Midwest (main demo org)

| Email | Role | Best for trying… |
|---|---|---|
| `owner@pbgscout.com` | Organization Owner | Org HQ, switcher, staff, settings, full camp ops |
| `admin@pbgscout.com` | Administrator | Same day-to-day ops minus owner-only settings |
| `headscout@pbgscout.com` | Head Scout | Review Desk, approve/return, results, scout board |
| `coach@pbgscout.com` | Coach | My Athletes, check-in, metrics, goals, development |
| `eval1@pbgscout.com` … `eval4@pbgscout.com` | Evaluator | Evaluation Mode, station scoring, autosave |
| `athlete.demo@pbgscout.com` | Athlete (**live site**) | My Development, seasons, PBs, public story |
| `demo.athlete.5a6b8b@example.com` / `Athlete2026!` | Athlete (**local seed**) | Same, against local data |

### PBG South (second org — multi-org demo)

| Email | Role | Notes |
|---|---|---|
| `owner@pbgscout.com` | Owner | Same user; **switch org** in the sidebar |
| `coach.south@pbgscout.com` | Coach | Belongs only to PBG South |

**Switch orgs (owner):** sidebar **Organization** block → choose the org. Players, events, and
programs all change with it.

> Demo passwords are for seeded demo data only — rotate before any real athlete data goes in.

---

# PART 3 — WHAT THE APP IS

## 3.1 Mental model

```
Organization (tenant)
├── Staff (owner, admin, head scout, coach, evaluator)
├── Athletes / Players  ← one permanent 60'6" ID each, seasons stacked underneath
├── Programs            ← long-term (seasons, training blocks)
│   ├── Sessions / Enrollments / Attendance
└── Events              ← short-term (camps, clinics, evaluation days)
    ├── Roster + Check-In (bibs, groups)
    ├── Stations + age/position Templates
    ├── Evaluator assignments (expiring access)
    └── Evaluations → Review → Reports
```

| Thing | Time horizon | Use when… |
|---|---|---|
| **Organization** | Permanent | A club, academy, or region with its own people & data |
| **Program** | Weeks–months | Year-round development, recurring training |
| **Event** | Hours–days | Camp/clinic/eval day with stations and scores |

Every query is filtered by organization. Org A never sees Org B's athletes, events, or staff.

## 3.2 The feature map (what the revisions delivered)

- **Permanent 60'6" ID + seasons.** One profile per athlete forever (`606-XXXXXXXX`); seasons stack
  under it; a Career Overview aggregates across years; history is never overwritten.
- **Five-second surfaces.** Player card hero (photo, `2029 | SS/3B | R/R`, six KPIs), role-first
  dashboards, insight-card reports — detail always one click deeper, never deleted.
- **Development is the story.** Development change leads the athlete view, the profile KPIs, and
  the dashboards; ranking is available but never first.
- **Age- & position-aware evaluations.** Eight bands (7U-8U → Professional); a 10U and a 17U
  pitcher get different forms; only relevant categories show; admins compose templates freely.
- **Verified metrics with trust tiers.** Athlete/Parent/Coach Submitted · Event/Device/60'6"
  Verified — visually distinct, enforced server-side, compared against previous, PB, and age/
  position benchmarks (never fabricated).
- **Field-grade evaluation mode.** Sticky bib header, offline-durable autosave (IndexedDB + app
  shell), offline media queue, bib-labeled prev/next, missing-score warnings.
- **Event operations.** Live manager dashboard with per-player incomplete drill-down; temporary
  coach access via emailed codes that expire with the event and revoke instantly.
- **Scout Mode.** Prospect board by grad class/position with verified metrics and comparison
  (up to 4, coaches/scouts only).
- **Reports.** Player PDF with charts, progress report, category ranking, position comparison,
  evaluator disagreement with severity — plus CSV, all 60'6"-branded.
- **Consent & privacy.** Under-13 media requires guardian approval before any display; "private"
  is enforced server-side; confidential notes filtered by role on every path.

Deliberately deferred (do not expect these yet): AI plans/rankings, payments, drill-assignment
loop, badges/trophy room, public rankings for young children, admin scheduling.

---

# PART 4 — ROLES & POWERS

| Capability | Owner | Admin | Head Scout | Coach | Evaluator | Athlete | Parent |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Switch / view own orgs | ✓ | ✓* | ✓* | ✓* | ✓* | ✓* | ✓* |
| Edit org settings (incl. logo) | ✓ | | | | | | |
| Invite / manage staff | ✓ | ✓ | view | | | | |
| Templates & drills admin | ✓ | ✓ | | | | | |
| Audit log | ✓ | ✓ | | | | | |
| Create programs & events | ✓ | ✓ | | | | | |
| Player directory CRUD / import | ✓ | ✓ | ✓ | ✓ | limited | | |
| Check-in on events | ✓ | ✓ | ✓ | ✓ | | | |
| Assign evaluators / invite codes | ✓ | ✓ | | | | | |
| Score at assigned station | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| Review queue (approve/return) | ✓ | ✓ | ✓ | | | | |
| Player comparison / Scout board | ✓ | ✓ | ✓ | ✓ | | | |
| Verified metrics / development | ✓ | ✓ | ✓ | ✓ | | | |
| Approve awards | ✓ | ✓ | ✓ | | | | |
| Media consent (staff side) | ✓ | ✓ | ✓ | ✓ | | | |
| My ID / My Development / story | | | | | | ✓ | ✓ |
| Approve child's media | | | | | | | ✓ |

\* Users only see orgs where they hold an active membership.

**What each role lands on:** Owner/Admin → Organization HQ · Head Scout → Review Desk · Coach →
My Athletes · Evaluator → Evaluation Mode · Athlete/Parent → My Development. Same data platform,
different first screen.

**Evaluators are deliberately boxed in:** assignment-scoped rosters, no guardian/medical/financial
fields, no review queue, no comparison, and access that expires when the event ends.

---

# PART 5 — FEATURE REFERENCE

## 5.1 Navigation

Primary: **Dashboard · Players · Evaluations · Events · Progress · Scout · Reports** (evaluators
see Evaluate / My Evaluations instead). Administration group: Programs, Staff, Templates, Drills,
Audit Log, Settings.

| Nav | Who | Purpose |
|---|---|---|
| Dashboard | Staff | Role-specific home (HQ / Review Desk / My Athletes / Evaluation Mode) |
| Players | Owner–Coach (+HS) | Directory, grad-class chips, profiles |
| Evaluations (Review) | Owner, Admin, HS | Approve / return; open results summaries |
| Events | Staff (evaluators: assigned) | Camps; live manager dashboard; access codes |
| Progress | Owner–Coach | Goals / assessments hub |
| Scout | Review roles + coach | Prospect Board & comparison |
| Reports | Staff (varies) | Insight cards → leaderboards, PDFs, CSV |
| My ID | Athlete, Parent | My Development portal |

## 5.2 Events (camp day)

Lifecycle: Draft → Registration Open → Registration Closed → Check-In Open → **Evaluation
Active** → Evaluation Complete → Reports Under Review → Closed. Camp day = **Evaluation Active**.

Tabs: Overview · Roster · Check-In (bib #, group) · Groups · Stations (+templates) · Evaluators
(assignments + **invite codes**) · Live Progress (manager dashboard + player drill-down) ·
Results.

**Temporary access flow:** enter the coach's personal email on the Evaluators tab → select
station/group → a secure 6-character code is emailed (and shown on screen as a fallback) → they
sign in via `/redeem` → they see only their assignment → access expires with the event; revoke is
immediate.

## 5.3 Evaluations

- **Template** (age band + positions) → **Station** → **Assignment** → **Evaluation**
  (draft → submitted → approved/returned). Approved evaluations are immutable.
- Templates resolve automatically: age+position → position → age → station default. Admins can
  create, edit, reorder, and delete templates and categories (Templates admin).
- The results page leads with score, change, top-3 strengths/improvements, radar, and verified
  measurements; the full write-up sits behind "View Full Evaluation."
- Offline: drafts persist through airplane mode and force-quits (see the Critical Test). Final
  submit needs connectivity.

## 5.4 Players & seasons

- Staff create players directly or import CSV; guardians/athletes join later via invitation email
  (under-13 invitations go to the guardian, always).
- One athlete = one permanent 60'6" ID. Seasons (team, org, age group, physicals) stack underneath;
  editing height/weight/team snapshots the old value — history survives.
- The **Player Story** timeline shows joins, evaluations, PBs, media, seasons, position changes,
  and team changes, each with verification status.
- Public ID Story is opt-in, logged-out shareable, and shows approved content only.

## 5.5 Verified metrics, goals, awards

- Metrics carry a source tier; only staff can record verified tiers; a new PB fires a milestone and
  a notification. Comparison chart shows previous / PB / age benchmark / position benchmark —
  only when real benchmarks exist.
- Goals: title, what needs improvement, recommended action, assigned coach, start/target/follow-up
  dates, progress %, status. Athletes see their top 3 priorities on My Development.
- Awards: staff submit → owner/head scout approve → milestone + notification.
- Drills: org catalog under Administration (assignment loop is roadmap, not built).

## 5.6 Media & consent

Upload from the evaluation form (camera with preview/retake) or the profile Media tab. Every file
stores athlete, event, evaluation, uploader, date, and consent status. Under-age media waits in
**pending consent** (parent approves on My ID; staff on the Media tab). "Mark private" is
enforced server-side: staff-only, regardless of consent. Nothing unapproved ever reaches the
public story.

## 5.7 Notifications

In-app bell for PBs, consent requests/decisions, awards, event invite codes. Email (Resend) sends
invitations, access codes, and password resets once configured — see `.env.example`.

---

# PART 6 — OPERATORS

## 6.1 Security & tenancy

- JWT carries the active org; cross-org reads 403/404 — covered by `tests/test_org_isolation.py`
  (30 tests) and `tests/test_revision_features.py` (34 tests).
- Evaluator redaction hides guardian, medical, insurance, financial, and SSN fields.
- Assignment expiry and revoke are enforced on every request; membership revoke bites immediately
  despite the 7-day JWT.
- Metric trust tiers and confidential-note visibility are server-side on every path (lists,
  summaries, PDFs).
- Seed script **wipes** the target DB — never point it at production casually.

## 6.2 Local run

```bash
# Mongo
docker start mongo-606 2>/dev/null || docker run -d --name mongo-606 -p 27017:27017 mongo:7

# API
cd backend && source .venv/bin/activate
python seed.py          # optional demo-data reset (WIPES local DB)
uvicorn server:app --reload --host 127.0.0.1 --port 8000

# Web
cd frontend
echo 'REACT_APP_BACKEND_URL=http://127.0.0.1:8000' > .env
npm start
```

Tests (need the API running): `pytest tests/test_org_isolation.py -q` and
`pytest tests/test_revision_features.py -q`. Run them separately — the login rate limiter
(15/min) makes back-to-back runs skip; wait ~60 s between suites.

## 6.3 Hosted stack

- **Frontend:** Surge → https://606-scout.surge.sh (`DEPLOY_HOSTED.md`)
- **API:** Render (free tier sleeps — hence cold starts) · **DB:** MongoDB Atlas
- **Email:** Resend — free tier, setup steps in `.env.example` (account + domain verification
  required before invites/codes/resets actually send)
- **Domain:** target `id.606athletics.com` — cutover steps in `DOMAIN.md`

## 6.4 Out of scope for the August camp cut

Real Google OAuth (password + invites instead) · live LLM development plans (rule-based generator
ships) · mobile push · advanced ID-card compositor.

---

*Document matches the deployed 60'6" ID codebase. Deploy detail: `DEPLOY_HOSTED.md` · domain:
`DOMAIN.md` · revision history and per-phase status: `REVISION_PLAN.md`.*
