from pathlib import Path

import pytest

from replay_core.graph import ObjectCentricGraph
from replay_core.ingestion import load_ocel

SAMPLE = Path(__file__).parent.parent / "data" / "raw" / "ocel20_example.jsonocel"
VBFA_OCEL = Path(__file__).parent.parent / "data" / "raw" / "vbfa_o2c_2019_2021_eur.jsonocel"


@pytest.fixture(scope="module")
def sample_graph():
    log = load_ocel(SAMPLE)
    return ObjectCentricGraph(log), log


def test_graph_node_counts_match_log(sample_graph):
    graph, log = sample_graph
    assert graph.num_event_nodes() == len(log.events)
    assert graph.num_object_nodes() == len(log.objects)


def test_objects_of_event_matches_model(sample_graph):
    graph, log = sample_graph
    event = log.events[0]
    assert set(graph.objects_of_event(event.event_id)) == event.object_ids()


def test_events_of_object_is_chronological(sample_graph):
    graph, log = sample_graph
    any_oid = next(iter(log.objects))
    eids = graph.events_of_object(any_oid)
    timestamps = [graph.get_event(eid).timestamp for eid in eids]
    assert timestamps == sorted(timestamps)


def test_events_before_excludes_target_and_later_events(sample_graph):
    graph, log = sample_graph
    any_oid = next(iter(log.objects))
    all_events = graph.events_of_object(any_oid)
    if len(all_events) < 2:
        pytest.skip("need an object touched by 2+ events for this check")
    mid_event = graph.get_event(all_events[len(all_events) // 2])
    before = graph.events_before(any_oid, before_ts=mid_event.timestamp, strict=True)
    assert mid_event.event_id not in before
    for eid in before:
        assert graph.get_event(eid).timestamp < mid_event.timestamp


def test_unknown_event_id_raises(sample_graph):
    graph, _ = sample_graph
    with pytest.raises(KeyError):
        graph.objects_of_event("nonexistent-event")


def test_unknown_object_id_raises(sample_graph):
    graph, _ = sample_graph
    with pytest.raises(KeyError):
        graph.events_of_object("nonexistent-object")


@pytest.mark.skipif(not VBFA_OCEL.exists(), reason="VBFA-derived OCEL2 file not built yet")
def test_graph_builds_on_large_dataset():
    log = load_ocel(VBFA_OCEL)
    graph = ObjectCentricGraph(log)
    assert graph.num_event_nodes() == len(log.events)
    assert graph.num_object_nodes() == len(log.objects)
