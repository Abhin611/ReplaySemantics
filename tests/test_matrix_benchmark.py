"""Benchmark v2: the 54-case matrix (resolution class x hops x policy)."""
import json
from collections import Counter

import pytest

from policy_engine.benchmark import generator as gen
from policy_engine.benchmark.evaluate import SealError, load_truth, score_case
from replay_core.benchmark_io import load_benchmark_index
from replay_core.run_case import run_case


@pytest.fixture(scope="module")
def root(tmp_path_factory):
    r = tmp_path_factory.mktemp("matrix")
    gen.generate_matrix_benchmark(r, seed=7)
    return r


@pytest.fixture(scope="module")
def truth(root):
    return load_truth(root)


def test_54_cases_and_quotas(root, truth):
    m = json.loads((root / "manifest.json").read_text())
    q = m["quotas"]
    assert m["num_cases"] == len(truth) == 54 and m["design"] == "matrix"
    assert q["by_class"] == {"DIRECT_FIX": 4, "SWAP_ONLY": 10, "MULTI_EDIT_ONLY": 14, "BOTH": 26}
    assert q["by_hops"] == {"1": 4, "2": 20, "3": 21, "4": 6, "5": 3}
    assert q["blocked"] == 9 and q["by_policy"]["P-2026-Q3-002"] == 5 and q["by_policy"]["P-2026-Q3-003"] == 4
    assert q["by_class"]["SWAP_ONLY"] >= 7 and q["by_class"]["MULTI_EDIT_ONLY"] >= 10 and q["by_class"]["BOTH"] >= 15


def test_class_hops_matrix_matches_the_design(truth):
    cell = Counter((t["design"]["class"], t["design"]["hops"]) for t in truth.values())
    assert cell == Counter({("SWAP_ONLY", 2): 4, ("SWAP_ONLY", 3): 3, ("SWAP_ONLY", 4): 2, ("SWAP_ONLY", 5): 1,
                            ("MULTI_EDIT_ONLY", 2): 5, ("MULTI_EDIT_ONLY", 3): 6, ("MULTI_EDIT_ONLY", 4): 2,
                            ("MULTI_EDIT_ONLY", 5): 1, ("BOTH", 2): 11, ("BOTH", 3): 12, ("BOTH", 4): 2,
                            ("BOTH", 5): 1, ("DIRECT_FIX", 1): 4})


def test_blocked_split_by_class_and_policy(truth):
    blocked = [t for t in truth.values() if t["design"]["blocked"]]
    assert Counter(t["design"]["class"] for t in blocked) == {"SWAP_ONLY": 3, "BOTH": 6}
    assert all(t["classification"] == "BLOCKED" for t in blocked)
    assert not any(t["classification"] == "BLOCKED" for t in truth.values() if not t["design"]["blocked"])
    assert Counter(t["design"]["policy"] for t in blocked) == {"P-2026-Q3-002": 5, "P-2026-Q3-003": 4}


def test_every_class_has_the_loss_origin_it_claims(truth):
    for t in truth.values():
        lg, c = t["ledger"], t["design"]["class"]
        inputs, stale = float(lg["loss_from_inputs"]), float(lg["loss_from_stale_amounts"])  # truth amounts are strings
        if c == "SWAP_ONLY":
            assert inputs == 0 and stale > 0 and lg["swappable_pairs"]
        if c == "BOTH":
            assert inputs > 0 and stale > 0 and lg["swappable_pairs"]
        if c in ("MULTI_EDIT_ONLY", "DIRECT_FIX"):
            assert not lg["swappable_pairs"]
        if c == "DIRECT_FIX":
            assert len(lg["posted_nodes"]) == 1 and inputs == 0


def test_depth_is_the_deepest_correctable_event(root, truth):
    index = load_benchmark_index(root)
    for cid, t in truth.items():
        assert t["required_hops"] == t["design"]["hops"] == index[cid]["suggested_max_hops"]


def test_no_fixed_event_cap_deep_graphs_are_deep_not_wide(truth):
    assert max(len(t["candidate_event_ids"]) for t in truth.values()) >= 8  # 5-hop cases
    assert max(len(t["active_event_ids"]) for t in truth.values()) <= 7     # oracle soft cap (active nodes only)


def test_public_files_hold_no_truth(root):
    blob = (root / "public" / "cases.json").read_text()
    for forbidden in ("resolution_class", "swappable", "family", "classification", "ledger", "design", "shapley"):
        assert forbidden not in blob


def test_system_matches_sealed_truth_on_all_54(root, truth):
    for cid, t in truth.items():
        run = run_case(root, cid)  # explicit: the depth the public log suggests, so the set is complete
        assert run.loaded.limits["complete"], cid
        s = score_case(t, run.prediction)
        assert s["classification_correct"] and not s["false_attribution"], (cid, s)
        assert float(s.get("max_abs_coalition_error", 0)) < 0.001 and float(s.get("max_abs_shapley_error", 0)) < 0.001


def test_generation_is_deterministic_and_clears_old_files(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    gen.generate_matrix_benchmark(a, 7)
    (b / "public").mkdir(parents=True)
    (b / "public" / "stale.jsonocel").write_text("{}")
    gen.generate_matrix_benchmark(b, 7)
    assert not (b / "public" / "stale.jsonocel").exists()
    assert (a / "hidden" / "truth.json").read_bytes() == (b / "hidden" / "truth.json").read_bytes()


def test_quota_check_fails_loudly():
    with pytest.raises(RuntimeError, match="quotas missed"):
        gen.check_quotas([{"design": {"class": "BOTH", "hops": 2, "policy": gen.P1, "blocked": False}}])


def test_seal_is_line_ending_independent(root):
    p = root / "hidden" / "truth.json"
    p.write_bytes(p.read_bytes().replace(b"\n", b"\r\n"))  # what a Windows checkout does
    load_truth(root)
    p.write_bytes(p.read_bytes().replace(b"\r\n", b"\n"))
    p.write_bytes(p.read_bytes() + b" ")
    with pytest.raises(SealError):
        load_truth(root)
    p.write_bytes(p.read_bytes()[:-1])
