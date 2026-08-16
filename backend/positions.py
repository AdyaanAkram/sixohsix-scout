"""Canonical baseball position taxonomy, age bands, and evaluation-template resolution.

Resolution order:
  1. age_group + exact position
  2. age_group + position group (OF for LF/CF/RF, IF for 1B/2B/3B/SS)
  3. exact position (any age)
  4. position group (any age)
  5. age_group only (template carries no position filter)
  6. station.template_id
  7. Org default template (is_default=True)
  8. Fail — never render an empty form
"""

# Canonical age bands (spec §8). Single source of truth — importers must not
# redefine this list. "Professional" is set manually and never auto-computed.
AGE_BANDS = [
    "7U-8U", "9U-10U", "11U-12U", "13U-14U", "15U-16U", "17U-18U",
    "College", "Professional",
]

# Numeric age span per band. The youngest band is open downward and Professional
# open upward so legacy labels ("6U", "Pro") still land inside a band.
AGE_BAND_SPANS = {
    "7U-8U": (0, 8),
    "9U-10U": (9, 10),
    "11U-12U": (11, 12),
    "13U-14U": (13, 14),
    "15U-16U": (15, 16),
    "17U-18U": (17, 18),
    "College": (19, 22),
    "Professional": (23, 99),
}

POSITION_TAXONOMY = [
    "P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "OF", "IF", "DH", "UTIL",
]

POSITION_GROUPS = {
    "OF": {"LF", "CF", "RF", "OF"},
    "IF": {"1B", "2B", "3B", "SS", "IF"},
}

# Map a specific position to its group code (if any)
POSITION_TO_GROUP = {}
for group, members in POSITION_GROUPS.items():
    for m in members:
        if m != group:
            POSITION_TO_GROUP[m] = group


def normalize_position(code: str | None) -> str | None:
    if not code:
        return None
    c = str(code).strip().upper()
    return c if c in POSITION_TAXONOMY else None


def validate_positions(codes: list[str] | None) -> list[str]:
    """Return normalized list or raise ValueError naming bad codes."""
    if not codes:
        return []
    out = []
    bad = []
    for raw in codes:
        n = normalize_position(raw)
        if n is None:
            bad.append(raw)
        elif n not in out:
            out.append(n)
    if bad:
        raise ValueError(
            f"Unknown position code(s): {', '.join(str(b) for b in bad)}. "
            f"Allowed: {', '.join(POSITION_TAXONOMY)}"
        )
    return out


def position_matches_template(position: str | None, applies_to: list | None) -> bool:
    if not position or not applies_to:
        return False
    return position in applies_to


def _canon_age(token: str | None) -> str | None:
    if not token:
        return None
    return str(token).strip().upper().replace("–", "-")


def _age_rank(token: str | None) -> int | None:
    t = _canon_age(token)
    if not t:
        return None
    if t == "COLLEGE":
        return 19
    if t in ("PRO", "PROFESSIONAL"):
        return 25
    if t.endswith("U") and t[:-1].isdigit():
        return int(t[:-1])
    if t.isdigit():
        return int(t)
    return None


def _age_span(token: str | None) -> tuple[int, int] | None:
    """Numeric (lo, hi) for a canonical band, a legacy band, a single-year label,
    College or Pro/Professional. None when the label is unparseable."""
    t = _canon_age(token)
    if not t:
        return None
    for band, span in AGE_BAND_SPANS.items():
        if t == band.upper():
            return span
    if t in ("PRO", "PROFESSIONAL"):
        return AGE_BAND_SPANS["Professional"]
    if "-" in t:
        parts = [p.strip() for p in t.split("-", 1)]
        if len(parts) == 2:
            lo, hi = _age_rank(parts[0]), _age_rank(parts[1])
            if lo is not None and hi is not None:
                return (min(lo, hi), max(lo, hi))
        return None
    r = _age_rank(t)
    return (r, r) if r is not None else None


def age_band_for_age(age: int | None) -> str | None:
    """Map a numeric age onto a canonical band. Never returns "Professional" —
    that band is assigned manually, never derived from a birth date."""
    if age is None:
        return None
    try:
        age = int(age)
    except (TypeError, ValueError):
        return None
    if age <= 8:
        return "7U-8U"
    if age >= 19:
        return "College"
    for band in ("9U-10U", "11U-12U", "13U-14U", "15U-16U", "17U-18U"):
        lo, hi = AGE_BAND_SPANS[band]
        if lo <= age <= hi:
            return band
    return "College"


def normalize_age_band(token: str | None) -> str | None:
    """Map any stored age label onto a canonical band. Accepts the canonical bands,
    single-year labels ("12U"), legacy bands ("8U-10U", "14U-18U") and Pro."""
    t = _canon_age(token)
    if not t:
        return None
    for band in AGE_BANDS:
        if t == band.upper():
            return band
    if t in ("PRO", "PROFESSIONAL"):
        return "Professional"
    span = _age_span(t)
    if span is None:
        return None
    if span == AGE_BAND_SPANS["Professional"]:
        return "Professional"
    return age_band_for_age((span[0] + span[1]) // 2)


def is_valid_age_band(token: str | None) -> bool:
    return token in AGE_BANDS


def _age_matches(athlete_age: str | None, template_age: str | None) -> bool:
    """True when the template's age_group covers the athlete's age label.
    Spans overlap rather than nest, so legacy labels on either side still match."""
    if not template_age:
        return True
    if not athlete_age:
        return False
    ta, aa = _canon_age(template_age), _canon_age(athlete_age)
    if ta == aa:
        return True
    tspan, aspan = _age_span(ta), _age_span(aa)
    if tspan is None or aspan is None:
        return False
    return aspan[0] <= tspan[1] and tspan[0] <= aspan[1]


def _age_specificity(template: dict) -> int:
    """Narrower age bands win ties. Unparseable/blank sort last."""
    span = _age_span(template.get("age_group"))
    return (span[1] - span[0]) if span else 999


def _age_distance(template: dict, age_group: str | None) -> int:
    """Gap in years between a template's band and the athlete's. Age-neutral templates
    sort first — they are authored to cover every band."""
    tspan = _age_span(template.get("age_group"))
    if tspan is None:
        return -1
    aspan = _age_span(age_group)
    if aspan is None:
        return 999
    return max(0, aspan[0] - tspan[1], tspan[0] - aspan[1])


def _age_hits(candidates: list[dict], age_group: str | None) -> list[dict]:
    """Candidates that carry an age_group compatible with the athlete, tightest first."""
    if not age_group:
        return []
    hits = [
        t for t in candidates
        if t.get("age_group") and _age_matches(age_group, t.get("age_group"))
    ]
    return sorted(hits, key=_age_specificity)


# Station kinds: what a station TESTS. When templates carry station_kind, the
# station decides WHAT is evaluated and the age band decides WHICH VARIANT —
# fixing "a shortstop gets the same form at every station".
STATION_KIND_KEYWORDS = {
    "infield": "infield", "outfield": "outfield", "hitting": "hitting",
    "catching": "catching", "catcher": "catching", "pitching": "pitching",
    "bullpen": "pitching", "base running": "base_running", "baserunning": "base_running",
    "athletic": "athletic", "movement": "athletic", "speed": "athletic",
    "throwing": "throwing", "arm": "throwing",
    "iq": "baseball_iq", "instinct": "baseball_iq",
    "character": "character", "coachability": "character",
}


def infer_station_kind(name: str | None) -> str | None:
    n = (name or "").lower()
    for kw, kind in STATION_KIND_KEYWORDS.items():
        if kw in n:
            return kind
    return None


def resolve_template(
    templates: list[dict],
    *,
    position: str | None,
    station_template_id: str | None,
    age_group: str | None = None,
    station_kind: str | None = None,
):
    """Pick a template from an org-scoped list. Returns (template, reason) or (None, None).

    Station-kind templates come first: the station defines WHAT is tested, the
    age band picks the variant. Orgs without kind-tagged templates fall through
    to the legacy position/age chain unchanged. Age is part of the lookup, not a
    tiebreaker: an age+position template outranks a position-only one.
    """
    position = normalize_position(position)
    by_id = {t["id"]: t for t in templates if t.get("id")}

    # 0. Station kind + age band (then nearest band of the same kind).
    if station_kind:
        kind_hits = [t for t in templates if t.get("station_kind") == station_kind]
        aged_kind = _age_hits(kind_hits, age_group)
        if aged_kind:
            return aged_kind[0], "station_kind_age"
        if kind_hits:
            picked = min(kind_hits, key=lambda t: _age_distance(t, age_group))
            return picked, "station_kind_nearest_age"

    exact = []
    group_hits = []
    if position:
        exact = [t for t in templates if position_matches_template(position, t.get("applies_to_positions") or [])]
        group = POSITION_TO_GROUP.get(position)
        if group:
            group_hits = [t for t in templates if group in (t.get("applies_to_positions") or [])]

    # 1. age_group + exact position
    aged_exact = _age_hits(exact, age_group)
    if aged_exact:
        return aged_exact[0], "position_match_age"

    # 2. age_group + position group
    aged_group = _age_hits(group_hits, age_group)
    if aged_group:
        return aged_group[0], "position_group_age"

    # 3. exact position, any age — nearest band, age-neutral templates first
    if exact:
        picked = min(exact, key=lambda t: _age_distance(t, age_group))
        return picked, "position_match_no_age" if age_group else "position_match"

    # 4. position group, any age
    if group_hits:
        picked = min(group_hits, key=lambda t: _age_distance(t, age_group))
        return picked, "position_group_no_age" if age_group else "position_group"

    # 5. age_group only — template carries no position filter
    age_only = _age_hits(
        [t for t in templates if not (t.get("applies_to_positions") or [])], age_group)
    if age_only:
        return age_only[0], "age_match"

    # 6. Station default
    if station_template_id and station_template_id in by_id:
        return by_id[station_template_id], "station_default"

    # 7. Org catch-all
    for t in templates:
        if t.get("is_default"):
            return t, "org_default"

    return None, None
