from pathlib import Path

import pytest

from replay_core.candidate_extraction import extract_candidate_events
from replay_core.graph import ObjectCentricGraph
from replay_core.ingestion import load_ocel

VBFA_OCEL = Path(__file__).parent.parent / "data" / "raw" / "vbfa_o2c_2019_2021_eur.jsonocel"
SAMPLE = Path(__file__).parent.parent / "data" / "raw" / "ocel20_example.jsonocel"

# A known real event from the VBFA-derived dataset with a rich prior history
# on its Order object (see conversation history / demo run): 10 Goods
# Movement events precede it in time on the same object.
KNOWN_RICH_TARGET = "e977"


@pytest.fixture(scope="module")
def vbfa_graph():
    if not VBFA_OCEL.exists():
        pytest.skip("VBFA-derived OCEL2 file not built yet")
    log = load_ocel(VBFA_OCEL)
    return ObjectCentricGraph(log)


def test_candidate_set_is_bounded_by_max_events(vbfa_graph):
    result = extract_candidate_events(
        vbfa_graph, KNOWN_RICH_TARGET, max_events=8, min_events=3, max_hops=3
    )
    assert len(result.candidate_events) <= 8


def test_candidates_are_strictly_before_target_time(vbfa_graph):
    result = extract_candidate_events(vbfa_graph, KNOWN_RICH_TARGET, max_events=8)
    for e in result.candidate_events:
        assert e.timestamp < result.target_event.timestamp


def test_candidates_are_chronologically_sorted(vbfa_graph):
    result = extract_candidate_events(vbfa_graph, KNOWN_RICH_TARGET, max_events=8)
    timestamps = [e.timestamp for e in result.candidate_events]
    assert timestamps == sorted(timestamps)


def test_known_rich_target_hits_max_events(vbfa_graph):
    # This object's backward traversal discovers a cross-object link into a
    # Delivery document's own event history (real multi-hop object-centric
    # behavior), yielding far more than max_events candidates total ->
    # the bound should saturate at exactly max_events. Ranking prioritizes
    # hop distance first, so the 8 kept candidates are the hop-1 events
    # (directly connected to the target) -- see
    # test_hop_priority_ranking_avoids_disconnection for that guarantee.
    result = extract_candidate_events(
        vbfa_graph, KNOWN_RICH_TARGET, max_events=8, min_events=3, max_hops=3
    )
    assert len(result.candidate_events) == 8
    assert result.hops_used == 3


def test_hop_priority_ranking_avoids_disconnection(vbfa_graph):
    # e977's traversal previously demonstrated a real disconnection bug: a
    # pure-recency ranking could keep events whose connecting (parent)
    # event got pruned. Ranking now prioritizes hop distance first (lower
    # hop = more causally proximate = ranked higher), which guarantees
    # every hop-1 event's parent is the target itself -- so bounding to
    # max_events can no longer orphan a kept event this way.
    result = extract_candidate_events(
        vbfa_graph, KNOWN_RICH_TARGET, max_events=8, min_events=3, max_hops=3
    )
    assert all(h == 1 for h in result.event_hops.values())
    assert not any("lost their connecting path" in w for w in result.warnings)
    assert result.total_discovered == 20  # full pool found within max_hops=3


def test_target_event_not_included_in_candidates(vbfa_graph):
    result = extract_candidate_events(vbfa_graph, KNOWN_RICH_TARGET, max_events=8)
    assert KNOWN_RICH_TARGET not in result.event_ids()


def test_event_hops_recorded_for_every_candidate(vbfa_graph):
    result = extract_candidate_events(vbfa_graph, KNOWN_RICH_TARGET, max_events=8)
    for e in result.candidate_events:
        assert e.event_id in result.event_hops
        assert result.event_hops[e.event_id] >= 1


def test_smaller_max_events_still_picks_most_recent(vbfa_graph):
    full = extract_candidate_events(vbfa_graph, KNOWN_RICH_TARGET, max_events=8)
    small = extract_candidate_events(vbfa_graph, KNOWN_RICH_TARGET, max_events=3)
    assert len(small.candidate_events) == 3
    # smaller max_events should be a strict prefix of the larger result's
    # ranking (most-recent-first, with event_id as a deterministic tie-break
    # for the many same-timestamp SAP batch events in this chain; the final
    # chronological re-sort is a no-op here since all these events share one
    # batch timestamp, so rank order survives into event_ids())
    assert small.event_ids() == full.event_ids()[:3]


def test_warning_emitted_when_below_min_events():
    log = load_ocel(SAMPLE)
    graph = ObjectCentricGraph(log)
    # the very first event chronologically has no prior events at all
    first_event = log.events[0]
    result = extract_candidate_events(graph, first_event.event_id, min_events=3, max_hops=2)
    assert len(result.candidate_events) < 3
    assert len(result.warnings) == 1
