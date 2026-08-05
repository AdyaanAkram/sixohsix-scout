"""Canonical baseball position taxonomy and evaluation-template resolution.

Resolution order:
  0. Prefer templates matching athlete age_group (when age_group provided)
  1. Template whose applies_to_positions contains athlete primary (or override)
  2. Template matching position group (OF for LF/CF/RF, IF for 1B/2B/3B/SS)
  3. station.template_id
  4. Org default template (is_default=True)
  5. Fail — never render an empty form
"""

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


def _age_rank(token: str | None) -> int | None:
    if not token:
        return None
    t = str(token).strip().upper().replace("–", "-")
    if t == "COLLEGE":
        return 19
    if t == "PRO":
        return 25
    if t.endswith("U") and t[:-1].isdigit():
        return int(t[:-1])
    return None


def _age_matches(athlete_age: str | None, template_age: str | None) -> bool:
    """True when template age_group equals or covers athlete age (incl. bands)."""
    if not template_age:
        return True
    if not athlete_age:
        return False
    ta = str(template_age).strip().upper().replace("–", "-")
    aa = str(athlete_age).strip().upper()
    if ta == aa:
        return True
    if "-" in ta:
        parts = [p.strip() for p in ta.split("-", 1)]
        if len(parts) == 2:
            lo, hi = _age_rank(parts[0]), _age_rank(parts[1])
            ar = _age_rank(aa)
            if lo is not None and hi is not None and ar is not None:
                return lo <= ar <= hi
    return False


def _prefer_age(candidates: list[dict], age_group: str | None):
    if not candidates:
        return None
    if age_group:
        for t in candidates:
            if t.get("age_group") and _age_matches(age_group, t.get("age_group")):
                return t
    return candidates[0]


def resolve_template(
    templates: list[dict],
    *,
    position: str | None,
    station_template_id: str | None,
    age_group: str | None = None,
):
    """Pick a template from an org-scoped list. Returns (template, reason) or (None, None)."""
    position = normalize_position(position)
    by_id = {t["id"]: t for t in templates if t.get("id")}

    # 1. Exact position match — prefer age-compatible
    if position:
        exact = [t for t in templates if position_matches_template(position, t.get("applies_to_positions") or [])]
        picked = _prefer_age(exact, age_group)
        if picked:
            aged = bool(age_group and picked.get("age_group") and _age_matches(age_group, picked.get("age_group")))
            return picked, "position_match_age" if aged else "position_match"

        # 2. Position group (OF / IF) — prefer age
        group = POSITION_TO_GROUP.get(position)
        if group:
            group_hits = [t for t in templates if group in (t.get("applies_to_positions") or [])]
            picked = _prefer_age(group_hits, age_group)
            if picked:
                aged = bool(age_group and picked.get("age_group") and _age_matches(age_group, picked.get("age_group")))
                return picked, "position_group_age" if aged else "position_group"

    # 3. Age-band templates without position filters
    if age_group:
        age_hits = [
            t for t in templates
            if t.get("age_group") and _age_matches(age_group, t.get("age_group"))
            and not (t.get("applies_to_positions") or [])
        ]
        if age_hits:
            return age_hits[0], "age_match"

    # 4. Station default
    if station_template_id and station_template_id in by_id:
        return by_id[station_template_id], "station_default"

    # 5. Org catch-all
    for t in templates:
        if t.get("is_default"):
            return t, "org_default"

    return None, None
