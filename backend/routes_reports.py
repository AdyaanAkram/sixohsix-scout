import csv
import io
import statistics
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Response

from auth import ADMIN_ROLES, REVIEW_ROLES, STAFF_ROLES, get_current_user, require_roles
from db import db, log_audit, now_iso
from scoring import MASTER_CATEGORY_WEIGHTS, aggregate_player_scores

router = APIRouter()


# ---------------- Dashboard ----------------

@router.get("/dashboard")
async def dashboard(user=Depends(require_roles(*STAFF_ROLES))):
    org_id = user["organization_id"]
    role = user["role"]

    if role == "evaluator":
        assignments = await db.evaluator_assignments.find({"evaluator_id": user["id"], "organization_id": org_id}, {"_id": 0}).to_list(20)
        items = []
        for a in assignments:
            event = await db.events.find_one({"id": a["event_id"]}, {"_id": 0})
            station = await db.stations.find_one({"id": a["station_id"]}, {"_id": 0, "name": 1})
            groups = await db.event_groups.find({"id": {"$in": a.get("group_ids") or []}}, {"_id": 0, "name": 1}).to_list(20)
            group_ids = a.get("group_ids") or []
            q = {"event_id": a["event_id"], "status": "checked_in"}
            if group_ids:
                q["group_id"] = {"$in": group_ids}
            expected = await db.event_athletes.count_documents(q)
            done = await db.evaluations.count_documents({"event_id": a["event_id"], "station_id": a["station_id"], "evaluator_id": user["id"], "status": {"$in": ["submitted", "approved"]}})
            last_eval = await db.evaluations.find_one({"evaluator_id": user["id"], "event_id": a["event_id"]}, {"_id": 0, "updated_at": 1}, sort=[("updated_at", -1)])
            items.append({
                "assignment_id": a["id"], "event": event,
                "station_name": (station or {}).get("name"),
                "group_names": [g["name"] for g in groups],
                "completed": done, "expected": expected, "remaining": max(0, expected - done),
                "last_saved": (last_eval or {}).get("updated_at"),
            })
        return {"role": role, "assignments": items}

    if role == "head_scout":
        submitted = await db.evaluations.count_documents({"organization_id": org_id, "status": "submitted"})
        approved = await db.evaluations.count_documents({"organization_id": org_id, "status": "approved"})
        flagged = await db.athletes.count_documents({"organization_id": org_id, "flagged_follow_up": True, "status": "active"})
        recent_notes = await db.athlete_notes.find({"organization_id": org_id}, {"_id": 0}).sort("created_at", -1).to_list(5)
        for n in recent_notes:
            ath = await db.athletes.find_one({"id": n["athlete_id"]}, {"_id": 0, "first_name": 1, "last_name": 1})
            n["athlete_name"] = f"{ath['first_name']} {ath['last_name']}" if ath else ""
        top = await _leaderboard_data(org_id, limit=5)
        return {"role": role, "awaiting_review": submitted, "approved": approved,
                "flagged_players": flagged, "recent_notes": recent_notes, "top_players": top}

    # owner / admin / coach
    total_players = await db.athletes.count_documents({"organization_id": org_id, "status": "active"})
    upcoming = await db.events.find_one({"organization_id": org_id, "status": {"$nin": ["Closed"]}}, {"_id": 0}, sort=[("date", -1)])
    stats = {}
    if upcoming:
        stats["registered"] = await db.event_athletes.count_documents({"event_id": upcoming["id"]})
        stats["checked_in"] = await db.event_athletes.count_documents({"event_id": upcoming["id"], "status": "checked_in"})
        stats["evaluations_completed"] = await db.evaluations.count_documents({"event_id": upcoming["id"], "status": {"$in": ["submitted", "approved"]}})
        stats["evaluations_draft"] = await db.evaluations.count_documents({"event_id": upcoming["id"], "status": "draft"})
    recent_players = await db.athletes.find({"organization_id": org_id}, {"_id": 0, "id": 1, "first_name": 1, "last_name": 1, "age_group": 1, "primary_position": 1, "created_at": 1, "photo_url": 1}).sort("created_at", -1).to_list(5)
    submitted = await db.evaluations.count_documents({"organization_id": org_id, "status": "submitted"})
    return {"role": role, "total_players": total_players, "upcoming_event": upcoming,
            "event_stats": stats, "recent_players": recent_players, "awaiting_review": submitted}


# ---------------- Leaderboard / rankings ----------------

async def _leaderboard_data(org_id, event_id=None, age_group=None, position=None, group_id=None, category=None, limit=100):
    q = {"organization_id": org_id, "status": {"$in": ["submitted", "approved"]}}
    if event_id:
        q["event_id"] = event_id
    evals = await db.evaluations.find(q, {"_id": 0}).to_list(2000)
    by_athlete = defaultdict(list)
    for ev in evals:
        by_athlete[ev["athlete_id"]].append(ev)
    rows = []
    for aid, evs in by_athlete.items():
        athlete = await db.athletes.find_one({"id": aid}, {"_id": 0, "id": 1, "first_name": 1, "last_name": 1, "age_group": 1, "primary_position": 1, "current_team": 1, "photo_url": 1})
        if not athlete:
            continue
        if age_group and athlete.get("age_group") != age_group:
            continue
        if position and athlete.get("primary_position") != position:
            continue
        if group_id and event_id:
            entry = await db.event_athletes.find_one({"event_id": event_id, "athlete_id": aid})
            if not entry or entry.get("group_id") != group_id:
                continue
        agg = aggregate_player_scores(evs)
        score = agg["overall_score"]
        if category:
            cat = agg["category_scores"].get(category)
            score = cat["score"] if cat else None
        if score is None:
            continue
        rows.append({"athlete": athlete, "overall_score": agg["overall_score"],
                     "score": score, "category_scores": agg["category_scores"],
                     "evaluation_count": len(evs)})
    rows.sort(key=lambda x: x["score"], reverse=True)
    for i, r in enumerate(rows):
        r["rank"] = i + 1
    return rows[:limit]


@router.get("/reports/leaderboard")
async def leaderboard(event_id: str | None = None, age_group: str | None = None,
                      position: str | None = None, group_id: str | None = None,
                      category: str | None = None,
                      user=Depends(require_roles(*REVIEW_ROLES, "coach"))):
    return await _leaderboard_data(user["organization_id"], event_id, age_group, position, group_id, category)


@router.get("/reports/event-completion/{event_id}")
async def event_completion(event_id: str, user=Depends(require_roles(*REVIEW_ROLES))):
    event = await db.events.find_one({"id": event_id, "organization_id": user["organization_id"]}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")
    roster = await db.event_athletes.find({"event_id": event_id}, {"_id": 0}).to_list(1000)
    stations = await db.stations.find({"event_id": event_id}, {"_id": 0}).to_list(50)
    rows = []
    for entry in roster:
        athlete = await db.athletes.find_one({"id": entry["athlete_id"]}, {"_id": 0, "first_name": 1, "last_name": 1, "age_group": 1, "primary_position": 1, "id": 1})
        if not athlete:
            continue
        station_status = {}
        missing = []
        for s in stations:
            gids = s.get("group_ids") or []
            applies = not gids or entry.get("group_id") in gids
            if not applies:
                station_status[s["name"]] = "n/a"
                continue
            ev = await db.evaluations.find_one({"event_id": event_id, "station_id": s["id"], "athlete_id": entry["athlete_id"], "status": {"$in": ["submitted", "approved"]}})
            if ev:
                station_status[s["name"]] = "complete"
            else:
                draft = await db.evaluations.find_one({"event_id": event_id, "station_id": s["id"], "athlete_id": entry["athlete_id"], "status": "draft"})
                station_status[s["name"]] = "draft" if draft else "missing"
                missing.append(s["name"])
        rows.append({"athlete": athlete, "bib_number": entry.get("bib_number"),
                     "check_in_status": entry.get("status"), "stations": station_status,
                     "missing_stations": missing})
    return {"event": event, "rows": rows, "station_names": [s["name"] for s in stations]}


@router.get("/reports/disagreement/{event_id}")
async def evaluator_disagreement(event_id: str, user=Depends(require_roles(*REVIEW_ROLES))):
    evals = await db.evaluations.find({"event_id": event_id, "organization_id": user["organization_id"], "status": {"$in": ["submitted", "approved"]}}, {"_id": 0}).to_list(2000)
    by_key = defaultdict(list)
    for ev in evals:
        overall = (ev.get("computed") or {}).get("overall_score")
        if overall is not None:
            by_key[(ev["athlete_id"], ev["station_id"])].append((ev.get("evaluator_name") or ev["evaluator_id"], overall))
    rows = []
    for (aid, sid), scores in by_key.items():
        if len(scores) < 2:
            continue
        vals = [s[1] for s in scores]
        spread = round(max(vals) - min(vals), 2)
        stdev = round(statistics.pstdev(vals), 2)
        athlete = await db.athletes.find_one({"id": aid}, {"_id": 0, "first_name": 1, "last_name": 1, "id": 1, "age_group": 1})
        station = await db.stations.find_one({"id": sid}, {"_id": 0, "name": 1})
        rows.append({"athlete": athlete, "station_name": (station or {}).get("name"),
                     "scores": [{"evaluator": s[0], "score": s[1]} for s in scores],
                     "spread": spread, "stdev": stdev})
    rows.sort(key=lambda x: x["spread"], reverse=True)
    return rows


# ---------------- CSV exports ----------------

@router.get("/reports/event-results/{event_id}/csv")
async def export_event_results(event_id: str, user=Depends(require_roles(*ADMIN_ROLES, "head_scout"))):
    event = await db.events.find_one({"id": event_id, "organization_id": user["organization_id"]}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")
    rows = await _leaderboard_data(user["organization_id"], event_id=event_id, limit=1000)
    output = io.StringIO()
    writer = csv.writer(output)
    cats = list(MASTER_CATEGORY_WEIGHTS.keys())
    writer.writerow(["Rank", "Player", "Age Group", "Position", "Team", "Overall Score"] + cats + ["Evaluations"])
    for r in rows:
        a = r["athlete"]
        writer.writerow([
            r["rank"], f"{a.get('first_name')} {a.get('last_name')}", a.get("age_group"),
            a.get("primary_position"), a.get("current_team"), r["overall_score"],
        ] + [(r["category_scores"].get(c) or {}).get("score", "") for c in cats] + [r["evaluation_count"]])
    await log_audit(user["organization_id"], user, "results_exported", "event", event_id)
    return Response(content=output.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f"attachment; filename=event_results.csv"})


# ---------------- Player PDF report ----------------

DISCLAIMER = ("This evaluation represents observations recorded during the listed event or "
              "development period. It does not guarantee team placement, recruitment, "
              "scholarship opportunities, or future athletic outcomes.")


@router.get("/reports/player/{athlete_id}/pdf")
async def player_pdf(athlete_id: str, event_id: str | None = None, user=Depends(require_roles(*REVIEW_ROLES, "coach"))):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.platypus import (Paragraph, SimpleDocTemplate, Spacer, Table,
                                    TableStyle)

    athlete = await db.athletes.find_one({"id": athlete_id, "organization_id": user["organization_id"]}, {"_id": 0})
    if not athlete:
        raise HTTPException(status_code=404, detail="Player not found.")
    q = {"athlete_id": athlete_id, "organization_id": user["organization_id"], "status": {"$in": ["submitted", "approved"]}}
    if event_id:
        q["event_id"] = event_id
    evals = await db.evaluations.find(q, {"_id": 0}).sort("submitted_at", 1).to_list(200)
    agg = aggregate_player_scores(evals)

    org = await db.organizations.find_one({"id": user["organization_id"]}, {"_id": 0})
    navy = colors.HexColor("#0F2A4A")
    gold = colors.HexColor("#C9A227")

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, topMargin=0.6 * inch, bottomMargin=0.6 * inch)
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=styles["Heading1"], textColor=navy, fontSize=20, spaceAfter=2)
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], textColor=navy, fontSize=13, spaceBefore=12, spaceAfter=4)
    body = ParagraphStyle("body", parent=styles["Normal"], fontSize=9.5, leading=13)
    small = ParagraphStyle("small", parent=styles["Normal"], fontSize=7.5, textColor=colors.grey, leading=10)

    story = []
    story.append(Paragraph((org or {}).get("name", "PBG Midwest") + " — Player Evaluation Report", h1))
    story.append(Paragraph("Identify. Evaluate. Develop. Connect.", ParagraphStyle("tag", parent=body, textColor=gold, fontSize=10)))
    story.append(Spacer(1, 10))

    name = f"{athlete.get('first_name')} {athlete.get('last_name')}"
    info_data = [
        ["Player", name, "Player ID", athlete.get("id", "")[:8].upper()],
        ["Age Group", athlete.get("age_group") or "—", "Grad Year", str(athlete.get("graduation_year") or "—")],
        ["Position", athlete.get("primary_position") or "—", "Bats / Throws", f"{athlete.get('bats') or '—'} / {athlete.get('throws') or '—'}"],
        ["Team", athlete.get("current_team") or "—", "Location", f"{athlete.get('city') or ''}, {athlete.get('state') or ''}"],
    ]
    t = Table(info_data, colWidths=[1.1 * inch, 2.4 * inch, 1.1 * inch, 2.4 * inch])
    t.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 0), (0, -1), navy), ("TEXTCOLOR", (2, 0), (2, -1), navy),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"), ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5), ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("LINEBELOW", (0, 0), (-1, -2), 0.5, colors.HexColor("#E5E1D8")),
    ]))
    story.append(t)

    story.append(Paragraph("Overall Score", h2))
    overall = agg["overall_score"]
    story.append(Paragraph(f"<b>{overall if overall is not None else 'Not yet scored'}</b> / 10" if overall is not None else "Not yet scored", ParagraphStyle("score", parent=body, fontSize=16, textColor=navy)))

    if agg["category_scores"]:
        story.append(Paragraph("Category Scores", h2))
        cat_rows = [["Category", "Score (0-10)", "Weight"]]
        for cat, d in sorted(agg["category_scores"].items(), key=lambda x: -x[1]["weight"]):
            cat_rows.append([cat, str(d["score"]), f"{d['weight']}%"])
        ct = Table(cat_rows, colWidths=[3 * inch, 2 * inch, 2 * inch])
        ct.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), navy), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTSIZE", (0, 0), (-1, -1), 9), ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F7F5F0")]),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5), ("TOPPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(ct)

    # raw measurements + comments per evaluation
    if evals:
        story.append(Paragraph("Evaluation Detail", h2))
        for ev in evals:
            station = await db.stations.find_one({"id": ev["station_id"]}, {"_id": 0, "name": 1})
            event = await db.events.find_one({"id": ev["event_id"]}, {"_id": 0, "name": 1, "date": 1})
            template = await db.evaluation_templates.find_one({"id": ev.get("template_id")}, {"_id": 0})
            story.append(Paragraph(f"<b>{(station or {}).get('name', 'Station')}</b> — {(event or {}).get('name', '')} ({(event or {}).get('date', '')}) — Evaluator: {ev.get('evaluator_name', '')}", body))
            mrows = [["Metric", "Result", "Normalized"]]
            metric_map = {m["id"]: m for m in (template or {}).get("metrics", [])}
            results = (ev.get("computed") or {}).get("metric_results", {})
            for mid, res in results.items():
                m = metric_map.get(mid, {})
                raw = res.get("raw")
                unit = m.get("unit") or ""
                if res.get("not_observed"):
                    display = "Not observed"
                else:
                    display = f"{raw} {unit}".strip()
                norm = res.get("normalized")
                mrows.append([m.get("name", mid)[:40], str(display)[:40], str(norm) if norm is not None else "raw only"])
            if len(mrows) > 1:
                mt = Table(mrows, colWidths=[3 * inch, 2.2 * inch, 1.8 * inch])
                mt.setStyle(TableStyle([
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("LINEBELOW", (0, 0), (-1, 0), 0.8, navy),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F7F5F0")]),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3), ("TOPPADDING", (0, 0), (-1, -1), 3),
                ]))
                story.append(mt)
            comments = ev.get("comments") or {}
            if comments.get("strengths"):
                story.append(Paragraph(f"<b>Strengths:</b> {comments['strengths']}", body))
            if comments.get("development_needs"):
                story.append(Paragraph(f"<b>Development needs:</b> {comments['development_needs']}", body))
            if comments.get("general"):
                story.append(Paragraph(f"<b>Comments:</b> {comments['general']}", body))
            story.append(Spacer(1, 8))

    # head scout summary
    scout_note = await db.athlete_notes.find_one({"athlete_id": athlete_id, "note_type": "scout_assessment"}, {"_id": 0}, sort=[("created_at", -1)])
    if scout_note:
        story.append(Paragraph("Head Scout Summary", h2))
        story.append(Paragraph(scout_note.get("summary", ""), body))
        if scout_note.get("position_recommendation"):
            story.append(Paragraph(f"<b>Position projection:</b> {scout_note['position_recommendation']}", body))
        if scout_note.get("development_recommendation"):
            story.append(Paragraph(f"<b>Development recommendation:</b> {scout_note['development_recommendation']}", body))

    goals = await db.athlete_goals.find({"athlete_id": athlete_id, "status": {"$nin": ["Archived"]}}, {"_id": 0}).to_list(20)
    if goals:
        story.append(Paragraph("Development Goals", h2))
        for g in goals:
            story.append(Paragraph(f"• <b>{g.get('title')}</b> — {g.get('status')} ({g.get('progress', 0)}%)", body))

    story.append(Spacer(1, 16))
    story.append(Paragraph(DISCLAIMER, small))
    doc.build(story)
    buf.seek(0)
    await log_audit(user["organization_id"], user, "player_report_generated", "athlete", athlete_id)
    return Response(content=buf.read(), media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename={name.replace(' ', '_')}_report.pdf"})
