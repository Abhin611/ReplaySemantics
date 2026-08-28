"""
candidate_extraction.py
------------------------
Member 1 (Graph & Replay Core) -- Month 2 deliverable, part 2.

Implements Objective 1 from the project proposal:
    "Extract a bounded, policy-relevant candidate event set from an
    object-centric ERP event graph via backward traversal."

This is the entry point to the whole pipeline: given a *target event*
(the point at which a financial loss was realized -- e.g. an Invoice
line), find the bounded set of earlier events (size 3-8, per the
methodology's step 2) that could plausibly have contributed to that
loss. That candidate set E is what Member 2's correction functions
operate on, and what the Month-3 replay operator replays subsets of.

Algorithm (bounded backward BFS over the object-centric graph):
    1. Start from the target event's own objects (hop 0 frontier).
    2. At each hop, for every object in the frontier, collect all events
       touching that object with a timestamp strictly earlier than the
       target event's timestamp, that haven't been visited yet.
    3. Expand the frontier to the objects touched by those newly-found
       events (this is what makes the traversal *object-centric* rather
       than single-object: an interaction on Object B that happened before
       the loss, discovered via Object A, can pull in Object B's own
       earlier history too).
    4. Stop expanding once `max_hops` is reached or enough candidates have
       been found.
    5. Rank all discovered candidates by recency (closest-in-time to the
       target first) and keep the top `max_events`.

Where "policy-relevant" plugs in:
    Step 5's ranking is currently pure recency. This is intentional --
    recency is a defensible, policy-agnostic default. Once Member 2's
    policy schema exists, `rank_candidates` is the function to swap in a
    policy-aware scorer (e.g. prioritizing events whose attributes overlap
    with the fields the policy's correction functions actually touch,
    such as price/discount/quantity) without touching the traversal logic
    itself.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from replay_core.graph import ObjectCentricGraph
from replay_core.models import OCELEvent

logger = logging.getLogger("replay_core.candidate_extraction")

DEFAULT_MAX_EVENTS = 8
DEFAULT_MIN_EVENTS = 3
DEFAULT_MAX_HOPS = 3


@dataclass
class CandidateExtractionResult:
    target_event: OCELEvent
    candidate_events: list[OCELEvent]
    touched_objects: set[str]
    hops_used: int
    warnings: list[str] = field(default_factory=list)

    def event_ids(self) -> list[str]:
        return [e.event_id for e in self.candidate_events]

    def summary(self) -> dict:
        return {
            "target_event_id": self.target_event.event_id,
            "target_activity": self.target_event.activity,
            "target_timestamp": self.target_event.timestamp.isoformat(),
            "num_candidates": len(self.candidate_events),
            "candidate_event_ids": self.event_ids(),
            "touched_objects": sorted(self.touched_objects),
            "hops_used": self.hops_used,
            "warnings": self.warnings,
        }


def rank_candidates(target: OCELEvent, candidates: list[OCELEvent]) -> list[OCELEvent]:
    """Default ranking: most recent first (closest in time to the target,
    i.e. the most causally-proximate events).

    Tie-break: SAP-style batch commits routinely stamp many events with the
    exact same timestamp (e.g. all line items of one document posted in a
    single transaction) -- ranking must still be deterministic in that case,
    so ties are broken by event_id. Swap this function out for a
    policy-aware scorer once correction-function metadata exists.
    """
    return sorted(candidates, key=lambda e: (e.timestamp, e.event_id), reverse=True)


def extract_candidate_events(
    graph: ObjectCentricGraph,
    target_event_id: str,
    max_events: int = DEFAULT_MAX_EVENTS,
    min_events: int = DEFAULT_MIN_EVENTS,
    max_hops: int = DEFAULT_MAX_HOPS,
) -> CandidateExtractionResult:
    """
    Bounded backward traversal from `target_event_id` over the
    object-centric graph.

    Args:
        graph: an ObjectCentricGraph built from the ingested log.
        target_event_id: the event id representing the realized loss.
        max_events: upper bound on returned candidate set size (proposal
            targets 3-8).
        min_events: if fewer than this many candidates are found, a
            warning is attached to the result (traversal still returns
            what it found rather than failing).
        max_hops: how many object-hops backward to explore before
            stopping, even if max_events hasn't been reached yet.

    Returns:
        CandidateExtractionResult with the bounded candidate set, sorted
        chronologically (ascending) for readability.
    """
    target = graph.get_event(target_event_id)
    target_ts = target.timestamp

    visited_events: set[str] = {target_event_id}
    visited_objects: set[str] = set()
    found: dict[str, OCELEvent] = {}

    frontier_objects = set(graph.objects_of_event(target_event_id))
    hop = 0

    while frontier_objects and hop < max_hops:
        next_frontier_objects: set[str] = set()

        for oid in frontier_objects:
            if oid in visited_objects:
                continue
            visited_objects.add(oid)

            for eid in graph.events_before(oid, before_ts=target_ts, strict=True):
                if eid in visited_events:
                    continue
                visited_events.add(eid)
                event = graph.get_event(eid)
                found[eid] = event
                next_frontier_objects.update(graph.objects_of_event(eid))

        frontier_objects = next_frontier_objects - visited_objects
        hop += 1

    candidates = rank_candidates(target, list(found.values()))[:max_events]
    candidates.sort(key=lambda e: e.timestamp)  # chronological order for readability

    warnings: list[str] = []
    if len(candidates) < min_events:
        warnings.append(
            f"Only {len(candidates)} candidate event(s) found within {hop} hop(s); "
            f"fewer than the configured minimum of {min_events}. Consider raising "
            f"max_hops, or this case may be genuinely single-event."
        )
        logger.warning(warnings[-1])

    touched_objects = set(graph.objects_of_event(target_event_id))
    for e in candidates:
        touched_objects.update(e.object_ids())

    return CandidateExtractionResult(
        target_event=target,
        candidate_events=candidates,
        touched_objects=touched_objects,
        hops_used=hop,
        warnings=warnings,
    )


if __name__ == "__main__":
    import argparse
    import json

    from replay_core.ingestion import load_ocel

    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    parser = argparse.ArgumentParser(
        description="Extract a bounded candidate event set via backward traversal."
    )
    parser.add_argument("ocel_path", help="Path to an OCEL 2.0 file")
    parser.add_argument("target_event_id", help="Event id to treat as the realized loss")
    parser.add_argument("--max-events", type=int, default=DEFAULT_MAX_EVENTS)
    parser.add_argument("--min-events", type=int, default=DEFAULT_MIN_EVENTS)
    parser.add_argument("--max-hops", type=int, default=DEFAULT_MAX_HOPS)
    args = parser.parse_args()

    ocel_log = load_ocel(args.ocel_path)
    g = ObjectCentricGraph(ocel_log)
    result = extract_candidate_events(
        g, args.target_event_id,
        max_events=args.max_events, min_events=args.min_events, max_hops=args.max_hops,
    )
    print(json.dumps(result.summary(), indent=2, default=str))
