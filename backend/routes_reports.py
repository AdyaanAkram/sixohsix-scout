import csv
import io
import statistics
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Response

from auth import (ADMIN_ROLES, REVIEW_ROLES, STAFF_ROLES, active_assignment_filter,
                  get_current_user, require_roles)
from db import db, log_audit, now_iso
from routes_development import _note_visible_to_role
from routes_players import _grad_year_counts
from scoring import (MASTER_CATEGORY_WEIGHTS, aggregate_player_scores,
                     canonical_metric_key, metric_meta)

router = APIRouter()


# ---------------- Dashboard ----------------

@router.get("/dashboard")
async def dashboard(user=Depends(require_roles(*STAFF_ROLES))):
    org_id = user["organization_id"]
    role = user["role"]

    if role == "evaluator":
        assignments = await db.evaluator_assignments.find(
            {"evaluator_id": user["id"], "organization_id": org_id, **active_assignment_filter()},
            {"_id": 0}).to_list(20)
        items = []
        for a in assignments:
            event = await db.events.find_one({"id": a["event_id"], "organization_id": org_id}, {"_id": 0})
            station = await db.stations.find_one({"id": a["station_id"], "organization_id": org_id}, {"_id": 0, "name": 1})
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
            ath = await db.athletes.find_one(
                {"id": n["athlete_id"], "organization_id": org_id},
                {"_id": 0, "first_name": 1, "last_name": 1})
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
    # One athlete lookup per evaluated athlete, plus one roster lookup each when
    # filtering by group, is a round-trip per row before a single score is read.
    ids = list(by_athlete)
    athletes = {
        a["id"]: a
        for a in await db.athletes.find(
            {"id": {"$in": ids}, "organization_id": org_id},
            {"_id": 0, "id": 1, "first_name": 1, "last_name": 1, "age_group": 1,
             "primary_position": 1, "current_team": 1, "photo_url": 1}).to_list(len(ids) or 1)
    }
    entry_group = {}
    if group_id and event_id:
        entry_group = {
            e["athlete_id"]: e.get("group_id")
            for e in await db.event_athletes.find(
                {"event_id": event_id, "athlete_id": {"$in": ids}},
                {"_id": 0, "athlete_id": 1, "group_id": 1}).to_list(len(ids) or 1)
        }

    rows = []
    for aid, evs in by_athlete.items():
        athlete = athletes.get(aid)
        if not athlete:
            continue
        if age_group and athlete.get("age_group") != age_group:
            continue
        if position and athlete.get("primary_position") != position:
            continue
        if group_id and event_id:
            # Absent from the roster is still a miss, exactly as before.
            if entry_group.get(aid) != group_id:
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


@router.get("/reports/category-ranking")
async def category_ranking(event_id: str | None = None, age_group: str | None = None,
                           position: str | None = None, group_id: str | None = None,
                           category: str | None = None, limit: int = 25,
                           user=Depends(require_roles(*REVIEW_ROLES, "coach"))):
    """Per-category rankings (spec §19).

    One pass through `_leaderboard_data` (which already applies the org, event,
    age and position filters) is re-ranked in memory for every category, so
    six category boards cost the same as one leaderboard. Aggregates are
    computed only from players who actually hold a score in that category —
    a category with no data reports `null`, never 0.
    """
    limit = max(1, min(int(limit or 25), 200))
    org_id = user["organization_id"]
    base = await _leaderboard_data(org_id, event_id, age_group, position, group_id, limit=2000)
    wanted = [category] if category else list(MASTER_CATEGORY_WEIGHTS.keys())

    out = []
    for cat in wanted:
        scored = [r for r in base if (r["category_scores"].get(cat) or {}).get("score") is not None]
        scored.sort(key=lambda r: r["category_scores"][cat]["score"], reverse=True)
        vals = [r["category_scores"][cat]["score"] for r in scored]
        out.append({
            "category": cat,
            "weight": MASTER_CATEGORY_WEIGHTS.get(cat),
            "scored_players": len(scored),
            "average_score": round(statistics.fmean(vals), 2) if vals else None,
            "top_score": max(vals) if vals else None,
            "rows": [{
                "rank": i + 1,
                "athlete": r["athlete"],
                "score": r["category_scores"][cat]["score"],
                "overall_score": r["overall_score"],
                "evaluation_count": r["evaluation_count"],
            } for i, r in enumerate(scored[:limit])],
        })
    return {
        "filters": {"event_id": event_id, "age_group": age_group, "position": position,
                    "group_id": group_id, "category": category, "limit": limit},
        "ranked_players": len(base),
        "categories": out,
    }


@router.get("/reports/position-comparison")
async def position_comparison(event_id: str | None = None, age_group: str | None = None,
                              group_id: str | None = None, category: str | None = None,
                              min_players: int = 1,
                              user=Depends(require_roles(*REVIEW_ROLES, "coach"))):
    """Position-vs-position comparison (spec §19).

    Buckets the same `_leaderboard_data` rows by primary position. Athletes with
    no recorded position are excluded rather than pooled into an invented
    bucket, and a category average is omitted entirely when no player at that
    position has been scored in it.
    """
    org_id = user["organization_id"]
    min_players = max(1, min(int(min_players or 1), 50))
    base = await _leaderboard_data(org_id, event_id, age_group, None, group_id, limit=2000)

    groups = defaultdict(list)
    unpositioned = 0
    for r in base:
        pos = (r["athlete"].get("primary_position") or "").strip()
        if not pos:
            unpositioned += 1
            continue
        groups[pos].append(r)

    positions = []
    for pos, rows in groups.items():
        if len(rows) < min_players:
            continue
        overalls = [r["overall_score"] for r in rows if r["overall_score"] is not None]
        cat_avgs = {}
        for cat in MASTER_CATEGORY_WEIGHTS:
            vals = [(r["category_scores"].get(cat) or {}).get("score") for r in rows]
            vals = [v for v in vals if v is not None]
            if vals:
                cat_avgs[cat] = {"average": round(statistics.fmean(vals), 2), "scored_players": len(vals)}
        best = max(rows, key=lambda r: r["overall_score"]) if overalls else None
        positions.append({
            "position": pos,
            "player_count": len(rows),
            "average_overall": round(statistics.fmean(overalls), 2) if overalls else None,
            "median_overall": round(statistics.median(overalls), 2) if overalls else None,
            "best_overall": max(overalls) if overalls else None,
            "top_player": {"athlete": best["athlete"], "overall_score": best["overall_score"]} if best else None,
            "category_averages": cat_avgs,
        })

    if category:
        positions.sort(key=lambda p: (p["category_averages"].get(category) is None,
                                      -((p["category_averages"].get(category) or {}).get("average") or 0)))
    else:
        positions.sort(key=lambda p: (p["average_overall"] is None, -(p["average_overall"] or 0)))

    all_overalls = [r["overall_score"] for r in base if r["overall_score"] is not None]
    return {
        "filters": {"event_id": event_id, "age_group": age_group, "group_id": group_id,
                    "category": category, "min_players": min_players},
        "categories": list(MASTER_CATEGORY_WEIGHTS.keys()),
        "positions": positions,
        "ranked_players": len(base),
        "players_without_position": unpositioned,
        "org_average_overall": round(statistics.fmean(all_overalls), 2) if all_overalls else None,
    }


@router.get("/reports/event-completion/{event_id}")
async def event_completion(event_id: str, user=Depends(require_roles(*REVIEW_ROLES))):
    event = await db.events.find_one({"id": event_id, "organization_id": user["organization_id"]}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")
    roster = await db.event_athletes.find({"event_id": event_id}, {"_id": 0}).to_list(1000)
    stations = await db.stations.find({"event_id": event_id}, {"_id": 0}).to_list(50)
    # Module-state awareness (Revision 5 §5): a station marked not_offered is not
    # run at this event — it must never be counted as missing. Legacy stations
    # carry no module_state and were always required. Column order follows the
    # event's configured display_order (name breaks ties).
    from routes_events import module_state_of, station_sort_key
    stations.sort(key=station_sort_key)
    # One athlete lookup and two evaluation lookups per roster-entry-per-station
    # is roster x stations x 2 round-trips — 50 athletes across 20 stations was
    # ~2,050 sequential queries and over 30s. Resolve both up front instead.
    athlete_ids = [e["athlete_id"] for e in roster if e.get("athlete_id")]
    athletes = {
        a["id"]: a
        for a in await db.athletes.find(
            {"id": {"$in": athlete_ids}, "organization_id": user["organization_id"]},
            {"_id": 0, "first_name": 1, "last_name": 1, "age_group": 1,
             "primary_position": 1, "id": 1}).to_list(len(athlete_ids) or 1)
    }
    # (station_id, athlete_id) -> whether it is finished or merely started.
    finished, started = set(), set()
    async for ev in db.evaluations.find(
        {"event_id": event_id, "status": {"$in": ["submitted", "approved", "draft"]}},
        {"_id": 0, "station_id": 1, "athlete_id": 1, "status": 1},
    ):
        key = (ev.get("station_id"), ev.get("athlete_id"))
        (finished if ev["status"] in ("submitted", "approved") else started).add(key)

    rows = []
    for entry in roster:
        athlete = athletes.get(entry["athlete_id"])
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
            if module_state_of(s) == "not_offered":
                station_status[s["name"]] = "not_offered"
                continue
            key = (s["id"], entry["athlete_id"])
            if key in finished:
                station_status[s["name"]] = "complete"
            else:
                # Unchanged from the per-row version: a draft still counts as
                # outstanding work, so it lands in `missing` alongside a no-show.
                station_status[s["name"]] = "draft" if key in started else "missing"
                missing.append(s["name"])
        rows.append({"athlete": athlete, "bib_number": entry.get("bib_number"),
                     "check_in_status": entry.get("status"), "stations": station_status,
                     "missing_stations": missing})
    return {"event": event, "rows": rows, "station_names": [s["name"] for s in stations]}


# ---------------- Evaluator disagreement (spec §19) ----------------
#
# Severity bands for `spread` (max - min) between evaluators scoring the same
# athlete at the same station. Both bounds are on the same 0-10 scale as the
# overall score, and both are deliberately named constants rather than literals
# buried in a comparison:
#
#   spread <  1.5  -> "normal"   Inside the subjective variance two trained
#                                evaluators routinely show on the same rep set.
#                                Averaging these is fine.
#   spread >= 1.5  -> "review"   Roughly a half grade band apart. A manager
#                                should look before the scores feed rankings.
#   spread >= 2.5  -> "critical" More than a full grade band apart — the two
#                                evaluators did not see the same player. These
#                                should be reconciled, not averaged.
#
# The bands were set against the 0-10 master scale where a whole point is one
# visible grade step; they are NOT derived from this tenant's data, so they are
# overridable per request via `review_threshold` / `critical_threshold`. Every
# row echoes the bounds in force so no client has to hardcode a cutoff.
DISAGREEMENT_REVIEW_THRESHOLD = 1.5
DISAGREEMENT_CRITICAL_THRESHOLD = 2.5


def _disagreement_severity(spread: float, review: float, critical: float) -> str:
    if spread >= critical:
        return "critical"
    if spread >= review:
        return "review"
    return "normal"


@router.get("/reports/disagreement/{event_id}")
async def evaluator_disagreement(
    event_id: str,
    review_threshold: float = DISAGREEMENT_REVIEW_THRESHOLD,
    critical_threshold: float = DISAGREEMENT_CRITICAL_THRESHOLD,
    user=Depends(require_roles(*REVIEW_ROLES)),
):
    """Evaluations that disagree, largest spread first.

    Returns a list (several screens consume it as one). Each row carries the
    spread, the population stdev, the severity band, and the bounds that band
    was computed with.
    """
    review = max(0.0, min(float(review_threshold), 10.0))
    critical = max(review, min(float(critical_threshold), 10.0))

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
        athlete = await db.athletes.find_one({"id": aid, "organization_id": user["organization_id"]}, {"_id": 0, "first_name": 1, "last_name": 1, "id": 1, "age_group": 1})
        station = await db.stations.find_one({"id": sid, "organization_id": user["organization_id"]}, {"_id": 0, "name": 1})
        rows.append({"athlete": athlete, "station_name": (station or {}).get("name"),
                     "scores": [{"evaluator": s[0], "score": s[1]} for s in scores],
                     "spread": spread, "stdev": stdev,
                     "mean": round(statistics.fmean(vals), 2),
                     "evaluator_count": len(vals),
                     "severity": _disagreement_severity(spread, review, critical),
                     "review_threshold": review, "critical_threshold": critical})
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


# ---------------- PDF report shared pieces ----------------

DISCLAIMER = ("This evaluation represents observations recorded during the listed event or "
              "development period. It does not guarantee team placement, recruitment, "
              "scholarship opportunities, or future athletic outcomes.")

# 60'6" ID print palette: black / white / red, matching the app theme in
# index.css. Never navy/gold. Every chart below draws from these two hexes.
CHART_INK = "#0A0A0A"
CHART_BRAND = "#DC2626"
CHART_MUTED = "#8A8A8A"
CHART_GRID = "#E5E1D8"
CHART_ROW_ALT = "#F7F5F0"
SCORE_MAX = 10.0


def _report_styles():
    """Shared 60'6" ID paragraph styles, so both PDFs brand identically."""
    from reportlab.lib import colors
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet

    ink = colors.HexColor(CHART_INK)
    brand = colors.HexColor(CHART_BRAND)
    base = getSampleStyleSheet()
    body = ParagraphStyle("body", parent=base["Normal"], fontSize=9.5, leading=13)
    return {
        "ink": ink, "brand": brand,
        "h1": ParagraphStyle("h1", parent=base["Heading1"], textColor=ink, fontSize=20, spaceAfter=2),
        "h2": ParagraphStyle("h2", parent=base["Heading2"], textColor=ink, fontSize=13, spaceBefore=12, spaceAfter=4),
        "body": body,
        "small": ParagraphStyle("small", parent=base["Normal"], fontSize=7.5, textColor=colors.grey, leading=10),
        "caption": ParagraphStyle("caption", parent=base["Normal"], fontSize=7.5, textColor=colors.grey, leading=10, spaceAfter=1),
        "tagline": ParagraphStyle("tag", parent=body, textColor=brand, fontSize=10),
        "score": ParagraphStyle("score", parent=body, fontSize=16, textColor=brand),
    }


def _report_header(st, org, subtitle):
    """60'6" ID masthead. The only product branding is 60'6"; the org name below
    it is the tenant the data belongs to, not a product name."""
    from reportlab.platypus import Paragraph, Spacer

    out = [Paragraph(f"60'6\" ID — {subtitle}", st["h1"]),
           Paragraph("Every Player. Every Rep. Every Season Tells the Story.", st["tagline"])]
    if (org or {}).get("name"):
        out.append(Paragraph(org["name"], st["small"]))
    out.append(Spacer(1, 10))
    return out


# ---------------- PDF charts (spec §19) ----------------
#
# Every builder returns None when there is not enough real data to plot, so the
# caller omits the whole block instead of rendering an empty axis. Nothing is
# ever zero-filled to make a chart look complete.

def _short(label, n=13):
    s = str(label or "")
    return s if len(s) <= n else s[: n - 1] + "…"


def _style_value_axis(axis):
    from reportlab.lib import colors
    axis.valueMin = 0
    axis.valueMax = SCORE_MAX
    axis.valueStep = 2
    axis.labels.fontName = "Helvetica"
    axis.labels.fontSize = 7
    axis.strokeColor = colors.HexColor(CHART_INK)
    axis.visibleGrid = 1
    axis.gridStrokeColor = colors.HexColor(CHART_GRID)
    axis.gridStrokeWidth = 0.4


def _style_category_axis(axis, names):
    from reportlab.lib import colors
    axis.categoryNames = names
    axis.labels.fontName = "Helvetica"
    axis.labels.fontSize = 6.5
    axis.labels.angle = 20
    axis.labels.dy = -3
    axis.labels.boxAnchor = "ne"
    axis.strokeColor = colors.HexColor(CHART_INK)


def _category_bar_chart(category_scores, width=468, height=190):
    """Category scores on a fixed 0-10 axis — the print twin of the on-screen radar."""
    from reportlab.graphics.charts.barcharts import VerticalBarChart
    from reportlab.graphics.shapes import Drawing
    from reportlab.lib import colors

    items = [(c, d) for c, d in (category_scores or {}).items() if (d or {}).get("score") is not None]
    if not items:
        return None
    items.sort(key=lambda x: -float(x[1].get("weight") or 0))

    dr = Drawing(width, height)
    bc = VerticalBarChart()
    bc.x, bc.y = 30, 34
    bc.width, bc.height = width - 48, height - 48
    bc.data = [[round(float(v["score"]), 2) for _, v in items]]
    bc.groupSpacing = 10
    bc.barSpacing = 2
    bc.bars.strokeColor = None
    bc.bars[0].fillColor = colors.HexColor(CHART_BRAND)
    bc.barLabels.fontName = "Helvetica-Bold"
    bc.barLabels.fontSize = 7
    bc.barLabelFormat = "%0.2f"
    bc.barLabels.nudge = 7
    _style_value_axis(bc.valueAxis)
    _style_category_axis(bc.categoryAxis, [_short(c) for c, _ in items])
    dr.add(bc)
    return dr


def _trend_line_chart(points, width=468, height=190):
    """Overall score at each evaluation checkpoint. None below 2 checkpoints."""
    from reportlab.graphics.charts.linecharts import HorizontalLineChart
    from reportlab.graphics.shapes import Drawing
    from reportlab.graphics.widgets.markers import makeMarker
    from reportlab.lib import colors

    plotted = [p for p in (points or []) if p.get("overall_score") is not None]
    if len(plotted) < 2:
        return None

    dr = Drawing(width, height)
    lc = HorizontalLineChart()
    lc.x, lc.y = 30, 34
    lc.width, lc.height = width - 48, height - 48
    lc.data = [[round(float(p["overall_score"]), 2) for p in plotted]]
    lc.lines[0].strokeColor = colors.HexColor(CHART_BRAND)
    lc.lines[0].strokeWidth = 2
    lc.lines[0].symbol = makeMarker("FilledCircle", size=5, fillColor=colors.HexColor(CHART_BRAND))
    lc.lineLabels.fontName = "Helvetica-Bold"
    lc.lineLabels.fontSize = 7
    lc.lineLabelFormat = "%0.2f"
    lc.lineLabelNudge = 8
    _style_value_axis(lc.valueAxis)
    _style_category_axis(lc.categoryAxis, [_short(p.get("label"), 10) for p in plotted])
    dr.add(lc)
    return dr


def _comparison_bar_chart(labels, prev_vals, cur_vals, prev_name, cur_name,
                          width=468, height=205):
    """Two-series previous-vs-current comparison, muted grey vs brand red."""
    from reportlab.graphics.charts.barcharts import VerticalBarChart
    from reportlab.graphics.shapes import Drawing, Rect, String
    from reportlab.lib import colors

    pairs = [(lab, p, c) for lab, p, c in zip(labels, prev_vals, cur_vals)
             if p is not None and c is not None]
    if not pairs:
        return None

    dr = Drawing(width, height)
    bc = VerticalBarChart()
    bc.x, bc.y = 30, 34
    bc.width, bc.height = width - 48, height - 66
    bc.data = [[round(float(p), 2) for _, p, _ in pairs],
               [round(float(c), 2) for _, _, c in pairs]]
    bc.groupSpacing = 12
    bc.barSpacing = 1
    bc.bars.strokeColor = None
    bc.bars[0].fillColor = colors.HexColor(CHART_MUTED)
    bc.bars[1].fillColor = colors.HexColor(CHART_BRAND)
    bc.barLabels.fontName = "Helvetica"
    bc.barLabels.fontSize = 6
    bc.barLabelFormat = "%0.1f"
    bc.barLabels.nudge = 6
    _style_value_axis(bc.valueAxis)
    _style_category_axis(bc.categoryAxis, [_short(lab) for lab, _, _ in pairs])
    dr.add(bc)

    ink = colors.HexColor(CHART_INK)
    legend_y = height - 13
    dr.add(Rect(30, legend_y, 9, 9, fillColor=colors.HexColor(CHART_MUTED), strokeColor=None))
    dr.add(String(43, legend_y + 1.5, _short(prev_name, 30), fontName="Helvetica", fontSize=7.5, fillColor=ink))
    dr.add(Rect(210, legend_y, 9, 9, fillColor=colors.HexColor(CHART_BRAND), strokeColor=None))
    dr.add(String(223, legend_y + 1.5, _short(cur_name, 30), fontName="Helvetica", fontSize=7.5, fillColor=ink))
    return dr


def _score_timeline(evals):
    """Player-level overall score at each evaluation checkpoint.

    A checkpoint is one calendar day of submitted/approved evaluations. The
    day's evaluations are aggregated with the same master category weights the
    app uses on screen, so each point is directly comparable to the player's
    headline score. Days that produce no score are dropped, never zero-filled.
    """
    by_day = defaultdict(list)
    for ev in evals:
        ts = ev.get("submitted_at") or ev.get("updated_at") or ev.get("created_at")
        day = str(ts)[:10] if ts else ""
        if len(day) == 10:
            by_day[day].append(ev)
    points = []
    for day in sorted(by_day):
        agg = aggregate_player_scores(by_day[day])
        if agg["overall_score"] is None:
            continue
        points.append({
            "date": day,
            "label": f"{day[5:7]}/{day[8:10]}",
            "overall_score": agg["overall_score"],
            "category_scores": agg["category_scores"],
            "evaluation_count": len(by_day[day]),
        })
    return points


def _category_delta_rows(earlier, later):
    """Per-category first-vs-latest deltas. `delta` is null when either side has
    no score for that category — the gap is reported, never imputed."""
    e_cats = (earlier or {}).get("category_scores") or {}
    l_cats = (later or {}).get("category_scores") or {}
    names = set(e_cats) | set(l_cats)
    rows = []
    for cat in sorted(names, key=lambda c: (-MASTER_CATEGORY_WEIGHTS.get(c, 0), c)):
        prev = (e_cats.get(cat) or {}).get("score")
        cur = (l_cats.get(cat) or {}).get("score")
        rows.append({
            "category": cat,
            "weight": MASTER_CATEGORY_WEIGHTS.get(cat),
            "previous_score": prev,
            "current_score": cur,
            "delta": round(cur - prev, 2) if prev is not None and cur is not None else None,
        })
    return rows


def _fmt_delta(value):
    if value is None:
        return "—"
    return f"+{value}" if value > 0 else str(value)


# ---------------- Player PDF report ----------------


@router.get("/reports/player/{athlete_id}/pdf")
async def player_pdf(athlete_id: str, event_id: str | None = None, user=Depends(require_roles(*REVIEW_ROLES, "coach"))):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
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
    # 60'6" ID palette: black / white / red. Must match the app theme in index.css.
    st = _report_styles()
    ink, brand = st["ink"], st["brand"]
    h1, h2, body, small, caption = st["h1"], st["h2"], st["body"], st["small"], st["caption"]

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, topMargin=0.6 * inch, bottomMargin=0.6 * inch)

    story = _report_header(st, org, "Player Evaluation Report")

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
        ("TEXTCOLOR", (0, 0), (0, -1), ink), ("TEXTCOLOR", (2, 0), (2, -1), ink),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"), ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5), ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("LINEBELOW", (0, 0), (-1, -2), 0.5, colors.HexColor("#E5E1D8")),
    ]))
    story.append(t)

    story.append(Paragraph("Overall Score", h2))
    overall = agg["overall_score"]
    story.append(Paragraph(f"<b>{overall if overall is not None else 'Not yet scored'}</b> / 10" if overall is not None else "Not yet scored", st["score"]))

    if agg["category_scores"]:
        story.append(Paragraph("Category Scores", h2))
        # Visual first (spec §19): the chart is the print twin of the on-screen
        # radar. It is omitted, not stubbed, when no category has a score.
        chart = _category_bar_chart(agg["category_scores"])
        if chart is not None:
            story.append(Paragraph("Weighted category scores, 0-10 scale.", caption))
            story.append(chart)
        cat_rows = [["Category", "Score (0-10)", "Weight"]]
        for cat, d in sorted(agg["category_scores"].items(), key=lambda x: -x[1]["weight"]):
            cat_rows.append([cat, str(d["score"]), f"{d['weight']}%"])
        ct = Table(cat_rows, colWidths=[3 * inch, 2 * inch, 2 * inch])
        ct.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), ink), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTSIZE", (0, 0), (-1, -1), 9), ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor(CHART_ROW_ALT)]),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5), ("TOPPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(ct)

    # Score over time + previous-vs-current (spec §19). Both blocks disappear
    # entirely when the athlete has only one scored checkpoint.
    timeline = _score_timeline(evals)
    trend = _trend_line_chart(timeline)
    if trend is not None:
        story.append(Paragraph("Overall Score Over Time", h2))
        story.append(Paragraph(
            f"Overall score at each of the {len(timeline)} evaluation dates on record.", caption))
        story.append(trend)

    if len(timeline) >= 2:
        prev_pt, cur_pt = timeline[-2], timeline[-1]
        deltas = _category_delta_rows(prev_pt, cur_pt)
        comparison = _comparison_bar_chart(
            [d["category"] for d in deltas],
            [d["previous_score"] for d in deltas],
            [d["current_score"] for d in deltas],
            f"Previous ({prev_pt['label']})", f"Current ({cur_pt['label']})")
        story.append(Paragraph("Previous vs Current", h2))
        story.append(Paragraph(
            f"Evaluation of {prev_pt['date']} compared with {cur_pt['date']}. "
            "Categories scored on only one of the two dates show no change value.", caption))
        if comparison is not None:
            story.append(comparison)
        cmp_rows = [["", f"Previous ({prev_pt['label']})", f"Current ({cur_pt['label']})", "Change"]]
        cmp_rows.append(["Overall", str(prev_pt["overall_score"]), str(cur_pt["overall_score"]),
                         _fmt_delta(round(cur_pt["overall_score"] - prev_pt["overall_score"], 2))])
        for d in deltas:
            cmp_rows.append([d["category"],
                             "—" if d["previous_score"] is None else str(d["previous_score"]),
                             "—" if d["current_score"] is None else str(d["current_score"]),
                             _fmt_delta(d["delta"])])
        cmt = Table(cmp_rows, colWidths=[2.6 * inch, 1.5 * inch, 1.5 * inch, 1.4 * inch])
        cmt.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), ink), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTSIZE", (0, 0), (-1, -1), 9), ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTNAME", (0, 1), (-1, 1), "Helvetica-Bold"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor(CHART_ROW_ALT)]),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4), ("TOPPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(cmt)

    # raw measurements + comments per evaluation
    if evals:
        story.append(Paragraph("Evaluation Detail", h2))
        for ev in evals:
            station = await db.stations.find_one({"id": ev["station_id"], "organization_id": user["organization_id"]}, {"_id": 0, "name": 1})
            event = await db.events.find_one({"id": ev["event_id"], "organization_id": user["organization_id"]}, {"_id": 0, "name": 1, "date": 1})
            template = await db.evaluation_templates.find_one({"id": ev.get("template_id"), "organization_id": user["organization_id"]}, {"_id": 0})
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
                    ("LINEBELOW", (0, 0), (-1, 0), 0.8, brand),
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
    scout_note = await db.athlete_notes.find_one(
        {"athlete_id": athlete_id, "organization_id": user["organization_id"],
         "note_type": {"$in": ["scout_assessment", "scout"]}},
        {"_id": 0}, sort=[("created_at", -1)])
    # This endpoint is open to coaches, who must not receive confidential notes.
    if scout_note and not _note_visible_to_role(scout_note, user["role"]):
        scout_note = None
    if scout_note:
        story.append(Paragraph("Head Scout Summary", h2))
        story.append(Paragraph(scout_note.get("summary", ""), body))
        if scout_note.get("position_recommendation"):
            story.append(Paragraph(f"<b>Position projection:</b> {scout_note['position_recommendation']}", body))
        if scout_note.get("development_recommendation"):
            story.append(Paragraph(f"<b>Development recommendation:</b> {scout_note['development_recommendation']}", body))

    goals = await db.athlete_goals.find(
        {"athlete_id": athlete_id, "organization_id": user["organization_id"],
         "status": {"$nin": ["Archived"]}}, {"_id": 0}).to_list(20)
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


# ---------------- Player progress report (spec §19) ----------------
#
# Development over time for one athlete: score trend, first-vs-latest category
# deltas, verified-measurement changes, and goal progress. Deliberately carries
# no scout or development notes — it is a numbers-over-time artifact, so there
# is no note surface here to gate.
#
# Everything derives from the same org-scoped collections the player report
# reads. Where a comparison needs two data points and only one exists, the
# value is null and the caller shows nothing; nothing is ever imputed.

async def _progress_data(athlete: dict, org_id: str) -> dict:
    aid = athlete["id"]

    evals = await db.evaluations.find(
        {"athlete_id": aid, "organization_id": org_id,
         "status": {"$in": ["submitted", "approved"]}},
        {"_id": 0}).sort("submitted_at", 1).to_list(500)
    timeline = _score_timeline(evals)
    overall_agg = aggregate_player_scores(evals)

    score_trend = None
    category_deltas = []
    previous_vs_current = None
    if len(timeline) >= 2:
        first, latest = timeline[0], timeline[-1]
        delta = round(latest["overall_score"] - first["overall_score"], 2)
        score_trend = {
            "first_date": first["date"], "first_score": first["overall_score"],
            "latest_date": latest["date"], "latest_score": latest["overall_score"],
            "delta": delta,
            "direction": "up" if delta > 0 else "down" if delta < 0 else "flat",
            "checkpoints": len(timeline),
        }
        category_deltas = _category_delta_rows(first, latest)
        prev_pt = timeline[-2]
        previous_vs_current = {
            "previous_date": prev_pt["date"], "previous_score": prev_pt["overall_score"],
            "current_date": latest["date"], "current_score": latest["overall_score"],
            "delta": round(latest["overall_score"] - prev_pt["overall_score"], 2),
            "categories": _category_delta_rows(prev_pt, latest),
        }

    # Verified measurements: first vs latest reading per canonical metric key.
    metric_rows = await db.verified_metrics.find(
        {"athlete_id": aid, "organization_id": org_id}, {"_id": 0}).to_list(500)
    by_metric = defaultdict(list)
    for m in metric_rows:
        key = canonical_metric_key(m.get("metric_key"))
        if not key or m.get("value") is None:
            continue
        by_metric[key].append(m)

    measurements = []
    for key, items in by_metric.items():
        items.sort(key=lambda x: (str(x.get("measured_at") or ""), str(x.get("created_at") or "")))
        meta = metric_meta(key) or {}
        first_m, latest_m = items[0], items[-1]
        lower_better = meta.get("lower_better")
        delta = improved = None
        if len(items) > 1:
            delta = round(float(latest_m["value"]) - float(first_m["value"]), 2)
            if delta == 0:
                improved = False
            elif lower_better is not None:
                improved = (delta < 0) if lower_better else (delta > 0)
        measurements.append({
            "metric_key": key,
            "label": meta.get("label") or key.replace("_", " ").title(),
            "unit": latest_m.get("unit") or meta.get("unit"),
            "lower_better": lower_better,
            "reading_count": len(items),
            "first": {"value": float(first_m["value"]),
                      "measured_at": first_m.get("measured_at") or str(first_m.get("created_at") or "")[:10]},
            "latest": {"value": float(latest_m["value"]),
                       "measured_at": latest_m.get("measured_at") or str(latest_m.get("created_at") or "")[:10]},
            "delta": delta,
            "improved": improved,
        })
    measurements.sort(key=lambda m: m["label"])

    goal_docs = await db.athlete_goals.find(
        {"athlete_id": aid, "organization_id": org_id, "status": {"$nin": ["Archived"]}},
        {"_id": 0}).sort("created_at", 1).to_list(100)
    progress_values = [int(g.get("progress") or 0) for g in goal_docs]
    status_counts = defaultdict(int)
    for g in goal_docs:
        status_counts[g.get("status") or "Not Started"] += 1
    goals = {
        "total": len(goal_docs),
        "by_status": dict(status_counts),
        "average_progress": round(statistics.fmean(progress_values), 1) if progress_values else None,
        "items": [{
            "id": g.get("id"), "title": g.get("title"), "category": g.get("category"),
            "status": g.get("status"), "progress": g.get("progress"),
            "starting_point": g.get("starting_point"), "target": g.get("target"),
            "target_date": g.get("target_date"), "assigned_coach_name": g.get("assigned_coach_name"),
        } for g in goal_docs],
    }

    return {
        "athlete": {k: athlete.get(k) for k in
                    ("id", "first_name", "last_name", "age_group", "primary_position",
                     "current_team", "graduation_year", "photo_url")},
        "generated_at": now_iso(),
        "evaluation_count": len(evals),
        "current_overall_score": overall_agg["overall_score"],
        "current_category_scores": overall_agg["category_scores"],
        "timeline": timeline,
        "score_trend": score_trend,
        "category_deltas": category_deltas,
        "previous_vs_current": previous_vs_current,
        "measurements": measurements,
        "goals": goals,
        "disclaimer": DISCLAIMER,
    }


@router.get("/reports/player/{athlete_id}/progress")
async def player_progress(athlete_id: str, user=Depends(require_roles(*REVIEW_ROLES, "coach"))):
    """JSON progress report for the UI. Same audience as the player PDF."""
    athlete = await db.athletes.find_one(
        {"id": athlete_id, "organization_id": user["organization_id"]}, {"_id": 0})
    if not athlete:
        raise HTTPException(status_code=404, detail="Player not found.")
    return await _progress_data(athlete, user["organization_id"])


@router.get("/reports/player/{athlete_id}/progress/pdf")
async def player_progress_pdf(athlete_id: str, user=Depends(require_roles(*REVIEW_ROLES, "coach"))):
    """PDF export of the progress report, branded and gated like the player PDF."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.units import inch
    from reportlab.platypus import (Paragraph, SimpleDocTemplate, Spacer, Table,
                                    TableStyle)

    org_id = user["organization_id"]
    athlete = await db.athletes.find_one({"id": athlete_id, "organization_id": org_id}, {"_id": 0})
    if not athlete:
        raise HTTPException(status_code=404, detail="Player not found.")
    data = await _progress_data(athlete, org_id)
    org = await db.organizations.find_one({"id": org_id}, {"_id": 0})

    st = _report_styles()
    ink = st["ink"]
    h2, body, small, caption = st["h2"], st["body"], st["small"], st["caption"]
    head_style = TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), ink), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 9), ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor(CHART_ROW_ALT)]),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4), ("TOPPADDING", (0, 0), (-1, -1), 4),
    ])

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, topMargin=0.6 * inch, bottomMargin=0.6 * inch)
    story = _report_header(st, org, "Player Progress Report")

    name = f"{athlete.get('first_name')} {athlete.get('last_name')}"
    story.append(Paragraph(
        f"<b>{name}</b> — {athlete.get('age_group') or '—'} · {athlete.get('primary_position') or '—'} · "
        f"{athlete.get('current_team') or 'No team on file'}", body))
    story.append(Paragraph(
        f"{data['evaluation_count']} evaluation(s) across {len(data['timeline'])} scored date(s). "
        f"Generated {data['generated_at'][:10]}.", small))

    # Score trend
    trend_chart = _trend_line_chart(data["timeline"])
    if trend_chart is not None:
        tr = data["score_trend"]
        story.append(Paragraph("Score Trend", h2))
        story.append(Paragraph(
            f"Overall score moved from {tr['first_score']} ({tr['first_date']}) to "
            f"{tr['latest_score']} ({tr['latest_date']}) — {_fmt_delta(tr['delta'])} across "
            f"{tr['checkpoints']} evaluation dates.", caption))
        story.append(trend_chart)
    elif data["current_overall_score"] is not None:
        story.append(Paragraph("Score Trend", h2))
        story.append(Paragraph(
            f"Current overall score {data['current_overall_score']} / 10. A trend needs at least "
            "two scored evaluation dates; only one is on record.", body))
    else:
        story.append(Paragraph("Score Trend", h2))
        story.append(Paragraph("No scored evaluations on record yet.", body))

    # First vs latest category deltas
    if data["category_deltas"]:
        first_pt, latest_pt = data["timeline"][0], data["timeline"][-1]
        story.append(Paragraph("Category Development", h2))
        story.append(Paragraph(
            f"First evaluation ({first_pt['date']}) compared with the latest ({latest_pt['date']}).",
            caption))
        cmp_chart = _comparison_bar_chart(
            [d["category"] for d in data["category_deltas"]],
            [d["previous_score"] for d in data["category_deltas"]],
            [d["current_score"] for d in data["category_deltas"]],
            f"First ({first_pt['label']})", f"Latest ({latest_pt['label']})")
        if cmp_chart is not None:
            story.append(cmp_chart)
        rows = [["Category", "First", "Latest", "Change", "Weight"]]
        for d in data["category_deltas"]:
            rows.append([
                d["category"],
                "—" if d["previous_score"] is None else str(d["previous_score"]),
                "—" if d["current_score"] is None else str(d["current_score"]),
                _fmt_delta(d["delta"]),
                f"{d['weight']}%" if d.get("weight") is not None else "—",
            ])
        t = Table(rows, colWidths=[2.3 * inch, 1.1 * inch, 1.1 * inch, 1.2 * inch, 1.3 * inch])
        t.setStyle(head_style)
        story.append(t)

    # Verified measurements
    story.append(Paragraph("Verified Measurements", h2))
    if data["measurements"]:
        rows = [["Measurement", "First", "Latest", "Change", "Readings"]]
        for m in data["measurements"]:
            unit = f" {m['unit']}" if m.get("unit") else ""
            change = _fmt_delta(m["delta"])
            if m["delta"] is not None and m["improved"] is not None:
                change = f"{change} ({'improved' if m['improved'] else 'no gain'})"
            elif m["delta"] is None:
                change = "single reading"
            rows.append([
                m["label"],
                f"{m['first']['value']}{unit} · {m['first']['measured_at']}",
                f"{m['latest']['value']}{unit} · {m['latest']['measured_at']}",
                change, str(m["reading_count"]),
            ])
        t = Table(rows, colWidths=[1.7 * inch, 1.8 * inch, 1.8 * inch, 1.3 * inch, 0.7 * inch])
        t.setStyle(head_style)
        story.append(t)
    else:
        story.append(Paragraph("No verified measurements on record.", body))

    # Goal progress
    story.append(Paragraph("Goal Progress", h2))
    goals = data["goals"]
    if goals["items"]:
        if goals["average_progress"] is not None:
            story.append(Paragraph(
                f"{goals['total']} active goal(s), average progress {goals['average_progress']}%.",
                caption))
        rows = [["Goal", "Category", "Status", "Progress", "Target date"]]
        for g in goals["items"]:
            rows.append([
                str(g.get("title") or "")[:44], g.get("category") or "—",
                g.get("status") or "—", f"{g.get('progress', 0)}%", g.get("target_date") or "—",
            ])
        t = Table(rows, colWidths=[2.5 * inch, 1.2 * inch, 1.2 * inch, 0.9 * inch, 1.2 * inch])
        t.setStyle(head_style)
        story.append(t)
    else:
        story.append(Paragraph("No active development goals.", body))

    story.append(Spacer(1, 16))
    story.append(Paragraph(DISCLAIMER, small))
    doc.build(story)
    buf.seek(0)
    await log_audit(org_id, user, "player_progress_report_generated", "athlete", athlete_id)
    return Response(content=buf.read(), media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename={name.replace(' ', '_')}_progress.pdf"})


# ---------------- Org-wide insights ----------------
#
# One evaluations query feeds every per-athlete change below; the timeline math
# is the same `_score_timeline` the progress report uses, so "change" here is
# always latest-checkpoint overall minus previous-checkpoint overall.

# |change| below this reads as noise, not development. Same 0-10 scale as the
# overall score.
TREND_FLAT_THRESHOLD = 0.1


async def _org_score_changes(org_id: str) -> list[dict]:
    """Per-athlete latest-vs-previous overall change, org-wide, from one query.

    Only athletes with >= 2 scored checkpoints appear; a single-checkpoint
    athlete has no change to report and is excluded, never zero-filled.
    """
    evals = await db.evaluations.find(
        {"organization_id": org_id, "status": {"$in": ["submitted", "approved"]}},
        {"_id": 0}).to_list(5000)
    by_athlete = defaultdict(list)
    for ev in evals:
        by_athlete[ev["athlete_id"]].append(ev)
    changes = []
    for aid, evs in by_athlete.items():
        timeline = _score_timeline(evs)
        if len(timeline) < 2:
            continue
        changes.append({
            "athlete_id": aid,
            "change": round(timeline[-1]["overall_score"] - timeline[-2]["overall_score"], 2),
            "current_score": timeline[-1]["overall_score"],
        })
    return changes


def _development_trend(changes: list[dict]) -> dict:
    return {
        "improving": sum(1 for c in changes if c["change"] >= TREND_FLAT_THRESHOLD),
        "declining": sum(1 for c in changes if c["change"] <= -TREND_FLAT_THRESHOLD),
        "flat": sum(1 for c in changes if abs(c["change"]) < TREND_FLAT_THRESHOLD),
    }


async def _expected_evaluation_count(org_id: str) -> int | None:
    """Expected evaluation count from the live / most recent open event.

    Sums, per station, the checked-in athletes that station applies to — the
    same applicability rule the evaluator dashboard uses. Null when there is no
    open event, it has no stations, or nobody has checked in: no expectation is
    ever invented.
    """
    event = await db.events.find_one(
        {"organization_id": org_id, "status": {"$nin": ["Closed"]}},
        {"_id": 0, "id": 1}, sort=[("date", -1)])
    if not event:
        return None
    stations = await db.stations.find(
        {"event_id": event["id"], "organization_id": org_id},
        {"_id": 0, "group_ids": 1}).to_list(50)
    if not stations:
        return None
    total = 0
    for s in stations:
        q = {"event_id": event["id"], "status": "checked_in"}
        gids = s.get("group_ids") or []
        if gids:
            q["group_id"] = {"$in": gids}
        total += await db.event_athletes.count_documents(q)
    return total or None


@router.get("/reports/insights")
async def insights(user=Depends(require_roles(*REVIEW_ROLES, "coach"))):
    org_id = user["organization_id"]

    changes = await _org_score_changes(org_id)
    changes.sort(key=lambda c: c["change"], reverse=True)
    top_movers = []
    for c in changes:
        if len(top_movers) >= 5:
            break
        athlete = await db.athletes.find_one(
            {"id": c["athlete_id"], "organization_id": org_id},
            {"_id": 0, "id": 1, "first_name": 1, "last_name": 1, "photo_url": 1,
             "primary_position": 1, "graduation_year": 1})
        if not athlete:
            continue
        top_movers.append({"athlete": athlete, "change": c["change"],
                           "current_score": c["current_score"]})

    completed = await db.evaluations.count_documents(
        {"organization_id": org_id, "status": {"$in": ["submitted", "approved"]}})
    needs_review = await db.evaluations.count_documents(
        {"organization_id": org_id, "status": "submitted"})
    flagged = await db.athletes.count_documents(
        {"organization_id": org_id, "flagged_follow_up": True, "status": "active"})

    # Same grouping the position comparison uses, one leaderboard pass.
    base = await _leaderboard_data(org_id, limit=2000)
    by_pos = defaultdict(list)
    for r in base:
        pos = (r["athlete"].get("primary_position") or "").strip()
        if pos:
            by_pos[pos].append(r["overall_score"])
    position_snapshot = []
    for pos, scores in by_pos.items():
        vals = [s for s in scores if s is not None]
        position_snapshot.append({
            "position": pos, "count": len(scores),
            "avg_score": round(statistics.fmean(vals), 2) if vals else None,
        })
    position_snapshot.sort(key=lambda p: (-p["count"], p["position"]))

    return {
        "top_movers": top_movers,
        "evaluations": {"completed": completed,
                        "expected": await _expected_evaluation_count(org_id)},
        "needs_review": needs_review,
        "flagged": flagged,
        "position_snapshot": position_snapshot,
        "development_trend": _development_trend(changes),
    }


# ---------------- Organization summary ----------------

@router.get("/organizations/summary")
async def organization_summary(user=Depends(require_roles(*ADMIN_ROLES))):
    org_id = user["organization_id"]
    org = await db.organizations.find_one({"id": org_id}, {"_id": 0}) or {}

    athletes = await db.athletes.count_documents({"organization_id": org_id, "status": "active"})
    team_names = await db.athletes.distinct(
        "current_team", {"organization_id": org_id, "status": "active"})
    teams = len({str(t).strip() for t in team_names if t and str(t).strip()})

    coaches = await db.memberships.count_documents(
        {"organization_id": org_id, "role": "coach", "active": True})
    evaluators = await db.memberships.count_documents(
        {"organization_id": org_id, "role": "evaluator", "active": True})

    total_evals = await db.evaluations.count_documents({"organization_id": org_id})
    awaiting = await db.evaluations.count_documents(
        {"organization_id": org_id, "status": "submitted"})

    today = now_iso()[:10]
    upcoming = await db.events.count_documents(
        {"organization_id": org_id, "date": {"$gte": today}, "status": {"$nin": ["Closed"]}})
    total_events = await db.events.count_documents({"organization_id": org_id})

    return {
        "organization": {"id": org.get("id"), "name": org.get("name"),
                         "logo_url": org.get("logo_url")},
        "athletes": athletes,
        "teams": teams,
        "grad_classes": await _grad_year_counts(org_id),
        "coaches": coaches,
        "evaluators": evaluators,
        "evaluations": {"total": total_evals, "awaiting_review": awaiting},
        "events": {"upcoming": upcoming, "total": total_events},
        "development_trend": _development_trend(await _org_score_changes(org_id)),
    }
