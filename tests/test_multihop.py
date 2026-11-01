"""Multi-hop benchmark cases (appended with generate_benchmark(..., multihop=True)).

The 140 standard cases need only 1 backward hop. Five extra cases chain events through linked documents so
their deepest correction events are reachable only after 2, 2, 3, 3 and 4 hops.
"""
import json

import pytest

from policy_engine.benchmark.evaluate import load_truth, score_case
from policy_engine.benchmark.generator import MULTIHOP_SPECS, generate_benchmark
from replay_core.benchmark_io import load_benchmark_case, load_benchmark_index, suggested_max_hops
from replay_core.confluence import transitive_closure
from replay_core.candidate_extraction import extract_candidate_events
from replay_core.run_case import run_case


@pytest.fixture(scope="module")
def mh_root(tmp_path_factory):
    root = tmp_path_factory.mktemp("mh")
    generate_benchmark(root, seed=7, per_family=1, multihop=True)
    return root


@pytest.fixture(scope="module")
def mh_truth(mh_root):
    return {cid: t for cid, t in load_truth(mh_root).items() if t["family"].startswith("multihop")}


def test_five_multihop_cases_with_required_depths(mh_truth):
    assert sorted(t["required_hops"] for t in mh_truth.values()) == [2, 2, 3, 3, 4]
    assert len(MULTIHOP_SPECS) == 5


def test_standard_cases_are_unchanged_by_the_option(tmp_path, mh_root):
    plain = tmp_path / "plain"
    generate_benchmark(plain, seed=7, per_family=1)
    a = json.loads((plain / "public" / "cases.json").read_text())["cases"]
    b = json.loads((mh_root / "public" / "cases.json").read_text())["cases"]
    assert b[: len(a)] == a and len(b) == len(a) + 5


def test_traversal_reaches_exactly_the_required_depth(mh_root, mh_truth):
    for cid, t in mh_truth.items():
        lc = load_benchmark_case(mh_root, cid, max_hops=suggested_max_hops(load_benchmark_index(mh_root)[cid]))
        assert max(lc.extraction.event_hops.values()) == t["required_hops"]
        assert len(lc.extraction.candidate_events) == len(t["candidate_event_ids"])  # nothing missed or extra


def test_extracted_locks_equal_the_generators_structure(mh_root, mh_truth):
    for cid, t in mh_truth.items():
        lc = load_benchmark_case(mh_root, cid, max_hops=suggested_max_hops(load_benchmark_index(mh_root)[cid]))
        # the loader stores locks transitively closed (a lock through a dropped event must still hold)
        assert {tuple(p) for p in lc.structural_pairs} == set(transitive_closure({tuple(p) for p in t["structural_pairs"]}))


def test_system_matches_sealed_truth_on_multihop_cases(mh_root, mh_truth):
    for cid, t in mh_truth.items():
        score = score_case(t, run_case(mh_root, cid).prediction)
        assert score["classification_correct"] and score["attribution_withheld_correctly"]
        assert not score["false_attribution"]
        assert float(score.get("max_abs_coalition_error", 0)) < 0.001
        assert float(score.get("max_abs_shapley_error", 0)) < 0.001


def test_stopping_one_hop_short_misses_the_deepest_event(mh_root, mh_truth):
    for cid, t in mh_truth.items():
        lc = load_benchmark_case(mh_root, cid, max_hops=suggested_max_hops(load_benchmark_index(mh_root)[cid]))
        short = extract_candidate_events(lc.graph, lc.extraction.target_event.event_id,
                                         max_hops=t["required_hops"] - 1, min_events=1)
        assert len(short.candidate_events) < len(lc.extraction.candidate_events)


def test_four_hop_case_needs_more_than_the_default_depth(mh_root, mh_truth):
    cid = next(c for c, t in mh_truth.items() if t["required_hops"] == 4)
    entry = json.loads((mh_root / "public" / "cases.json").read_text())["cases"]
    assert next(e for e in entry if e["case_id"] == cid)["max_hops"] == 4
    assert all("max_hops" not in e for e in entry if e["case_id"] != cid)


def test_order_sensitive_pairs_exist_at_depth(mh_root, mh_truth):
    """Cases with money on deep hops must offer a pair at hop >= 2 to select in the Pairs tab."""
    from replay_core.confluence import ConfluenceChecker
    for cid, t in mh_truth.items():
        if t["family"] in ("multihop_interaction", "multihop_redundancy"):
            continue  # additive adjustments: no order effect by design
        lc = load_benchmark_case(mh_root, cid, max_hops=suggested_max_hops(load_benchmark_index(mh_root)[cid]))
        cv = ConfluenceChecker.from_loaded(lc).check_case()
        hops = lc.extraction.event_hops
        sens = {tuple(p) for sv in cv.subsets.values() for p in sv.disagreeing_pairs}
        assert any(max(hops[a], hops[b]) >= 2 for a, b in sens), f"{cid}: no order-sensitive pair at depth"
