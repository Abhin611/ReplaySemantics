"""'Run change': replay one order-sensitive pair and compare with the previous case."""
from decimal import Decimal
from pathlib import Path

import pytest

from replay_core.benchmark_io import load_benchmark_index
from replay_core.confluence import ConfluenceChecker, transitive_closure
from replay_core.run_case import run_case
from replay_core.scenario import MAX_SCENARIO_EVENTS, ScenarioError, run_scenario
from policy_engine.loss import loss as loss_of


@pytest.fixture(scope="module")
def runs(bench_root):
    from replay_core.run_case import run_all
    return {r.case_id: r for r in run_all(bench_root)}


def _pairs(run, status):
    out = []
    for sv in run.verdict.subsets.values():
        if len(sv.subset) == 2 and sv.verdict == status:
            out.append(sv.subset)
    return out


def _first(runs, status):
    for r in runs.values():
        ps = _pairs(r, status)
        if ps:
            return r, ps[0]
    pytest.skip(f"fixture has no {status} pair")


def test_policy_ordered_pair_headline_is_the_authoritative_order(runs):
    run, pair = _first(runs, "POLICY_ORDERED")
    s = run_scenario(run.loaded, run.verdict, pair)
    assert s["subset_verdict"] == "POLICY_ORDERED" and not s["exploratory"]
    assert s["selected_order"] == s["authoritative_order"]
    assert not s["orders_agree"] and Decimal(s["order_spread"]) > 0
    sel = s["selected"]
    assert sel["authoritative"]
    # the headline numbers are the checker's v(S) and the operator's own replay
    assert Decimal(sel["value"]) == run.verdict.subsets[s["key"]].value
    op = run.loaded.operator()
    res = op.replay(pair, s["authoritative_order"])
    assert Decimal(sel["net"]) == res.net and Decimal(sel["loss"]) == res.loss
    # deltas are against the PREVIOUS (observed) case
    assert Decimal(sel["delta_net"]) == res.net - op.observed_net
    assert Decimal(sel["delta_loss"]) == res.loss - op.observed_loss
    assert Decimal(sel["value"]) == -Decimal(sel["delta_loss"])
    # at least one non-authoritative order exists and gives a different total
    others = [e for e in s["orders"] if not e["authoritative"]]
    assert others and all(e["net"] != sel["net"] for e in others)


def test_trace_steps_chain_to_the_final_total_and_loss(runs):
    run, pair = _first(runs, "POLICY_ORDERED")
    sel = run_scenario(run.loaded, run.verdict, pair)["selected"]
    tr = sel["trace"]
    assert [t["node_id"] for t in tr] == sel["order"]
    assert tr[-1]["net_after"] == sel["net"] and tr[-1]["loss_after"] == sel["loss"]
    assert sum(Decimal(t["delta_net"]) for t in tr) == Decimal(sel["delta_net"])
    assert sum(Decimal(t["delta_loss"]) for t in tr) == Decimal(sel["delta_loss"])
    roles = {n: e["role"] for n, e in sel["node_effects"].items()}
    assert all(roles[n] == "corrected" for n in sel["order"])


def test_shapley_within_change_is_efficient_for_valid_pairs(runs):
    run, pair = _first(runs, "POLICY_ORDERED")
    sh = run_scenario(run.loaded, run.verdict, pair)["shapley"]
    assert sh["status"] == "ok" and sh["efficient"] and sh["scope"] == "within_change"
    assert abs(sum(Decimal(v) for v in sh["values"].values()) - Decimal(sh["v_of_subset"])) < Decimal("0.001")


def test_blocked_pair_is_exploratory_with_no_authoritative_order_and_no_shapley(runs):
    run, pair = _first(runs, "BLOCKED")
    s = run_scenario(run.loaded, run.verdict, pair)
    assert s["exploratory"] and s["authoritative_order"] is None and s["note"]
    assert all(not e["authoritative"] for e in s["orders"])
    assert s["shapley"]["status"] == "withheld" and s["shapley"]["values"] is None
    assert len(s["orders"]) == 2  # both orders are still shown for comparison


def test_shapley_fn_is_not_called_when_a_sub_coalition_is_blocked(runs):
    run, pair = _first(runs, "BLOCKED")
    def boom(*a, **k):
        raise AssertionError("Shapley requested for a blocked change")
    assert run_scenario(run.loaded, run.verdict, pair, shapley_fn=boom)["shapley"]["status"] == "withheld"


def test_requested_order_is_headlined_but_authority_is_unchanged(runs):
    run, pair = _first(runs, "POLICY_ORDERED")
    base = run_scenario(run.loaded, run.verdict, pair)
    other = next(e["order"] for e in base["orders"] if not e["authoritative"])
    s = run_scenario(run.loaded, run.verdict, pair, other)
    assert s["selected_order"] == other and s["authoritative_order"] == base["authoritative_order"]
    assert not s["selected"]["authoritative"]


def test_invalid_changes_are_rejected(runs):
    run = next(iter(runs.values()))
    players = list(run.verdict.players)
    with pytest.raises(ScenarioError):
        run_scenario(run.loaded, run.verdict, [])
    with pytest.raises(ScenarioError):
        run_scenario(run.loaded, run.verdict, ["nope"])
    with pytest.raises(ScenarioError):
        run_scenario(run.loaded, run.verdict, [players[0], players[0]])
    if len(players) > MAX_SCENARIO_EVENTS:
        with pytest.raises(ScenarioError):
            run_scenario(run.loaded, run.verdict, players)


def test_order_that_contradicts_a_structural_lock_is_rejected(runs):
    for run in runs.values():
        locks = transitive_closure(run.loaded.policy.structural_pairs())
        pair = next(((a, b) for (a, b) in locks if a in run.verdict.players and b in run.verdict.players), None)
        if pair:
            a, b = pair
            ok = run_scenario(run.loaded, run.verdict, [a, b])
            assert [e["order"] for e in ok["orders"]] == [[a, b]]  # only one legitimate order
            with pytest.raises(ScenarioError):
                run_scenario(run.loaded, run.verdict, [a, b], [b, a])
            return
    pytest.skip("no locked pair in the fixture")


def test_scenario_never_opens_the_sealed_truth():
    import replay_core.scenario as sc
    assert "truth.json" not in Path(sc.__file__).read_text()


# ---- several pairs at once (a union of events) ----------------------------------------------
import itertools


def _pair_combos(run, min_pairs=2):
    pairs = sorted({tuple(p) for sv in run.verdict.subsets.values() for p in sv.disagreeing_pairs})
    for k in range(min_pairs, len(pairs) + 1):
        for combo in itertools.combinations(pairs, k):
            ev = sorted({e for p in combo for e in p})
            if len(ev) <= MAX_SCENARIO_EVENTS:
                yield combo, ev


def test_multi_pair_changes_agree_with_the_checker_on_every_fixture_case(runs):
    checked = 0
    for run in runs.values():
        for combo, ev in _pair_combos(run):
            s = run_scenario(run.loaded, run.verdict, ev)
            sv = run.verdict.subsets[s["key"]]
            assert s["subset_verdict"] == sv.verdict
            # groups partition the legitimate orders, and exactly one group holds the selected order
            assert sum(g["order_count"] for g in s["orders"]) == s["legit_order_count"]
            assert sum(g["contains_selected"] for g in s["orders"]) == 1
            if sv.verdict != "BLOCKED":
                assert s["selected"]["authoritative"] and Decimal(s["selected"]["value"]) == sv.value
                assert s["shapley"]["status"] == "ok" and s["shapley"]["efficient"]
                assert sum(g["authoritative"] for g in s["orders"]) == 1
            else:
                assert s["authoritative_order"] is None and s["shapley"]["status"] == "withheld"
                assert not any(g["authoritative"] for g in s["orders"])
            checked += 1
    assert checked > 0, "fixture must contain cases with at least two order-sensitive pairs"


def test_overlapping_pairs_count_a_shared_event_once(runs):
    for run in runs.values():
        for combo, ev in _pair_combos(run):
            events_listed = [e for p in combo for e in p]
            if len(events_listed) > len(ev):  # at least one event appears in two pairs
                s = run_scenario(run.loaded, run.verdict, ev)
                assert s["subset"] == ev and len(set(s["selected"]["order"])) == len(ev)
                return
    pytest.skip("no overlapping pairs in the fixture")


def test_orders_are_grouped_by_outcome_not_listed_one_by_one(runs):
    for run in runs.values():
        for combo, ev in _pair_combos(run):
            s = run_scenario(run.loaded, run.verdict, ev)
            if s["legit_order_count"] > len(s["orders"]):
                nets = [g["net"] for g in s["orders"]]
                assert len(nets) == len(set(nets)), "one entry per distinct total"
                assert any(g["order_count"] > 1 for g in s["orders"])
                return
    pytest.skip("no change in the fixture has two orders with the same total")


def test_the_selected_order_is_replayed_in_full_even_when_it_is_not_the_group_example(runs):
    for run in runs.values():
        for combo, ev in _pair_combos(run):
            base = run_scenario(run.loaded, run.verdict, ev)
            for g in base["orders"]:
                for ex in g["example_orders"]:
                    if ex != g["order"]:
                        s = run_scenario(run.loaded, run.verdict, ev, ex)
                        assert s["selected_order"] == ex and s["selected"]["order"] == ex
                        assert s["selected"]["net"] == g["net"] and s["selected"]["trace"][-1]["node_id"] == ex[-1]
                        return
    pytest.skip("no group with several example orders in the fixture")


def test_a_change_larger_than_the_cap_is_rejected(runs, monkeypatch):
    import replay_core.scenario as sc
    run = next(r for r in runs.values() if len(r.verdict.players) >= 3)
    monkeypatch.setattr(sc, "MAX_SCENARIO_EVENTS", 2)
    with pytest.raises(ScenarioError):
        sc.run_scenario(run.loaded, run.verdict, list(run.verdict.players)[:3])


def test_group_list_is_bounded(runs, monkeypatch):
    import replay_core.scenario as sc
    monkeypatch.setattr(sc, "MAX_ORDER_GROUPS", 1)
    for run in runs.values():
        for combo, ev in _pair_combos(run):
            s = sc.run_scenario(run.loaded, run.verdict, ev)
            if s["order_groups_total"] > 1:
                assert len(s["orders"]) == 1 and s["groups_truncated"] and s["orders"][0]["contains_selected"]
                return
    pytest.skip("no change with several distinct outcomes in the fixture")
