"""Phase 3: end-to-end runner, naive baselines and the scored benchmark harness."""
from decimal import Decimal
from fractions import Fraction

import pytest

from policy_engine.benchmark.evaluate import load_truth, score_case
from replay_core.baselines import naive_sequential, naive_split
from replay_core.benchmark_io import load_benchmark_index
from replay_core.benchmark_run import run_benchmark
from replay_core.run_case import provisional_shapley, run_all, run_case
from replay_core.replay import subset_key


@pytest.fixture(scope="module")
def runs(bench_root):
    return {r.case_id: r for r in run_all(bench_root)}


def test_runs_every_case(bench_root, runs):
    assert set(runs) == set(load_benchmark_index(bench_root))


def test_every_prediction_matches_sealed_truth(bench_root, runs):
    truth = load_truth(bench_root)
    for cid, run in runs.items():
        res = score_case(truth[cid], run.prediction)
        assert res["classification_correct"], cid
        assert res["attribution_withheld_correctly"], cid
        assert not res["false_attribution"], cid
        assert Decimal(res.get("max_abs_shapley_error", "0")) <= Decimal("0.001"), cid
        assert Decimal(res.get("max_abs_coalition_error", "0")) <= Decimal("0.001"), cid


def test_blocked_cases_never_get_a_shapley(runs):
    blocked = [r for r in runs.values() if r.verdict.classification == "BLOCKED"]
    assert blocked, "fixture must contain BLOCKED cases"
    for r in blocked:
        assert r.shapley is None and r.prediction["shapley"] is None


def test_shapley_fn_is_never_called_for_blocked(bench_root, runs):
    blocked = next(r.case_id for r in runs.values() if r.verdict.classification == "BLOCKED")
    def boom(*a, **k):
        raise AssertionError("Shapley requested for a BLOCKED case")
    assert run_case(bench_root, blocked, shapley_fn=boom).shapley is None


def test_provisional_shapley_is_efficient_and_symmetric():
    v = {"": Decimal(0), "a": Decimal(0), "b": Decimal(0), "a,b": Decimal("184500")}
    phi = provisional_shapley(["a", "b"], v)  # the proposal's worked example
    assert phi == {"a": Decimal("92250.000000"), "b": Decimal("92250.000000")}


def test_shapley_efficiency_on_real_cases(runs):
    for r in runs.values():
        if r.shapley is None:
            continue
        total = sum(Fraction(x) for x in r.shapley.values())
        vE = Fraction(r.verdict.coalition_values()[subset_key(r.verdict.players)])
        assert abs(total - vE) <= Fraction(1, 10**4), r.case_id


def test_baselines_are_ungated(bench_root, runs):
    """Naive baselines always issue numbers, including for BLOCKED cases; that is the point."""
    truth = load_truth(bench_root)
    saw_blocked = False
    for cid, run in runs.items():
        op = run.loaded.operator()
        for pred in (naive_sequential(op), naive_split(op)):
            assert pred["shapley"] is not None and pred["classification"] == "PASS"
            if truth[cid]["classification"] == "BLOCKED":
                saw_blocked = True
                assert score_case(truth[cid], pred)["false_attribution"]
    assert saw_blocked


def test_benchmark_report_headline(bench_root):
    m = run_benchmark(bench_root)["metrics"]
    rs = m["replaysemantics"]
    assert rs["classification_accuracy"] == 1.0
    assert rs["false_attribution_rate"] == 0.0 and rs["invalid_rejection"] == 1.0
    assert m["naive_sequential"]["invalid_rejection"] == 0.0
    assert m["naive_sequential"]["false_attribution_rate"] > rs["false_attribution_rate"]
    assert m["naive_split"]["false_attribution_rate"] > rs["false_attribution_rate"]
