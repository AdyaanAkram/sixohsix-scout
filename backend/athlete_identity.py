"""Deciding whether two athlete records are the same child.

The same boy reaches this system by several routes — a parent self-signs up, a
second parent self-signs up, a coach types the roster off a handwritten sheet
into a spreadsheet, a QR code at the field opens registration again. Exact
string equality misses most of those, which is how one athlete ends up with
three profiles and his evaluations split between them.

Two real examples from the production data this was written against:

    'Lopez Jr.' vs 'Lopez Jr'      — same child, punctuation differs
    2012-08-16  vs 2012-08-26      — same child, one parent mistyped the day

So identity is compared on a normalized name, and a birth date that is close
but not equal still counts as a probable match rather than a new person.
"""
import re
import unicodedata
from datetime import date

# A birth date this far apart is still probably a typo rather than a sibling.
DOB_TYPO_TOLERANCE_DAYS = 31


def normalize_name(value: str | None) -> str:
    """Fold case, accents and punctuation away: "Peña Jr." -> "penajr"."""
    if not value:
        return ""
    decomposed = unicodedata.normalize("NFKD", value)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", stripped.lower())


def identity_key(first: str | None, last: str | None) -> str:
    return f"{normalize_name(first)}|{normalize_name(last)}"


def _parse(dob: str | None) -> date | None:
    try:
        return date.fromisoformat((dob or "").strip())
    except (ValueError, AttributeError):
        return None


def dob_relation(a: str | None, b: str | None) -> str:
    """'same' | 'near' | 'different' | 'unknown'."""
    da, dbb = _parse(a), _parse(b)
    if da is None or dbb is None:
        return "unknown"
    if da == dbb:
        return "same"
    if abs((da - dbb).days) <= DOB_TYPO_TOLERANCE_DAYS:
        return "near"
    return "different"


def duplicate_verdict(candidate: dict, first: str, last: str, dob: str | None) -> str | None:
    """How confident are we that `candidate` is this same child?

    'exact'    - same normalized name and the same birth date.
    'probable' - same normalized name, birth dates close enough to be a typo,
                 or one side has no birth date recorded at all.
    None       - not the same child as far as we can tell.
    """
    if identity_key(candidate.get("first_name"), candidate.get("last_name")) != identity_key(first, last):
        return None
    rel = dob_relation(candidate.get("date_of_birth"), dob)
    if rel == "same":
        return "exact"
    if rel in ("near", "unknown"):
        return "probable"
    return None


def candidate_query(org_id: str, last: str, dob: str | None = None) -> dict:
    """Cheap pre-filter for the database; normalize_name does the real work.

    Only the first letter of the surname is used. A longer prefix looks safer
    but silently fails on accents — a stored "Peña" is not matched by a regex
    built from "Pena", because the third character differs before normalization
    ever runs. The birth date is OR'd in so an accent on the FIRST letter
    ("Ávila") still surfaces the candidate.
    """
    stem = normalize_name(last)[:1]
    q = {"organization_id": org_id, "status": {"$ne": "merged"}}
    clauses = []
    if stem:
        clauses.append({"last_name": {"$regex": f"^\\s*{re.escape(stem)}", "$options": "i"}})
    if dob:
        clauses.append({"date_of_birth": dob})
    if clauses:
        q["$or"] = clauses
    return q


async def find_duplicate(db, org_id: str, first: str, last: str, dob: str | None):
    """Return (athlete, verdict) for the strongest match, or (None, None)."""
    best = None
    # 200 is generous for one surname letter at club scale; the normalized
    # comparison below is what actually decides.
    for c in await db.athletes.find(candidate_query(org_id, last, dob), {"_id": 0}).to_list(200):
        verdict = duplicate_verdict(c, first, last, dob)
        if verdict == "exact":
            return c, "exact"
        if verdict == "probable" and best is None:
            best = c
    return (best, "probable") if best else (None, None)
