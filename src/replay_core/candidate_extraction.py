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
    event_hops: dict[str, int] = field(default_factory=dict)
    # event_id -> (discovering_event_id, shared_object_id): the actual
    # backward-traversal parent link that found this event, i.e. which
    # already-visited event's object led here. The target event is its
    # own hop-1 candidates' parent.
    discovered_via: dict[str, tuple[str, str]] = field(default_factory=dict)
    # total events found by the traversal within max_hops, BEFORE the
    # max_events cap trimmed them down -- i.e. "how many candidates exist
    # at this max_hops setting". Raising max_events past this has no effect.
    total_discovered: int = 0
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


def rank_candidates(
    target: OCELEvent, candidates: list[OCELEvent], hops: dict[str, int]
) -> list[OCELEvent]:
    """
    Ranking, most-causally-proximate first:
      1. Lower hop distance from the target wins (a hop-1 event -- directly
         on one of the target's own objects -- outranks a hop-2 event
         reached only via an intermediate object). This is the primary
         criterion, and it also guarantees connectivity: hop-1 events'
         discovery parent is always the target itself, so bounding to the
         top N by this ranking can never orphan a kept event the way a
         pure-recency ranking could (see the module-level note on the
         disconnection this replaced).
      2. Within the same hop, most recent first (closest in time).
      3. Final tie-break: event_id, since SAP-style batch commits routinely
         stamp many same-hop events with the identical timestamp.

    Swap this out for a policy-aware scorer once correction-function
    metadata exists.
    """
    by_recency = sorted(candidates, key=lambda e: (e.timestamp, e.event_id), reverse=True)
    return sorted(by_recency, key=lambda e: hops[e.event_id])  # stable: preserves recency order


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
    found_at_hop: dict[str, int] = {}
    discovered_via: dict[str, tuple[str, str]] = {}
    # which event's traversal caused each object to enter the frontier --
    # used to attribute each newly-found event to the real parent event
    # that led to it, not just "some event N hops back".
    object_origin: dict[str, str] = {
        oid: target_event_id for oid in graph.objects_of_event(target_event_id)
    }

    frontier_objects = set(object_origin.keys())
    hop = 0

    while frontier_objects and hop < max_hops:
        next_frontier_objects: set[str] = set()
        current_hop_number = hop + 1  # hop 1 = the target's own objects' prior events

        for oid in frontier_objects:
            if oid in visited_objects:
                continue
            visited_objects.add(oid)
            parent_event_id = object_origin[oid]

            for eid in graph.events_before(oid, before_ts=target_ts, strict=True):
                if eid in visited_events:
                    continue
                visited_events.add(eid)
                event = graph.get_event(eid)
                found[eid] = event
                found_at_hop[eid] = current_hop_number
                discovered_via[eid] = (parent_event_id, oid)
                for new_oid in graph.objects_of_event(eid):
                    next_frontier_objects.add(new_oid)
                    object_origin.setdefault(new_oid, eid)

        frontier_objects = next_frontier_objects - visited_objects
        hop += 1

    candidates = rank_candidates(target, list(found.values()), found_at_hop)[:max_events]
    candidates.sort(key=lambda e: e.timestamp)  # chronological order for readability
    event_hops = {e.event_id: found_at_hop[e.event_id] for e in candidates}
    kept_ids = {e.event_id for e in candidates} | {target_event_id}
    kept_discovery = {
        eid: parent for eid, parent in discovered_via.items() if eid in kept_ids
    }
    total_discovered = len(found)

    warnings: list[str] = []
    if len(candidates) < min_events:
        warnings.append(
            f"Only {len(candidates)} candidate event(s) found within {hop} hop(s); "
            f"fewer than the configured minimum of {min_events}. Consider raising "
            f"max_hops, or this case may be genuinely single-event."
        )
        logger.warning(warnings[-1])

    disconnected = [
        eid for eid, (parent, _) in kept_discovery.items() if parent not in kept_ids
    ]
    if disconnected:
        warnings.append(
            f"{len(disconnected)} candidate(s) {disconnected} lost their connecting path "
            f"to the target because the intermediate event(s) that discovered them fell "
            f"outside the top-{max_events} recency cutoff. They are still valid candidates "
            f"(found via real backward traversal), just not graph-connected to the target "
            f"in this bounded view. Raise max_events to see the full connected path."
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
        event_hops=event_hops,
        discovered_via=kept_discovery,
        total_discovered=total_discovered,
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
