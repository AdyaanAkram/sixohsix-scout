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
    # Client-confirmed independent metric (Revision 5 §2): a base-running time
    # around the turn — explicitly NOT an alias of the straight-line 60-yard dash.
    "home_to_second": {"label": "Home to Second", "unit": "sec", "lower_better": True},
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
    "home_to_2nd": "home_to_second",
    "h2s": "home_to_second",
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


# ---------------------------------------------------------------------------
# Dropdown outcome scoring (client revision: dropdown scoring system)
#
# Evaluators never see numbers. Template metrics of metric_type
# "multiple_choice" may carry an optional parallel `option_scores` map
# {label -> developmental score, 12/10/9/8}. The evaluator taps a
# baseball-specific outcome label; the backend silently converts the selection
# to its mapped score for analytics/AI while the stored raw value stays the
# label string so review UIs keep showing words.
#
# OUTCOME_LIBRARY is the single source for these option sets — seed.py builds
# new templates from it and scripts/migrate_dropdown_scoring.py converts
# existing rating metrics to it. `group` and `keywords` exist for the
# migration's fuzzy matching; the app itself only reads options/scores.
# ---------------------------------------------------------------------------

def _outcomes(group, keywords, *labeled_scores):
    return {
        "group": group,
        "keywords": keywords,
        "options": [label for label, _ in labeled_scores],
        "scores": {label: score for label, score in labeled_scores},
    }


OUTCOME_LIBRARY = {
    # ---- Infield ----
    "Routine Ground Ball — Hands": _outcomes(
        "Infield", ["hands", "glove", "infield action", "ground-ball fundamentals",
                    "ground ball fundamentals", "fielding"],
        ("Clean, out front, works through ball", 12),
        ("Secures ball, occasional double-clutch", 10),
        ("Fights the ball / rigid hands", 9),
        ("Ball plays him — needs fundamental work", 8)),
    "Routine Ground Ball — Footwork": _outcomes(
        "Infield", ["infield footwork", "footwork"],
        ("Right-left through the ball, on time every rep", 12),
        ("Good fielding position, feet occasionally late", 10),
        ("Flat-footed — fields it standing still", 9),
        ("Feet never set — no rhythm into the throw", 8)),
    "Routine Ground Ball — Exchange & Transfer": _outcomes(
        "Infield", ["exchange", "transfer"],
        ("Quick, clean glove-to-hand, no wasted motion", 12),
        ("Reliable exchange, a beat slow under pressure", 10),
        ("Digs the ball out of the glove", 9),
        ("Loses the ball on the transfer", 8)),
    "Routine Ground Ball — Throw Accuracy": _outcomes(
        "Infield", ["throwing accuracy", "arm accuracy", "accuracy"],
        ("On the bag chest-high, every time", 12),
        ("Mostly accurate, occasional short-hop or tail", 10),
        ("Scattered — makes the first baseman work", 9),
        ("Throws pull him off the play — rebuild mechanics", 8)),
    "Forehand": _outcomes(
        "Infield", ["forehand"],
        ("Attacks the forehand, fields on the move, strong throw", 12),
        ("Fields it clean, has to gather before the throw", 10),
        ("Waits on the ball — range a step short", 9),
        ("Circles around it instead of taking the forehand", 8)),
    "Backhand": _outcomes(
        "Infield", ["backhand"],
        ("Sets feet early, clean backhand, strong throw", 12),
        ("Fields it, throw takes him time", 10),
        ("Reaches late, inconsistent glove position", 9),
        ("Avoids the backhand — takes it on the forehand side", 8)),
    "Slow Roller": _outcomes(
        "Infield", ["slow roller"],
        ("Charges hard, clean pick, throws on the run", 12),
        ("Comes to get it, needs an extra gather step", 10),
        ("Hesitates on the charge, lets the ball come to him", 9),
        ("Stays back and waits — play is over before the throw", 8)),
    # ---- Outfield ----
    "Fly Ball — Routes & Reads": _outcomes(
        "Outfield", ["route", "fly-ball", "fly ball", "reads"],
        ("First step back, direct route, catches at full speed", 12),
        ("Good read, minor banana route", 10),
        ("Late read — drifts instead of driving to the spot", 9),
        ("Misjudges the flight — ball over his head", 8)),
    "Ground Ball Through the Outfield": _outcomes(
        "Outfield", ["ground ball through", "through the outfield", "do-or-die"],
        ("Attacks under control, fields off glove-side foot, in rhythm to throw", 12),
        ("Fields it clean, momentum stalls before the throw", 10),
        ("Rounds it cautiously — gives up the extra base", 9),
        ("Blocks it flat-footed like an infielder — no attack", 8)),
    "Crow-Hop & Throw Carry": _outcomes(
        "Outfield", ["crow", "arm accuracy and carry", "carry"],
        ("True crow-hop, throw carries on a line to the base", 12),
        ("Solid mechanics, throw loses steam late", 10),
        ("Rushed footwork, throw tails or bounces early", 9),
        ("No crow-hop — arms it flat-footed", 8)),
    # ---- Catching ----
    "Receiving": _outcomes(
        "Catching", ["receiving", "framing"],
        ("Quiet glove, beats the ball to the spot, sticks strikes", 12),
        ("Catches it clean, glove drifts out of the zone", 10),
        ("Stabs at the ball — loses strikes", 9),
        ("Ball controls the glove — fundamental receiving work needed", 8)),
    "Blocking": _outcomes(
        "Catching", ["blocking"],
        ("Beats the ball down, chest square, keeps it in front", 12),
        ("Gets down in time, ball kicks a step away", 10),
        ("Drops late — picks at it instead of blocking", 9),
        ("Turns away from the block — ball to the backstop", 8)),
    "Exchange & Footwork on Throws": _outcomes(
        "Catching", ["transfer and exchange", "stance and footwork", "exchange", "footwork"],
        ("Clean transfer, quick feet, throw on line to the bag", 12),
        ("Good exchange, footwork adds a beat", 10),
        ("Slow out of the crouch, throw drags offline", 9),
        ("Fights the transfer — no rhythm from catch to release", 8)),
    # ---- Hitting ----
    "Swing Mechanics": _outcomes(
        "Hitting", ["swing", "hitting fundamentals"],
        ("Balanced and connected — swing works from the ground up", 12),
        ("Sound swing, occasional drift or early hips", 10),
        ("All arms — lower half not involved", 9),
        ("Long, disconnected swing — rebuild from setup", 8)),
    "Contact Quality": _outcomes(
        "Hitting", ["contact"],
        ("Barrels it consistently — line drives gap to gap", 12),
        ("Regular hard contact, some mishits off the end", 10),
        ("More soft contact than square", 9),
        ("Rarely squares it up — swing-and-miss in the zone", 8)),
    "Approach & Timing": _outcomes(
        "Hitting", ["approach", "timing", "confidence in the box"],
        ("On time every pitch, adjusts to speed changes", 12),
        ("Good rhythm, beatable with off-speed", 10),
        ("Starts late — timing rescues the swing", 9),
        ("No load or rhythm — guessing at every pitch", 8)),
    "Bat Path": _outcomes(
        "Hitting", ["bat path", "path"],
        ("Short to it, long through it — matches the pitch plane", 12),
        ("Solid path, occasionally cuts the finish short", 10),
        ("In and out of the zone — one point of contact", 9),
        ("Chops or uppercuts — path fights the pitch", 8)),
    # ---- Pitching ----
    "Delivery — Balance & Repeatability": _outcomes(
        "Pitching", ["balance on the mound", "repeatability", "delivery", "mechanical"],
        ("Balanced over the rubber — repeats it pitch after pitch", 12),
        ("Good tempo, occasionally drifts or rushes", 10),
        ("Falls off line — release point wanders", 9),
        ("Off balance throughout — delivery needs a rebuild", 8)),
    "Arm Action": _outcomes(
        "Pitching", ["arm action"],
        ("Loose, clean circle, on time at foot strike", 12),
        ("Works fine, slight wrap or stab", 10),
        ("Late arm — pushes to catch up", 9),
        ("Short-arms or slings it — mechanical red flag", 8)),
    "Fastball Command": _outcomes(
        "Pitching", ["fastball command", "strike-throwing", "strike throwing", "command"],
        ("Hits the glove to both sides of the plate", 12),
        ("Fills the zone, misses within it", 10),
        ("Around the zone, can't locate on purpose", 9),
        ("Fights to throw strikes at all", 8)),
    "Off-Speed Feel": _outcomes(
        "Pitching", ["breaking ball", "changeup", "off-speed", "offspeed"],
        ("Lands it for strikes and buries it when ahead", 12),
        ("Real shape, command comes and goes", 10),
        ("Slows the arm — hitters see it early", 9),
        ("No usable off-speed pitch yet", 8)),
    # ---- Athleticism / base running ----
    "First-Step Quickness": _outcomes(
        "Athletic", ["first-step", "first step", "lateral movement", "quickness"],
        ("Explosive first step — wins the race to the ball", 12),
        ("Good reaction, builds to speed quickly", 10),
        ("Reads it, but the first step is a beat slow", 9),
        ("Standing start every time — no burst", 8)),
    "Running Form": _outcomes(
        "Athletic", ["running mechanics", "running form", "run form"],
        ("Tall and relaxed, arms drive straight, no wasted motion", 12),
        ("Solid mechanics, minor crossover or heel strike", 10),
        ("Upright and choppy — leaks speed", 9),
        ("Fights himself down the line — form work needed", 8)),
    "Turns & Reads on the Bases": _outcomes(
        "Athletic", ["turns"],
        ("Aggressive turns, cuts the bag tight, picks up coaches early", 12),
        ("Good turns, occasionally rounds wide", 10),
        ("Slows into the bag, late reads on the ball", 9),
        ("Runs base to base — no anticipation", 8)),
}


def option_score(metric, raw):
    """Developmental score mapped to a multiple_choice selection, else None.

    Returns the numeric score from the metric's `option_scores` {label -> score}
    when the raw value is a label present in the map. Legacy multiple_choice
    metrics (no `option_scores`) and unmatched labels return None so they keep
    the historical unscored behavior.
    """
    if raw in (None, ""):
        return None
    option_scores = metric.get("option_scores")
    if not isinstance(option_scores, dict) or not option_scores:
        return None
    val = option_scores.get(raw if isinstance(raw, str) else str(raw))
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


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

        has_outcome_scores = bool(m.get("option_scores")) and isinstance(m.get("option_scores"), dict)
        if mtype in ("comment", "observation") or (mtype == "multiple_choice" and not has_outcome_scores):
            # Text metrics and legacy multiple_choice (no option_scores map)
            # record the raw value only — never a score.
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
        elif mtype == "multiple_choice":
            # Dropdown scoring: the selected outcome label maps straight to its
            # developmental score (already on the 12/10/9/8 scale — no further
            # normalization). Raw stays the label string so review UIs show
            # words; an unmatched/legacy label leaves normalized None (unscored)
            # exactly like the pre-dropdown behavior.
            normalized = option_score(m, raw)
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
