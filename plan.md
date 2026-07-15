# plan.md — PBG Scout (PBG Midwest Player Development System)

## 1. Objectives
- Deliver a production-ready, mobile-first web app (React + FastAPI + MongoDB) that supports live evaluation day workflows end-to-end.
- Ensure secure multi-tenant org isolation, RBAC, and assignment-based evaluator access with server-side authorization.
- Make the mobile evaluation screen fast, reliable, autosaving, and offline-resilient.
- Preserve permanent player history: never overwrite evaluations; provide progress tracking, reports, and exports.
- Seed full fictional data so the system is usable immediately for testing and demos.

## 2. Implementation Steps

### Phase 1 — Core Flow POC (Isolation): “Assigned Evaluator → Autosave → Offline Draft → Submit → Score”
Goal: Prove the most failure-prone workflow before building the full app UI.
- Web search: best practices for offline-first autosave + conflict handling (IndexedDB/localStorage), FastAPI JWT RBAC patterns, and MongoDB schema patterns for evaluation submissions.
- Backend POC (FastAPI only):
  - Minimal models: org, user, event, group, station, assignment, athlete, evaluation (draft/submitted), metric definitions.
  - Endpoints: get my assignments, list assigned athletes, save draft (idempotent), submit (locks), compute scores (raw + normalized if benchmark exists + weighted).
  - Strict authorization: evaluator can only access assigned event/station/group athletes.
- Frontend POC (single React page):
  - “My Assignment” selector → player list → evaluation form.
  - Autosave on every field change; show Saving/Saved/Offline/Sync Pending.
  - Offline: store drafts locally; on reconnect, sync once (dedupe by evaluation_id + updated_at).
- POC exit criteria:
  - Draft survives refresh/offline/online transitions.
  - Submission locks evaluation; score calculation stable.
  - Unauthorized access attempts are rejected server-side.

User stories (Phase 1)
1. As an evaluator, I can open my assigned station/group and see only my players so I don’t waste time.
2. As an evaluator, my scores autosave instantly so I never lose work.
3. As an evaluator, I can keep scoring offline and sync later without duplicates.
4. As an evaluator, I can submit an evaluation and know it’s locked and recorded.
5. As an admin/head scout, I can trust computed category/overall scores are reproducible.

---

### Phase 2 — V1 App Development (MVP): “Live Evaluation Day Ready”
Build the full app around the proven POC flow; keep scope tight but complete.
- App shell + navigation
  - Desktop sidebar + mobile bottom nav; role-aware routes and menus.
  - Visual identity: deep navy/neutral cards, large mobile controls, clear status badges.
- Data model (MongoDB collections) + services
  - Implement required collections: organizations, profiles/users, memberships, athletes, events, groups, stations, templates/metrics/categories, assignments, evaluations, benchmarks, media, notes, goals, audit_logs, invitations, ai_drafts (schema only).
  - All records include organization_id; created_at/updated_at/created_by.
- Admin workflows
  - Players: list/search/filter, add/edit/archive, CSV import (map → validate → dedupe → confirm), export.
  - Events: create/edit, roster add/remove, groups, stations, evaluator assignments, status transitions.
  - Check-in: mobile-friendly search + presence + bib assignment + walk-ups.
  - Live progress: completion counts by station/group/evaluator.
- Evaluator workflows
  - “Evaluate” focused UX: My Event → My Station → My Group → Next/Prev player.
  - Metrics rendering by template (ratings/measurements/time/velocity/yes-no/comments/not observed).
  - Autosave + offline sync (reuse POC implementation).
  - Pre-submit validation summary; submit locks; audit record.
- Head scout + coach workflows (MVP slice)
  - Head scout review queue: approve/return, final summary, flags, position projection.
  - Coach: add YTD assessment + create goal (timeline entries).
- Media (MVP)
  - Upload image/video to private backend storage; access via authenticated endpoint; consent required flag.
- Seed data
  - Create 1 org + staff roles, 30 players, 1 event, 6 stations, 3 groups, assignments, mixed evaluations, goals/notes, media placeholders.
- Conclude with 1 E2E test pass via testing agent.

User stories (Phase 2)
1. As an admin, I can import a roster from CSV with validation so I can set up quickly.
2. As an admin, I can open check-in and mark players present with bibs on my phone.
3. As an evaluator, I can score an entire group quickly with one-handed controls.
4. As a head scout, I can review submitted evaluations and approve or return them with notes.
5. As a coach, I can add an assessment and a goal that appears on the player timeline.

---

### Phase 3 — Add More Features (Production Hardening + Reporting)
Extend features that unlock reporting, comparisons, and operational reliability.
- Reports + exports
  - Event completion, missing scores, leaderboards/rankings (internal only), evaluator completion.
  - Player PDF report (reportlab) with branding + disclaimer; CSV exports.
- Scoring enhancements
  - Metric benchmarks by age/position; normalization only when benchmark exists; preserve raw always.
  - Disagreement detection (variance across evaluators) for head scout queue.
- Templates management
  - UI to edit categories/metrics/weights, required flags, units, direction (higher/lower better).
- Staff + invitations
  - Invitation flow, membership roles, reset password, session expiry.
- Audit + security hardening
  - Audit logs for critical actions; rate limiting; validation; no direct URL access without permission.
- Conclude with 1 E2E test pass via testing agent.

User stories (Phase 3)
1. As an admin, I can export event results to CSV/PDF immediately after evaluations.
2. As a head scout, I can see evaluator disagreements so I can resolve edge cases.
3. As an owner, I can manage templates so metrics match each age group/station.
4. As an admin, I can invite new evaluators securely and assign them to stations.
5. As staff, I can view audit logs to understand who changed sensitive records.

---

### Phase 4 — Final Production Readiness (Polish, Privacy, Scale)
- Privacy controls: guardian info access restrictions, media consent enforcement, archiving.
- Duplicate merge workflow for athletes; improved search and filters.
- Performance: pagination, indexes, optimized queries; responsive polish.
- Feature flags: Athlete/Parent portals disabled; AI drafts table ready.
- Conclude with final comprehensive testing + security review.

User stories (Phase 4)
1. As an owner, I can ensure minor athlete data is private and access is logged.
2. As an admin, I can merge duplicate player records without losing history.
3. As a coach, I can track progress charts over time on a player profile.
4. As a head scout, I can generate consistent internal rankings by filters.
5. As an evaluator, the app stays fast and stable even with spotty connection.

## 3. Next Actions
1. Run Phase 1 web search and write the POC backend endpoints + minimal React POC UI.
2. Validate offline autosave + sync + submission lock + scoring with seeded sample data.
3. Once POC exit criteria pass, implement Phase 2 in a small number of bulk code writes (frontend+backend together) and load full seed data.
4. Execute testing agent E2E for emergency workflows; fix issues before expanding.

## 4. Success Criteria
- Emergency workflows work end-to-end for Admin, Evaluator, Head Scout, Coach on mobile.
- Evaluator sees only assigned data; server blocks unauthorized access.
- Autosave + offline drafts reliably restore/sync without duplicate submissions.
- Submitted evaluations are immutable (except authorized revision flow with audit).
- Accurate weighted scoring with preserved raw/normalized values; no invented normalization.
- Player profiles show permanent history + timeline; exports (PDF/CSV) generate correctly.
- Seeded fictional dataset allows immediate demo/testing without manual setup.
