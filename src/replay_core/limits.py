"""
limits.py
---------
Member 1 -- candidate-set LIMITS made honest: hop profile, dropped events, complete / partial.

The candidate set is bounded by three user-visible settings (any case, benchmark or real SAP):

    min_events   warn when fewer candidates are found (never an error)
    max_events   cap on the candidate set; None = no cap
    max_hops     how many object-hops backward to explore (default 3)

Rules this module enforces:
  * NOTHING IS SILENTLY DROPPED -- every event found but trimmed is listed;
  * a result is COMPLETE only when no correctable event lies outside the kept set
    (trimmed by max_events, or reachable only beyond max_hops) and, when the case states its
    confirmed loss, the kept events explain all of it. Otherwise it is PARTIAL and the
    report says which setting to raise;
  * the profile is computed from the PUBLIC log (activity names), never from sealed truth.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from policy_engine.corrections import spec_for_activity

from replay_core.candidate_extraction import DEFAULT_MAX_HOPS, CandidateExtractionResult, extract_candidate_events
from replay_core.graph import ObjectCentricGraph

PROFILE_DEPTH = 6  # the profile always looks at least this deep


def _is_active(activity: str) -> bool:
    return spec_for_activity(activity) is not None


def hop_profile(graph: ObjectCentricGraph, target_event_id: str, upto: int = PROFILE_DEPTH) -> dict[str, Any]:
    """Events reachable backward from the target at hop 1..upto (cumulative counts included)."""
    full = extract_candidate_events(graph, target_event_id, max_events=None, min_events=0, max_hops=upto)
    by_hop: dict[int, dict[str, int]] = {h: {"events": 0, "active": 0} for h in range(1, upto + 1)}
    for e in full.candidate_events:
        h = full.event_hops[e.event_id]
        by_hop[h]["events"] += 1
        by_hop[h]["active"] += int(_is_active(e.activity))
    rows, cum_e, cum_a = [], 0, 0
    for h in range(1, upto + 1):
        cum_e += by_hop[h]["events"]
        cum_a += by_hop[h]["active"]
        rows.append({"hop": h, "events": by_hop[h]["events"], "active": by_hop[h]["active"],
                     "cumulative_events": cum_e, "cumulative_active": cum_a})
    deepest_active = max((r["hop"] for r in rows if r["active"]), default=0)
    return {"upto": upto, "rows": rows, "total_events": cum_e, "total_active": cum_a,
            "deepest_active_hop": deepest_active}


def limit_report(
    graph: ObjectCentricGraph, extraction: CandidateExtractionResult, *, max_events: int | None,
    min_events: int, max_hops: int, loss_gap: Decimal | None = None,
) -> dict[str, Any]:
    target = extraction.target_event.event_id
    profile = hop_profile(graph, target, upto=max(PROFILE_DEPTH, max_hops + 2))
    kept = set(extraction.event_ids())
    dropped = [{"event_id": e.event_id, "activity": e.activity, "hop": extraction.found_hops.get(e.event_id),
                "active": _is_active(e.activity)} for e in extraction.dropped_events]
    beyond = sum(r["active"] for r in profile["rows"] if r["hop"] > max_hops)
    dropped_active = sum(1 for d in dropped if d["active"])
    reasons: list[str] = []
    if dropped:
        reasons.append(f"max_events={max_events} dropped {len(dropped)} event(s) ({dropped_active} correctable): "
                       + ", ".join(d["event_id"] for d in dropped))
    if beyond:
        reasons.append(f"{beyond} correctable event(s) lie deeper than max_hops={max_hops} "
                       f"(deepest at hop {profile['deepest_active_hop']})")
    if loss_gap is not None and abs(loss_gap) > Decimal("0.0005"):
        reasons.append(f"the kept events explain the realised loss only up to a gap of {loss_gap:,.2f}")
    complete = not (dropped_active or beyond) and not (loss_gap is not None and abs(loss_gap) > Decimal("0.0005"))
    return {
        "limits": {"min_events": min_events, "max_events": max_events, "max_hops": max_hops},
        "hop_profile": profile, "kept": sorted(kept), "dropped": dropped,
        "complete": complete, "partial_reasons": reasons,
        "suggestion": None if complete else {
            "max_hops": max(max_hops, profile["deepest_active_hop"]),
            "max_events": None if (max_events is not None and (dropped_active or beyond)) else max_events},
        "warnings": list(extraction.warnings),
    }


def lock_pairs_on_full_set(graph: ObjectCentricGraph, extraction: CandidateExtractionResult, max_hops: int):
    """Structural order locks computed on EVERY reachable event (no cap), closed transitively, then restricted to the
    kept events + target. A lock that runs through a dropped middle event therefore still holds."""
    from replay_core.constraint_extraction import StructuralConstraint, extract_constraints

    target = extraction.target_event.event_id
    full = extract_candidate_events(graph, target, max_events=None, min_events=0, max_hops=max_hops)
    res = extract_constraints(full)
    edges = {(c.before_event_id, c.after_event_id) for c in res.constraints}
    cl = set(edges)
    changed = True
    while changed:
        changed = False
        for (a, b) in list(cl):
            for (c, d) in list(cl):
                if b == c and a != d and (a, d) not in cl:
                    cl.add((a, d))
                    changed = True
    keep = set(extraction.event_ids()) | {target}
    direct = {(c.before_event_id, c.after_event_id): c for c in res.constraints}
    out = []
    for (a, b) in sorted(cl):
        if a in keep and b in keep:
            out.append(direct.get((a, b)) or StructuralConstraint(a, b, None, reason="structural_precedence"))
    return out
