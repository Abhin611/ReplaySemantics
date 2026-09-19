from pathlib import Path

import pytest

from replay_core.candidate_extraction import extract_candidate_events
from replay_core.constraint_extraction import (
    ConstraintExtractionResult,
    PermutablePair,
    StructuralConstraint,
    export_constraints,
    extract_constraints,
)
from replay_core.graph import ObjectCentricGraph
from replay_core.ingestion import load_ocel

VBFA_OCEL = Path(__file__).parent.parent / "data" / "raw" / "vbfa_o2c_2019_2021_eur.jsonocel"
KNOWN_RICH_TARGET = "e977"


@pytest.fixture(scope="module")
def vbfa_graph():
    if not VBFA_OCEL.exists():
        pytest.skip("VBFA-derived OCEL2 file not built yet")
    log = load_ocel(VBFA_OCEL)
    return ObjectCentricGraph(log)


@pytest.fixture(scope="module")
def rich_extraction(vbfa_graph):
    return extract_candidate_events(vbfa_graph, KNOWN_RICH_TARGET, max_events=8, max_hops=3)


def test_every_pair_classified_exactly_once(rich_extraction):
    result = extract_constraints(rich_extraction)
    n = len(rich_extraction.candidate_events) + 1  # + target
    expected_pairs = n * (n - 1) // 2
    assert len(result.constraints) + len(result.permutable_pairs) == expected_pairs


def test_structural_constraints_are_earlier_before_later(rich_extraction):
    result = extract_constraints(rich_extraction)
    all_events = {e.event_id: e for e in rich_extraction.candidate_events}
    all_events[rich_extraction.target_event.event_id] = rich_extraction.target_event
    for c in result.constraints:
        assert all_events[c.before_event_id].timestamp <= all_events[c.after_event_id].timestamp


def test_structural_constraints_share_the_tagged_object_when_one_is_given(rich_extraction):
    # target_precedence constraints may have shared_object_id == None (the
    # candidate can be several hops from the target with no direct object
    # in common) -- only check the tag when one was actually recorded.
    result = extract_constraints(rich_extraction)
    all_events = {e.event_id: e for e in rich_extraction.candidate_events}
    all_events[rich_extraction.target_event.event_id] = rich_extraction.target_event
    for c in result.constraints:
        if c.shared_object_id is None:
            continue
        before_objs = all_events[c.before_event_id].object_ids()
        after_objs = all_events[c.after_event_id].object_ids()
        assert c.shared_object_id in before_objs
        assert c.shared_object_id in after_objs


def test_every_candidate_is_constrained_against_the_target(rich_extraction):
    # The bug this test guards against: a candidate with no direct shared
    # object with the target (e.g. several hops upstream) must still come
    # back as a target_precedence constraint, never as a permutable pair --
    # the target is the fixed endpoint of the whole analysis by
    # construction, regardless of whether a direct object link exists.
    result = extract_constraints(rich_extraction)
    target_id = rich_extraction.target_event.event_id

    constrained_against_target = {
        c.before_event_id
        for c in result.constraints
        if c.after_event_id == target_id and c.reason == "target_precedence"
    }
    for e in rich_extraction.candidate_events:
        assert e.event_id in constrained_against_target

    # and never appearing as target's partner in a permutable pair
    for p in result.permutable_pairs:
        assert target_id not in (p.event_id_a, p.event_id_b)


def test_permutable_pairs_share_no_distinguishing_object():
    # Two synthetic non-target events on disjoint objects must always be
    # permutable, regardless of timestamp -- there is no shared object to
    # order them by, and neither one is the target.
    from datetime import datetime

    from replay_core.candidate_extraction import CandidateExtractionResult
    from replay_core.models import E2ORelation, OCELEvent

    target = OCELEvent(
        event_id="target",
        activity="Invoice",
        timestamp=datetime(2021, 1, 3),
        related_objects=(E2ORelation("target", "obj_shared", "involves"),),
    )
    e1 = OCELEvent(
        event_id="e1",
        activity="GR Posting",
        timestamp=datetime(2021, 1, 1),
        related_objects=(E2ORelation("e1", "obj_a", "involves"),),
    )
    e2 = OCELEvent(
        event_id="e2",
        activity="IR Receipt",
        timestamp=datetime(2021, 1, 2),
        related_objects=(E2ORelation("e2", "obj_b", "involves"),),
    )
    extraction = CandidateExtractionResult(
        target_event=target,
        candidate_events=[e1, e2],
        touched_objects={"obj_shared", "obj_a", "obj_b"},
        hops_used=1,
    )
    result = extract_constraints(extraction)
    assert PermutablePair("e1", "e2") in result.permutable_pairs
    assert not any(
        {c.before_event_id, c.after_event_id} == {"e1", "e2"} for c in result.constraints
    )


def test_candidate_with_no_shared_object_with_target_is_still_constrained():
    # This is exactly the e33/e34 scenario reported against the real
    # dataset: e33 shares no object directly with the target (e34), only
    # with an intermediate candidate (e32). Before the fix, this meant
    # e33/e34 was classified as "permutable" -- which is wrong, since
    # treating the target as swappable with an upstream event would mean
    # the realized loss becomes an input rather than the outcome.
    from datetime import datetime

    from replay_core.candidate_extraction import CandidateExtractionResult
    from replay_core.models import E2ORelation, OCELEvent

    target = OCELEvent(
        event_id="e34",
        activity="Create Invoice",
        timestamp=datetime(2021, 1, 3),
        related_objects=(E2ORelation("e34", "obj_order", "involves"),),
    )
    e32 = OCELEvent(
        event_id="e32",
        activity="Create Goods Movement",
        timestamp=datetime(2021, 1, 1),
        related_objects=(E2ORelation("e32", "obj_order", "involves"),),
    )
    e33 = OCELEvent(
        event_id="e33",
        activity="Create Goods Movement",
        timestamp=datetime(2021, 1, 2),
        related_objects=(E2ORelation("e33", "obj_delivery", "involves"),),
    )
    extraction = CandidateExtractionResult(
        target_event=target,
        candidate_events=[e32, e33],
        touched_objects={"obj_order", "obj_delivery"},
        hops_used=2,
    )
    result = extract_constraints(extraction)

    e33_e34 = next(
        c for c in result.constraints if {c.before_event_id, c.after_event_id} == {"e33", "e34"}
    )
    assert e33_e34.before_event_id == "e33"
    assert e33_e34.after_event_id == "e34"
    assert e33_e34.reason == "target_precedence"
    assert e33_e34.shared_object_id is None  # no direct object in common -- lock still holds

    assert not any(
        {p.event_id_a, p.event_id_b} == {"e33", "e34"} for p in result.permutable_pairs
    )


def test_same_timestamp_on_shared_object_is_permutable_not_guessed():
    # Same shared object, identical timestamp (e.g. one SAP batch commit),
    # neither event is the target: the log genuinely can't tell us which
    # happened first, so this must stay permutable rather than picking an
    # arbitrary winner.
    from datetime import datetime

    from replay_core.candidate_extraction import CandidateExtractionResult
    from replay_core.models import E2ORelation, OCELEvent

    ts = datetime(2021, 1, 1, 10, 0, 0)
    target = OCELEvent(
        event_id="target",
        activity="Invoice",
        timestamp=datetime(2021, 1, 2),
        related_objects=(E2ORelation("target", "obj_x", "involves"),),
    )
    e1 = OCELEvent(
        event_id="e1", activity="A", timestamp=ts,
        related_objects=(E2ORelation("e1", "obj_x", "involves"),),
    )
    e2 = OCELEvent(
        event_id="e2", activity="B", timestamp=ts,
        related_objects=(E2ORelation("e2", "obj_x", "involves"),),
    )
    extraction = CandidateExtractionResult(
        target_event=target, candidate_events=[e1, e2],
        touched_objects={"obj_x"}, hops_used=1,
    )
    result = extract_constraints(extraction)
    assert PermutablePair("e1", "e2") in result.permutable_pairs


def test_export_constraints_writes_expected_files(tmp_path, rich_extraction):
    result = extract_constraints(rich_extraction)
    paths = export_constraints(result, tmp_path)
    assert paths["given_constraints"].exists()
    assert paths["permutable_pairs"].exists()

    import json

    payload = json.loads(paths["given_constraints"].read_text())
    assert payload["target_event_id"] == KNOWN_RICH_TARGET
    assert "given_constraints" in payload
    if payload["given_constraints"]:
        entry = payload["given_constraints"][0]
        assert set(entry.keys()) == {"before", "after", "shared_object", "reason"}
