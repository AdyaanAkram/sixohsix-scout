"""Add the 8-12 developmental 1-5 legend to young-band rating metrics.

Additive and re-runnable: only $sets `scale_legend` on rating_5 metrics of
templates in the young bands (or bandless station templates); never removes
or rewrites anything else. Run: .venv/bin/python scripts/add_dev_scale_labels.py
"""
import asyncio
import os
import sys

_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _BACKEND)

from db import db  # noqa: E402

YOUNG = {"7U-8U", "9U-10U", "11U-12U", None}
LEGEND = ("1 Beginning · 2 Developing · 3 Age-Appropriate · "
          "4 Above Age-Level · 5 Advanced")


async def main():
    updated = 0
    async for t in db.evaluation_templates.find({}, {"_id": 0, "id": 1, "age_group": 1, "metrics": 1}):
        if t.get("age_group") not in YOUNG:
            continue
        changed = False
        metrics = t.get("metrics") or []
        for m in metrics:
            if m.get("metric_type") == "rating_5" and m.get("scale_legend") != LEGEND:
                m["scale_legend"] = LEGEND
                changed = True
        if changed:
            await db.evaluation_templates.update_one({"id": t["id"]}, {"$set": {"metrics": metrics}})
            updated += 1
    print(f"templates updated: {updated}")

asyncio.run(main())
