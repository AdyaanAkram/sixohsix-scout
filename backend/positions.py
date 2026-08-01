"""Canonical baseball position taxonomy and evaluation-template resolution.

Resolution order (must stay exact — see product spec for Aug 16):
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


def resolve_template(
    templates: list[dict],
    *,
    position: str | None,
    station_template_id: str | None,
):
    """Pick a template from an org-scoped list. Returns (template, reason) or (None, None)."""
    position = normalize_position(position)
    by_id = {t["id"]: t for t in templates if t.get("id")}

    # 1. Exact position match
    if position:
        for t in templates:
            applies = t.get("applies_to_positions") or []
            if position_matches_template(position, applies):
                return t, "position_match"

        # 2. Position group (OF / IF)
        group = POSITION_TO_GROUP.get(position)
        if group:
            for t in templates:
                applies = t.get("applies_to_positions") or []
                if group in applies:
                    return t, "position_group"

    # 3. Station default
    if station_template_id and station_template_id in by_id:
        return by_id[station_template_id], "station_default"

    # 4. Org catch-all
    for t in templates:
        if t.get("is_default"):
            return t, "org_default"

    return None, None
