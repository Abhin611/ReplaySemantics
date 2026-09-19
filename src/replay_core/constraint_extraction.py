"""
constraint_extraction.py
-------------------------
Member 1 (Graph & Replay Core) -- Month 2 addition (order-invariance
groundwork, added alongside the original candidate-event extraction).

Given a CandidateExtractionResult (the bounded candidate set for one
target event / realized loss), classifies every pair of candidate
events -- plus the target itself -- as either:

    - a structural constraint: the process itself already fixes an
      order between the pair. Two cases produce this:
        (a) target-boundary: one of the pair IS the target event. The
            target is the fixed endpoint of this whole analysis by
            construction -- candidate_extraction.py only discovers
            events strictly before it via backward traversal -- so
            every candidate is upstream of the target whether or not
            it happens to touch the target's object directly. Treating
            a target/candidate pair as "order not fixed" would let the
            realized loss get replayed as an upstream input, which
            contradicts what "target" means here. This is why e33/e34
            (candidate/target) must be a constraint even though e33
            doesn't directly share an object with e34.
        (b) shared-object: two non-target candidates touch a common
            object at distinct timestamps -- the log already recorded
            a real order for that object's history.
    - a permutable pair: neither event is the target, AND they share
      no object, OR every shared object was touched at the identical
      timestamp (the log can't tell us which came first -- e.g. a
      single SAP batch commit). Nothing in the process structure fixes
      an order between two such siblings.

WHY THIS DOES NOT SOLVE ORDER-INVARIANCE (read before extending):
    This is a *different* question from the Month 4 confluence checker.
    A pair can be fully permutable here and still come back BLOCKED at
    Month 4, because their *correction math* doesn't commute -- e.g.
    tax-then-round-then-convert vs. convert-then-tax-then-round can
    disagree by a cent even though nothing in the process graph forces
    an order between those two events. This module only narrows *which*
    pairs Month 4 needs to run order-behaviour tests on (skip the ones
    already structurally fixed); it does not resolve the arithmetic
    non-commutativity problem, which is the actual research core.

WHY NOT A DIRECTED GRAPH / nx.has_path:
    graph.py's ObjectCentricGraph is deliberately an *undirected*
    bipartite event<->object graph (see its module docstring) --
    OCEL logs have no native single directed causal graph. The only
    structural ordering signal actually available for two non-target
    events is: two events that touch the same object have a real
    chronological order, because that object's real-world history only
    happened once. For the target specifically, its structural role as
    the analysis endpoint is itself the ordering signal -- see (a)
    above -- independent of any shared object.

Handoff:
    - `constraints` -> Member 2 (Ashwathy): appended to policy.json as
      `given_constraints` (see to_policy_dict()). She should treat
      these as additional hard rules alongside her own policy-defined
      canonical orderings (Month 4, POLICY-ORDERED classification) --
      these are structural, not policy-authored, so they take
      precedence and never need a policy version bump.
    - `permutable_pairs` -> Member 3 (Rohit): rendered as the
      "Detected Permutable Pairs" card in the Replay Console, shown
      before the user clicks "Run Verification" (Month 2 UI addition).
      These are exactly the pairs Month 4's order-behaviour testing
      needs to actually run against.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from itertools import combinations
from pathlib import Path

from replay_core.candidate_extraction import CandidateExtractionResult
from replay_core.models import OCELEvent


@dataclass(frozen=True)
class StructuralConstraint:
    """A hard order-lock between two candidate events: `before_event_id`
    is required to be treated as preceding `after_event_id`.

    `shared_object_id` is the object that establishes the lock when
    `reason == "structural_precedence"`. For `reason ==
    "target_precedence"` there may be no single shared object (the
    candidate can be several hops upstream of the target with no
    direct object in common) -- in that case `shared_object_id` is
    None, and the lock comes from the target's structural role as the
    analysis endpoint, not from a specific object.
    """

    before_event_id: str
    after_event_id: str
    shared_object_id: str | None
    reason: str = "structural_precedence"

    def to_policy_dict(self) -> dict:
        """Shape to append into policy.json's `given_constraints` list."""
        return {
            "before": self.before_event_id,
            "after": self.after_event_id,
            "shared_object": self.shared_object_id,
            "reason": self.reason,
        }


@dataclass(frozen=True)
class PermutablePair:
    """A candidate-event pair with no structural order-lock. Whether
    *correcting* them in either order changes the financial outcome is
    a separate question for the Month-4 confluence checker -- this only
    says the process itself doesn't forbid either order. Never includes
    the target event -- see module docstring, case (a)."""

    event_id_a: str
    event_id_b: str


@dataclass
class ConstraintExtractionResult:
    target_event_id: str
    constraints: list[StructuralConstraint] = field(default_factory=list)
    permutable_pairs: list[PermutablePair] = field(default_factory=list)

    def summary(self) -> dict:
        return {
            "target_event_id": self.target_event_id,
            "num_constraints": len(self.constraints),
            "num_permutable_pairs": len(self.permutable_pairs),
            "constraints": [c.to_policy_dict() for c in self.constraints],
            "permutable_pairs": [
                {"a": p.event_id_a, "b": p.event_id_b} for p in self.permutable_pairs
            ],
        }


def extract_constraints(extraction: CandidateExtractionResult) -> ConstraintExtractionResult:
    """
    For every pair drawn from `extraction.candidate_events` plus the
    target event itself, classify the pair as a structural constraint
    or a permutable pair.

    Rule (see module docstring for the reasoning):
      - if either event in the pair is the target -> ALWAYS a
        structural constraint, candidate-before-target, reason
        "target_precedence". Uses a real shared object when the
        candidate happens to touch the target's object directly
        (common for hop-1 candidates); otherwise shared_object_id is
        None -- the lock still holds, it's just not object-mediated.
      - otherwise: shared = objects touched by BOTH events.
          - shared non-empty AND timestamps differ
                -> structural constraint, earlier-before-later, reason
                   "structural_precedence", tagged with the
                   lexicographically smallest shared object id (kept
                   deterministic -- reproducible for the evidence
                   artifact and for tests).
          - shared empty, OR every shared object touched at the
            identical timestamp
                -> permutable pair.
    """
    target_id = extraction.target_event.event_id
    events: list[OCELEvent] = list(extraction.candidate_events) + [extraction.target_event]
    constraints: list[StructuralConstraint] = []
    permutable: list[PermutablePair] = []

    for e1, e2 in combinations(events, 2):
        if e1.event_id == target_id or e2.event_id == target_id:
            candidate, target_event = (e2, e1) if e1.event_id == target_id else (e1, e2)
            shared = candidate.object_ids() & target_event.object_ids()
            shared_object_id = sorted(shared)[0] if shared else None
            constraints.append(
                StructuralConstraint(
                    before_event_id=candidate.event_id,
                    after_event_id=target_event.event_id,
                    shared_object_id=shared_object_id,
                    reason="target_precedence",
                )
            )
            continue

        shared = e1.object_ids() & e2.object_ids()

        if not shared or e1.timestamp == e2.timestamp:
            permutable.append(PermutablePair(e1.event_id, e2.event_id))
            continue

        before, after = (e1, e2) if e1.timestamp < e2.timestamp else (e2, e1)
        shared_object_id = sorted(shared)[0]
        constraints.append(
            StructuralConstraint(
                before.event_id, after.event_id, shared_object_id, reason="structural_precedence"
            )
        )

    return ConstraintExtractionResult(
        target_event_id=target_id,
        constraints=constraints,
        permutable_pairs=permutable,
    )


def export_constraints(result: ConstraintExtractionResult, out_dir: str | Path) -> dict[str, Path]:
    """
    Writes the handoff artifacts under data/processed/, same
    dependency-free JSON pattern as export.py:

        - given_constraints_<target>.json -> Member 2 merges the
          `given_constraints` list into policy.json.
        - permutable_pairs_<target>.json  -> Member 3's frontend can
          read this directly (or via the API) for the permutable-pairs
          UI card.

    Nobody downstream needs this module installed to read either file
    -- just plain JSON.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    constraints_path = out_dir / f"given_constraints_{result.target_event_id}.json"
    pairs_path = out_dir / f"permutable_pairs_{result.target_event_id}.json"

    constraints_path.write_text(
        json.dumps(
            {
                "target_event_id": result.target_event_id,
                "given_constraints": [c.to_policy_dict() for c in result.constraints],
            },
            indent=2,
        )
    )
    pairs_path.write_text(
        json.dumps(
            {
                "target_event_id": result.target_event_id,
                "permutable_pairs": [
                    {"a": p.event_id_a, "b": p.event_id_b} for p in result.permutable_pairs
                ],
            },
            indent=2,
        )
    )

    return {"given_constraints": constraints_path, "permutable_pairs": pairs_path}


if __name__ == "__main__":
    import argparse

    from replay_core.candidate_extraction import DEFAULT_MAX_HOPS, extract_candidate_events
    from replay_core.graph import ObjectCentricGraph
    from replay_core.ingestion import load_ocel

    parser = argparse.ArgumentParser(
        description="Extract structural constraints and permutable pairs for a target event's candidate set."
    )
    parser.add_argument("ocel_path", help="Path to an OCEL 2.0 file")
    parser.add_argument("target_event_id", help="Event id to treat as the realized loss")
    parser.add_argument("--max-hops", type=int, default=DEFAULT_MAX_HOPS)
    parser.add_argument("--out", default="data/processed", help="Output directory for handoff JSON")
    args = parser.parse_args()

    ocel_log = load_ocel(args.ocel_path)
    g = ObjectCentricGraph(ocel_log)
    extraction = extract_candidate_events(g, args.target_event_id, max_hops=args.max_hops)
    result = extract_constraints(extraction)
    print(json.dumps(result.summary(), indent=2))

    paths = export_constraints(result, args.out)
    for name, p in paths.items():
        print(f"{name}: {p}")
