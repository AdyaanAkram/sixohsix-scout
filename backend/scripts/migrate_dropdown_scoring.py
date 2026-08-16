"""Convert observational rating metrics to the dropdown scoring system.

For one org's evaluation_templates, every rating_5 / rating_10 metric in a
position-skill category is replaced in place with the closest OUTCOME_LIBRARY
dropdown rep (metric id preserved — historical linkage intact): evaluators then
pick baseball outcomes instead of 1-5 numbers, and the backend converts the
selection via `option_scores`. Objective metrics (numeric/time/velocity) and
yes_no/comment/observation/multiple_choice metrics are never touched. Metrics
with no confident library match are left untouched and reported.

Dry-run by default — prints the full before -> after table and writes nothing.

Run:
  cd backend && .venv/bin/python scripts/migrate_dropdown_scoring.py \
      --mongo-url "$MONGO_URL" --db pbg_scout --org org-pbg-midwest          # dry run
  ... add --yes to write.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys

from motor.motor_asyncio import AsyncIOMotorClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scoring import OUTCOME_LIBRARY  # noqa: E402

# Only observational ratings convert; objective entry stays numeric per spec.
CONVERTIBLE_TYPES = {"rating_5", "rating_10"}
# Position-skill categories. Makeup ("Coachability") never converts.
SKILL_CATEGORIES = {"Defense", "Arm Strength", "Hitting", "Athleticism", "Baseball IQ"}

# Template-context group inference: a rep from the template's own position group
# outranks any cross-group keyword hit (e.g. "Arm Accuracy and Carry" belongs to
# GB — Throw Accuracy on an infield form but Crow-Hop & Throw Carry on an
# outfield form).
_GROUP_HINTS = [
    ("pitching", "Pitching"), ("catching", "Catching"), ("infield", "Infield"),
    ("outfield", "Outfield"), ("hitting", "Hitting"), ("base running", "Athletic"),
    ("baserunning", "Athletic"), ("athletic", "Athletic"),
]
_POSITION_GROUPS = {
    "P": "Pitching", "C": "Catching",
    "IF": "Infield", "1B": "Infield", "2B": "Infield", "3B": "Infield", "SS": "Infield",
    "OF": "Outfield", "LF": "Outfield", "CF": "Outfield", "RF": "Outfield",
    "DH": "Hitting",
}
_GROUP_BONUS = 100  # dominates any keyword-length score


def template_group(template: dict) -> str | None:
    name = (template.get("name") or "").lower()
    for hint, group in _GROUP_HINTS:
        if hint in name:
            return group
    for pos in template.get("applies_to_positions") or []:
        g = _POSITION_GROUPS.get(str(pos).upper())
        if g:
            return g
    return None


def match_rep(metric: dict, group: str | None) -> str | None:
    """Closest OUTCOME_LIBRARY rep for a rating metric, or None.

    Fuzzy keyword match on the metric name (category/template only steer the
    group bonus). Longer keyword hits score higher; a same-group rep beats any
    cross-group one. No keyword hit at all -> no match, metric stays untouched.
    """
    name = (metric.get("name") or "").lower().replace("–", "-").replace("—", "-")
    best, best_score = None, 0
    for rep, lib in OUTCOME_LIBRARY.items():
        score = sum(len(kw) for kw in lib["keywords"] if kw in name)
        if score <= 0:
            continue
        if group and lib["group"] == group:
            score += _GROUP_BONUS
        if score > best_score:
            best, best_score = rep, score
    return best


def convert_metric(metric: dict, rep: str) -> dict:
    """Dropdown version of a rating metric: same id/key/category/weight/required/
    display_order, new name + multiple_choice options with option_scores."""
    lib = OUTCOME_LIBRARY[rep]
    out = dict(metric)
    out["name"] = rep
    out["metric_type"] = "multiple_choice"
    out["options"] = list(lib["options"])
    out["option_scores"] = dict(lib["scores"])
    out["unit"] = None
    out.pop("scale_legend", None)  # 1-5 legend no longer applies
    return out


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--mongo-url", default=os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    ap.add_argument("--db", default=os.environ.get("DB_NAME", "pbg_scout"))
    ap.add_argument("--org", required=True, help="organization_id whose templates to migrate")
    ap.add_argument("--dry-run", action="store_true", default=True,
                    help="print the plan without writing (the default)")
    ap.add_argument("--yes", action="store_true", help="actually write the converted templates")
    args = ap.parse_args()
    apply = args.yes

    db = AsyncIOMotorClient(args.mongo_url, serverSelectionTimeoutMS=15000)[args.db]
    templates = await db.evaluation_templates.find(
        {"organization_id": args.org}, {"_id": 0}).to_list(1000)
    if not templates:
        print(f"No evaluation_templates found for org {args.org!r}.")
        return 1

    rows, unmatched, changed_templates = [], [], 0
    for t in sorted(templates, key=lambda x: x.get("name") or ""):
        group = template_group(t)
        metrics = t.get("metrics") or []
        new_metrics, changed = [], False
        for m in metrics:
            mtype = m.get("metric_type")
            if mtype not in CONVERTIBLE_TYPES or m.get("category") not in SKILL_CATEGORIES:
                new_metrics.append(m)
                continue
            rep = match_rep(m, group)
            if rep is None:
                unmatched.append((t.get("name"), m.get("name"), mtype, m.get("category")))
                new_metrics.append(m)
                continue
            new_metrics.append(convert_metric(m, rep))
            changed = True
            rows.append((t.get("name"), m.get("name"), mtype, rep))
        if changed:
            changed_templates += 1
            if apply:
                await db.evaluation_templates.update_one(
                    {"id": t["id"], "organization_id": args.org},
                    {"$set": {"metrics": new_metrics}})

    def table(title, header, data):
        if not data:
            return
        widths = [max(len(str(r[i])) for r in [header] + data) for i in range(len(header))]
        print(f"\n{title}")
        print("  " + " | ".join(h.ljust(w) for h, w in zip(header, widths)))
        print("  " + "-+-".join("-" * w for w in widths))
        for r in data:
            print("  " + " | ".join(str(c).ljust(w) for c, w in zip(r, widths)))

    table("CONVERTED (rating -> dropdown outcomes, metric id preserved):",
          ("template", "metric (before)", "type", "-> library rep (multiple_choice)"), rows)
    table("UNMATCHED — left untouched, review by hand:",
          ("template", "metric", "type", "category"), sorted(set(unmatched)))

    print(f"\nTemplates: {len(templates)} scanned, {changed_templates} with conversions; "
          f"{len(rows)} metrics converted, {len(set(unmatched))} unmatched.")
    if apply:
        print("Changes WRITTEN.")
    else:
        print("DRY RUN — nothing written. Re-run with --yes to apply.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
