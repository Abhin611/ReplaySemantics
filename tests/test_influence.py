"""Propagation analysis of a corrected scenario (replay_core/influence.py).

Every figure is re-derived here from the replay operator and the domain's own transfer functions, so the
report cannot drift from the engine.
"""
from decimal import Decimal

import pytest

from policy_engine.benchmark.evaluate import load_truth
from policy_engine.benchmark.generator import generate_benchmark
from policy_engine.domain import _gather_inputs, transfer_function
from replay_core.benchmark_io import load_benchmark_case, load_benchmark_index, suggested_max_hops
from replay_core.confluence import ConfluenceChecker
from replay_core.scenario import run_scenario


@pytest.fixture(scope="module")
def root(tmp_path_factory):
    r = tmp_path_factory.mktemp("inf")
    generate_benchmark(r, seed=7, per_family=1, multihop=True)
    return r


@pytest.fixture(scope="module")
def deep_case(root):
    """The 3-hop POLICY_ORDERED multi-hop case and its order-sensitive nodes."""
    t = next(t for t in load_truth(root).values() if t["family"] == "multihop_policy_ordered" and t["required_hops"] == 3)
    lc = load_benchmark_case(root, t["case_id"], max_hops=suggested_max_hops(load_benchmark_index(root)[t["case_id"]]))
    cv = ConfluenceChecker.from_loaded(lc).check_case()
    return lc, cv


def _change(lc):
    ops = {n: lc.operator().ctx.type_of(n) for n in lc.operator().ctx.node_types}
    return sorted(n for n, t in ops.items() if t in ("gross_price", "discount", "tax"))


def test_every_step_delta_adds_up_to_the_total_change(deep_case):
    lc, cv = deep_case
    r = run_scenario(lc, cv, _change(lc))
    inf = r["influence"]
    assert sum(Decimal(s["delta_net"]) for s in inf["steps"]) == Decimal(r["selected"]["net"]) - Decimal(r["baseline"]["net"])
    assert [s["node_id"] for s in inf["steps"]] == list(r["selected_order"]) == inf["order"]


def test_stale_gaps_are_what_the_transfer_function_would_change(deep_case):
    lc, cv = deep_case
    r = run_scenario(lc, cv, _change(lc))
    op = lc.operator()
    res = op.replay(r["subset"], r["selected_order"])
    for st, step in zip(res.trace, r["influence"]["steps"]):
        cur = st.state_after.nodes
        for a in step["affects"]:
            new = transfer_function(a["node_id"], _gather_inputs(cur, a["node_id"], op.ctx), op.ctx)
            assert Decimal(a["gap"]) == Decimal(str(new[a["field"]])) - Decimal(str(cur[a["node_id"]][a["field"]])) != 0
            assert a["relation"] in ("stale", "pending", "not_in_change")


def test_influence_equals_difference_of_two_independent_replays(deep_case):
    lc, cv = deep_case
    r = run_scenario(lc, cv, _change(lc))
    op = lc.operator()
    assert r["influence"]["influence"], "a price, discount and tax change must have upstream/downstream pairs"
    for i in r["influence"]["influence"]:
        alone = op.replay((i["to"],), (i["to"],)).state.nodes[i["to"]][i["field"]]
        after = op.replay((i["from"], i["to"]), (i["from"], i["to"])).state.nodes[i["to"]][i["field"]]
        assert Decimal(i["delta"]) == Decimal(str(after)) - Decimal(str(alone))


def test_interaction_is_v_ab_minus_v_a_minus_v_b(deep_case):
    lc, cv = deep_case
    r = run_scenario(lc, cv, _change(lc))
    v = {t["key"]: Decimal(t["value"]) for t in r["shapley"]["coalition_table"]}
    for it in r["influence"]["interactions"]:
        a, b = it["a"], it["b"]
        key = lambda *x: ",".join(sorted(x))  # noqa: E731
        assert Decimal(it["synergy"]) == v[key(a, b)] - v[key(a)] - v[key(b)]
        assert it["kind"] in ("synergy", "overlap", "independent")


def test_effect_travels_across_hops_to_the_total(deep_case):
    lc, cv = deep_case
    r = run_scenario(lc, cv, _change(lc))
    levels = r["influence"]["hop_levels"]
    assert levels == sorted(levels, reverse=True) and max(levels) >= 3 and min(levels) == 1  # hop 3 -> 2 -> 1
    deepest = max(r["influence"]["nodes"], key=lambda n: n["hop"] or 0)
    assert deepest["hop"] >= 3 and deepest["role"] == "corrected"


def test_blocked_change_still_explains_but_withholds_shapley(root):
    t = next(t for t in load_truth(root).values() if t["family"] == "multihop_non_confluent")
    lc = load_benchmark_case(root, t["case_id"], max_hops=suggested_max_hops(load_benchmark_index(root)[t["case_id"]]))
    cv = ConfluenceChecker.from_loaded(lc).check_case()
    op = lc.operator()
    nodes = sorted(n for n in op.ctx.node_types if op.ctx.type_of(n) in ("gross_price", "discount"))
    r = run_scenario(lc, cv, nodes)
    assert r["exploratory"] and r["shapley"]["status"] == "withheld"
    assert r["influence"]["steps"] and all(n["shapley"] is None for n in r["influence"]["nodes"])
