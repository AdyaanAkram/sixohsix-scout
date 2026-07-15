"""Weighted scoring engine for PBG Scout.

Rules:
- Subjective ratings normalize to a 0-10 scale directly.
- Measurements (time / velocity / numeric) ONLY normalize when a benchmark exists
  for the metric + age group. Otherwise the raw value is preserved and excluded
  from weighted category scores (never invent a normalized score).
- Timed metrics: lower is better. Velocities/distances: higher is better
  (direction always comes from metric/benchmark definition).
- Preserve raw, normalized, weighted, category, and overall scores.
"""


def normalize_rating(metric, raw):
    try:
        raw = float(raw)
    except (TypeError, ValueError):
        return None
    mtype = metric.get("metric_type")
    if mtype == "rating_5":
        return max(0.0, min(10.0, raw / 5.0 * 10.0))
    if mtype == "rating_10":
        return max(0.0, min(10.0, raw))
    if mtype == "yes_no":
        return 10.0 if raw else 0.0
    return None


def normalize_with_benchmark(benchmark, raw):
    """Two-point benchmark: floor_value (0th pct) -> elite_value (100th pct)."""
    try:
        raw = float(raw)
    except (TypeError, ValueError):
        return None, None
    floor_v = benchmark.get("floor_value")
    elite_v = benchmark.get("elite_value")
    if floor_v is None or elite_v is None or floor_v == elite_v:
        return None, None
    frac = (raw - floor_v) / (elite_v - floor_v)
    frac = max(0.0, min(1.0, frac))
    normalized = round(frac * 10.0, 2)
    percentile = round(frac * 100.0)
    return normalized, percentile


def find_benchmark(benchmarks, metric_key, age_group, position=None):
    best = None
    for b in benchmarks:
        if b.get("metric_key") != metric_key:
            continue
        if b.get("age_group") and b.get("age_group") != age_group:
            continue
        if b.get("position") and position and b.get("position") != position:
            continue
        # prefer more specific benchmark (with position)
        if best is None or (b.get("position") and not best.get("position")):
            best = b
    return best


def compute_evaluation_scores(template, scores, benchmarks, age_group=None, position=None):
    """scores: {metric_id: {value, not_observed, attempt_2, best}}
    Returns dict with metric_results, category_scores, overall_score.
    """
    metrics = template.get("metrics", [])
    categories = {c["name"]: c for c in template.get("categories", [])}
    metric_results = {}
    cat_acc = {}

    for m in metrics:
        mid = m["id"]
        entry = scores.get(mid) or {}
        raw = entry.get("value")
        not_observed = bool(entry.get("not_observed"))
        mtype = m.get("metric_type")

        if mtype in ("comment", "observation", "multiple_choice"):
            if raw not in (None, ""):
                metric_results[mid] = {"raw": raw, "normalized": None, "weighted": None, "percentile": None}
            continue

        if not_observed or raw in (None, ""):
            if not_observed:
                metric_results[mid] = {"raw": None, "normalized": None, "weighted": None, "not_observed": True, "percentile": None}
            continue

        normalized = None
        percentile = None
        if mtype in ("rating_5", "rating_10", "yes_no"):
            normalized = normalize_rating(m, raw)
        elif mtype in ("numeric", "time", "velocity"):
            # use best of attempts when available
            candidates = [v for v in [raw, entry.get("attempt_2")] if v not in (None, "")]
            vals = []
            for c in candidates:
                try:
                    vals.append(float(c))
                except (TypeError, ValueError):
                    pass
            if vals:
                higher_better = m.get("higher_is_better", mtype != "time")
                best_val = max(vals) if higher_better else min(vals)
            else:
                best_val = None
            bench = find_benchmark(benchmarks, m.get("key") or m["id"], age_group, position)
            if bench is not None and best_val is not None:
                normalized, percentile = normalize_with_benchmark(bench, best_val)
            raw = best_val if best_val is not None else raw

        weight = float(m.get("weight", 1) or 1)
        weighted = round(normalized * weight, 3) if normalized is not None else None
        metric_results[mid] = {
            "raw": raw,
            "normalized": normalized,
            "weighted": weighted,
            "percentile": percentile,
        }

        if normalized is not None:
            cat_name = m.get("category", "General")
            acc = cat_acc.setdefault(cat_name, {"sum": 0.0, "wsum": 0.0})
            acc["sum"] += normalized * weight
            acc["wsum"] += weight

    category_scores = {}
    overall_sum = 0.0
    overall_wsum = 0.0
    for cat_name, acc in cat_acc.items():
        if acc["wsum"] <= 0:
            continue
        score = round(acc["sum"] / acc["wsum"], 2)
        cat_weight = float(categories.get(cat_name, {}).get("weight", 1) or 1)
        category_scores[cat_name] = {"score": score, "weight": cat_weight}
        overall_sum += score * cat_weight
        overall_wsum += cat_weight

    overall = round(overall_sum / overall_wsum, 2) if overall_wsum > 0 else None
    return {
        "metric_results": metric_results,
        "category_scores": category_scores,
        "overall_score": overall,
    }


MASTER_CATEGORY_WEIGHTS = {
    "Hitting": 25,
    "Defense": 25,
    "Athleticism": 20,
    "Arm Strength": 15,
    "Baseball IQ": 10,
    "Coachability": 5,
}


def aggregate_player_scores(evaluations):
    """Aggregate category scores across multiple evaluations into a player-level
    overall score using master category weights."""
    cat_acc = {}
    for ev in evaluations:
        computed = ev.get("computed") or {}
        for cat, data in (computed.get("category_scores") or {}).items():
            acc = cat_acc.setdefault(cat, {"sum": 0.0, "n": 0})
            acc["sum"] += data["score"]
            acc["n"] += 1
    category_scores = {}
    total = 0.0
    wsum = 0.0
    for cat, acc in cat_acc.items():
        if acc["n"] == 0:
            continue
        avg = round(acc["sum"] / acc["n"], 2)
        w = MASTER_CATEGORY_WEIGHTS.get(cat, 5)
        category_scores[cat] = {"score": avg, "weight": w}
        total += avg * w
        wsum += w
    overall = round(total / wsum, 2) if wsum > 0 else None
    return {"category_scores": category_scores, "overall_score": overall}
