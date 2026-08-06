"""Weighted scoring engine for PBG Scout.

Rules:
- Subjective ratings normalize to a 0-10 scale directly.
- Measurements (time / velocity / numeric) ONLY normalize when a benchmark exists
  for the metric + age group. Otherwise the raw value is preserved and excluded
  from weighted category scores (never invent a normalized score).
- Timed metrics: lower is better. Velocities/distances: higher is better
  (direction always comes from metric/benchmark definition).
- Preserve raw, normalized, weighted, category, and overall scores.
- Metric keys are namespaced canonically (see CANONICAL_METRIC_CATALOG). Legacy
  keys stored in older documents are aliased on read so historical data keeps
  matching benchmarks instead of silently scoring as "no benchmark".
"""

from positions import POSITION_TO_GROUP

# ---------------------------------------------------------------------------
# Canonical metric keys (spec §4D)
# ---------------------------------------------------------------------------

CANONICAL_METRIC_CATALOG = {
    "sixty_yard_dash": {"label": "60-Yard Dash", "unit": "sec", "lower_better": True},
    "home_to_first": {"label": "Home to First", "unit": "sec", "lower_better": True},
    "exit_velocity": {"label": "Exit Velocity", "unit": "mph", "lower_better": False},
    "throwing_velocity": {"label": "Throwing Velocity", "unit": "mph", "lower_better": False},
    "pitching_velocity": {"label": "Pitch Velocity", "unit": "mph", "lower_better": False},
    "pop_time": {"label": "Pop Time", "unit": "sec", "lower_better": True},
    "bat_speed": {"label": "Bat Speed", "unit": "mph", "lower_better": False},
    "broad_jump": {"label": "Broad Jump", "unit": "in", "lower_better": False},
    "vertical_jump": {"label": "Vertical Jump", "unit": "in", "lower_better": False},
}

# Keys that predate the canonical namespace and have no canonical equivalent.
# They stay writable/readable (never silently dropped) but are flagged legacy.
LEGACY_METRIC_CATALOG = {
    "ten_yd": {"label": "10-Yard Split", "unit": "sec", "lower_better": True},
}

# old/alternate spelling -> canonical key. `ten_yd` maps to itself on purpose.
METRIC_KEY_ALIASES = {
    # legacy METRIC_CATALOG keys (routes_metrics.py, pre-spec-§4D)
    "exit_velo": "exit_velocity",
    "pitch_velo": "pitching_velocity",
    "pitch_velocity": "pitching_velocity",
    "pitching_velo": "pitching_velocity",
    "throwing_velo": "throwing_velocity",
    "throw_velo": "throwing_velocity",
    "sixty_yd": "sixty_yard_dash",
    "sixty_yard": "sixty_yard_dash",
    "60_yd": "sixty_yard_dash",
    "60yd": "sixty_yard_dash",
    "60_yard_dash": "sixty_yard_dash",
    "ten_yd": "ten_yd",
    "ten_yard": "ten_yd",
    "ten_yd_split": "ten_yd",
    "10_yd": "ten_yd",
    "10yd": "ten_yd",
    # other spellings seen in evaluation templates / imports
    "home_to_1st": "home_to_first",
    "h2f": "home_to_first",
    "vert_jump": "vertical_jump",
    "vertical_leap": "vertical_jump",
    "broad_jmp": "broad_jump",
    "batspeed": "bat_speed",
    "poptime": "pop_time",
}

# canonical key -> every stored spelling that resolves to it (for Mongo $in reads)
_EQUIVALENT_KEYS: dict[str, list[str]] = {}
for _k in list(CANONICAL_METRIC_CATALOG) + list(LEGACY_METRIC_CATALOG):
    _EQUIVALENT_KEYS.setdefault(_k, [_k])
for _alias, _canon in METRIC_KEY_ALIASES.items():
    bucket = _EQUIVALENT_KEYS.setdefault(_canon, [_canon])
    if _alias not in bucket:
        bucket.append(_alias)


def canonical_metric_key(key):
    """Normalise any stored/incoming metric key to its canonical spelling.

    Permissive by design: an unrecognised key is returned normalised (never
    dropped) so unknown historical rows still round-trip. Use `metric_meta` to
    decide whether a key is actually a supported one.
    """
    if not key:
        return None
    k = str(key).strip().lower().replace("-", "_").replace(" ", "_")
    return METRIC_KEY_ALIASES.get(k, k)


def metric_meta(key):
    """Return {key,label,unit,lower_better,legacy} for a supported key, else None."""
    ck = canonical_metric_key(key)
    if ck in CANONICAL_METRIC_CATALOG:
        return {"key": ck, "legacy": False, **CANONICAL_METRIC_CATALOG[ck]}
    if ck in LEGACY_METRIC_CATALOG:
        return {"key": ck, "legacy": True, **LEGACY_METRIC_CATALOG[ck]}
    return None


def equivalent_metric_keys(key):
    """All stored spellings that resolve to the same canonical metric.

    Used to query `verified_metrics` so rows written under the old namespace
    (exit_velo, sixty_yd, …) are found alongside newly written canonical rows.
    """
    ck = canonical_metric_key(key)
    if ck is None:
        return []
    return list(_EQUIVALENT_KEYS.get(ck, [ck]))


def supported_metric_keys():
    return list(CANONICAL_METRIC_CATALOG) + list(LEGACY_METRIC_CATALOG)


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


def _age_range(token):
    """Parse an age-band token into an inclusive (lo, hi) numeric range.

    Handles "14U", "13U-14U", "8U-10U", "College", "Pro"/"Professional".
    Returns None when the token is not parseable.
    """
    if not token:
        return None
    t = str(token).strip().upper().replace("–", "-").replace(" ", "")
    if t in ("COLLEGE", "NCAA"):
        return (19, 22)
    if t in ("PRO", "PROFESSIONAL"):
        return (23, 99)
    if "-" in t:
        parts = t.split("-", 1)
        lo = _age_range(parts[0])
        hi = _age_range(parts[1])
        if lo and hi:
            return (min(lo[0], hi[0]), max(lo[1], hi[1]))
        return None
    if t.endswith("U"):
        t = t[:-1]
    if t.isdigit():
        n = int(t)
        return (n, n)
    return None


def _age_rank(athlete_age_group, benchmark_age_group):
    """Match rank for a benchmark's age band against an athlete's.

    Returns None for "does not apply", otherwise higher = more specific:
      2 = exact band match, 1 = overlapping band, 0 = benchmark applies to all ages.
    Permissive on read so legacy bands ("12U", "8U-10U") and the new bands
    ("11U-12U", "College", "Professional") both resolve.
    """
    if not benchmark_age_group:
        return 0
    if not athlete_age_group:
        return None
    ba = str(benchmark_age_group).strip().upper().replace("–", "-")
    aa = str(athlete_age_group).strip().upper().replace("–", "-")
    if ba == aa:
        return 2
    br, ar = _age_range(ba), _age_range(aa)
    if br and ar and br[0] <= ar[1] and ar[0] <= br[1]:
        return 1
    return None


def _position_rank(athlete_position, benchmark_position):
    """None = does not apply; 2 = exact, 1 = position group, 0 = any position."""
    if not benchmark_position:
        return 0
    if not athlete_position:
        # A position-specific benchmark must never be claimed for an athlete
        # whose position we do not know.
        return None
    bp = str(benchmark_position).strip().upper()
    ap = str(athlete_position).strip().upper()
    if bp == ap:
        return 2
    if POSITION_TO_GROUP.get(ap) == bp or POSITION_TO_GROUP.get(bp) == ap:
        return 1
    return None


def _band_width(token):
    r = _age_range(token)
    return (r[1] - r[0]) if r else 99


def find_benchmark(benchmarks, metric_key, age_group, position=None):
    """Most specific benchmark for a metric + athlete age band / position.

    Preference: position-specific > age-only, then exact age band > overlapping
    band > any-age, then the narrower band. Metric keys are compared
    canonically, so a benchmark seeded as `exit_velocity` matches a legacy
    `exit_velo` record. Returns None when nothing is defined — callers must
    never substitute a fabricated benchmark.
    """
    wanted = canonical_metric_key(metric_key)
    best = None
    best_rank = None
    for b in benchmarks:
        if canonical_metric_key(b.get("metric_key")) != wanted:
            continue
        pos_rank = _position_rank(position, b.get("position"))
        if pos_rank is None:
            continue
        age_rank = _age_rank(age_group, b.get("age_group"))
        if age_rank is None:
            continue
        rank = (pos_rank, age_rank, -_band_width(b.get("age_group")))
        if best_rank is None or rank > best_rank:
            best, best_rank = b, rank
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
