"""min_events / max_events / max_hops work on every case; nothing is dropped silently; partial results are flagged."""
import pytest
from fastapi.testclient import TestClient

from policy_engine.benchmark import generator as gen
from policy_engine.benchmark.evaluate import load_truth
from replay_core.benchmark_io import load_benchmark_case, load_benchmark_index
from replay_core.confluence import ConfluenceChecker, ConfluenceTooLarge, transitive_closure
from replay_core.ledger import analyse
from replay_core.limits import hop_profile


@pytest.fixture(scope="module")
def root(tmp_path_factory):
    r = tmp_path_factory.mktemp("limits")
    gen.generate_matrix_benchmark(r, seed=7)
    return r


@pytest.fixture(scope="module")
def truth(root):
    return load_truth(root)


def _case(truth, cls, hops, blocked=False):
    return next(c for c, t in truth.items() if t["design"]["class"] == cls and t["design"]["hops"] == hops
                and t["design"]["blocked"] == blocked)


def test_default_is_three_hops_and_no_event_cap(root, truth):
    cid = _case(truth, "BOTH", 5, blocked=True)
    lc = load_benchmark_case(root, cid)
    assert lc.limits["limits"] == {"min_events": 3, "max_events": None, "max_hops": 3}
    assert max(lc.extraction.event_hops.values()) <= 3
    assert not lc.limits["complete"] and lc.limits["suggestion"]["max_hops"] == 5


def test_the_stored_hint_is_never_applied_silently(root, truth):
    cid = _case(truth, "SWAP_ONLY", 5)
    assert load_benchmark_index(root)[cid]["suggested_max_hops"] == 5
    assert max(load_benchmark_case(root, cid).extraction.event_hops.values(), default=0) <= 3


@pytest.mark.parametrize("hops", [1, 2, 3, 4, 5, 6])
def test_hops_sweep_every_case_is_complete_exactly_when_deep_enough(root, truth, hops):
    for cid, t in truth.items():
        lc = load_benchmark_case(root, cid, max_hops=hops)
        assert lc.limits["complete"] == (hops >= t["required_hops"]), (cid, hops)
        assert max(lc.extraction.event_hops.values(), default=0) <= hops


def test_event_cap_sweep_never_drops_silently(root, truth):
    cid = _case(truth, "BOTH", 5, blocked=True)
    total = len(load_benchmark_case(root, cid, max_hops=5).extraction.candidate_events)
    for cap in range(1, total + 2):
        lc = load_benchmark_case(root, cid, max_events=cap, max_hops=5)
        kept, dropped = lc.extraction.event_ids(), [d["event_id"] for d in lc.limits["dropped"]]
        assert len(kept) == min(cap, total) and len(kept) + len(dropped) == total
        assert set(kept).isdisjoint(dropped)
        assert lc.limits["complete"] == all(not d["active"] for d in lc.limits["dropped"])
        if not lc.limits["complete"]:
            assert any(f"max_events={cap}" in r or "gap" in r for r in lc.limits["partial_reasons"])


def test_locks_survive_a_dropped_middle_event(root, truth):
    cid = _case(truth, "MULTI_EDIT_ONLY", 5)  # R <- T <- D chain, price deep
    full = load_benchmark_case(root, cid, max_hops=5)
    full_locks = transitive_closure({tuple(p) for p in full.structural_pairs})
    for cap in range(2, len(full.extraction.candidate_events)):
        lc = load_benchmark_case(root, cid, max_events=cap, max_hops=5)
        kept = set(lc.extraction.event_ids()) | {lc.entry["target_event_id"]}
        want = {p for p in full_locks if p[0] in kept and p[1] in kept}
        assert {tuple(p) for p in lc.structural_pairs} == want


def test_analysis_marks_partial_and_still_answers(root, truth):
    cid = _case(truth, "BOTH", 5, blocked=True)
    shallow = analyse(load_benchmark_case(root, cid, max_hops=3))
    full = analyse(load_benchmark_case(root, cid, max_hops=5))
    assert not shallow["complete"] and full["complete"]
    assert any("deeper than max_hops=3" in r for r in shallow["limits"]["partial_reasons"])
    assert "PARTIAL" in shallow["description"]["text"][-1] and "PARTIAL" not in " ".join(full["description"]["text"])


def test_min_events_only_warns(root, truth, caplog):
    cid = _case(truth, "DIRECT_FIX", 1)
    lc = load_benchmark_case(root, cid, min_events=50)
    assert lc.extraction.candidate_events and lc.limits["limits"]["min_events"] == 50


def test_hop_profile_comes_from_the_public_log(root, truth):
    cid = _case(truth, "SWAP_ONLY", 4)
    lc = load_benchmark_case(root, cid, max_hops=5)
    prof = hop_profile(lc.graph, lc.entry["target_event_id"])
    assert prof["deepest_active_hop"] == 4 and prof["total_events"] == len(lc.extraction.candidate_events)
    assert prof["rows"][-1]["cumulative_events"] == prof["total_events"]


def test_exponential_guard_is_a_clear_error_not_a_hang(root, truth, monkeypatch):
    lc = load_benchmark_case(root, _case(truth, "BOTH", 3), max_hops=3)
    monkeypatch.setattr(ConfluenceChecker, "MAX_PLAYERS", 1)
    with pytest.raises(ConfluenceTooLarge, match="correctable events"):
        ConfluenceChecker.from_loaded(lc).check_case()


# ---- API ----------------------------------------------------------------------------------------
@pytest.fixture(scope="module")
def client(root):
    from api import app as m
    m.BENCHMARK_DIR = root
    m._load_benchmark_case_cached.cache_clear(); m._checked_case_cached.cache_clear(); m._analysis_cached.cache_clear()
    return TestClient(m.app)


def test_api_limits_apply_to_benchmark_cases_and_are_part_of_the_cache_key(client, truth):
    cid = _case(truth, "BOTH", 5, blocked=True)
    a3 = client.get(f"/api/cases/{cid}/analysis?max_hops=3").json()
    a5 = client.get(f"/api/cases/{cid}/analysis?max_hops=5").json()
    assert not a3["complete"] and a5["complete"] and a3["limits"]["limits"]["max_hops"] == 3
    r = client.get(f"/api/cases/{cid}/replay?max_hops=5&max_events=4").json()
    assert r["limits"]["limits"]["max_events"] == 4 and r["limits"]["dropped"]
    assert client.get(f"/api/cases/{cid}/hops").json()["suggested_max_hops"] == 5


def test_api_class_chips_and_new_endpoints(client, truth):
    rows = client.get("/api/benchmark/cases").json()["cases"]
    assert len(rows) == 60 and all(r["resolution_class"] and r["hops"] for r in rows)
    cid = _case(truth, "SWAP_ONLY", 2)
    a = client.get(f"/api/cases/{cid}/analysis").json()
    a_, b_ = a["pairs"][0]["pair"]
    pr = client.get(f"/api/cases/{cid}/pair", params={"a": a_, "b": b_})
    assert pr.status_code == 200 and len(pr.json()["orders"]) == 2
    assert client.get(f"/api/cases/{cid}/pair", params={"a": a_, "b": a_}).status_code == 422
    ch = client.post(f"/api/cases/{cid}/change", json={"swap": a["pairs"][0]["pair"], "sequence": "swap_first"})
    assert ch.status_code == 200 and len(ch.json()["runs"]) == 1
    assert client.post(f"/api/cases/{cid}/change", json={}).status_code == 422
