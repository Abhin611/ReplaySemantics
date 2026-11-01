"""A swap changes the order and nothing else (replay_core/swap.py).

The rule: every input keeps its recorded value, the order that was posted reproduces the books, and a value only moves when
another order (or the user's Edit) makes it move.
"""
from decimal import Decimal
from itertools import combinations, permutations
from pathlib import Path

import pytest

from policy_engine import compute_net
from policy_engine.benchmark.generator import generate_benchmark
from policy_engine.domain import DISCOUNT, ROUNDING, TAX
from replay_core.benchmark_io import load_benchmark_case, load_benchmark_index
from replay_core.ledger import analyse, ledger_view, run_change, run_pair
from replay_core.scenario import run_scenario
from replay_core.swap import DERIVED_FIELD, SwapOperator, swap_state

BENCHMARK = Path(__file__).resolve().parents[1] / "data" / "benchmark"


@pytest.fixture(scope="module")
def root(tmp_path_factory):
    r = tmp_path_factory.mktemp("swap")
    generate_benchmark(r, seed=7, per_family=2, multihop=True)
    return r


def _lc(root, cid):
    return load_benchmark_case(root, cid, max_events=None, min_events=1, max_hops=10)


def _posted(lc):
    ctx = lc.model.ctx
    return [n for n in ctx.active_nodes() if ctx.type_of(n) in (DISCOUNT, TAX, ROUNDING) and n not in ctx.reference.exceptions]


def _inputs(state, ctx):
    return {n: {k: v for k, v in a.items() if k != DERIVED_FIELD.get(ctx.type_of(n))} for n, a in state.nodes.items()}


def _amounts(state, ctx):
    return {n: Decimal(str(state.nodes[n][f])) for n, f in ((n, DERIVED_FIELD.get(ctx.type_of(n))) for n in state.nodes) if f}


def test_the_posted_order_reproduces_the_books_on_every_case(root):
    for cid in load_benchmark_index(root):
        lc = _lc(root, cid)
        ctx, X = lc.model.ctx, lc.model.observed
        for r in range(1, len(_posted(lc)) + 1):
            for sub in combinations(_posted(lc), r):
                out = swap_state(X, ctx.stage_sorted(sub), ctx)
                assert _amounts(out, ctx) == _amounts(X, ctx), (cid, sub)
                assert compute_net(out, ctx) == compute_net(X, ctx)


def test_only_tax_before_a_discount_moves_a_value(root):
    for cid in load_benchmark_index(root):
        lc = _lc(root, cid)
        ctx, X = lc.model.ctx, lc.model.observed
        for order in permutations(_posted(lc)[:4]):
            seen_tax, moves = False, False
            for n in order:
                seen_tax = seen_tax or ctx.type_of(n) == TAX
                moves = moves or (seen_tax and ctx.type_of(n) == DISCOUNT)
            if not moves:
                assert _amounts(swap_state(X, order, ctx), ctx) == _amounts(X, ctx), (cid, order)


def test_case_40_rounding_first_keeps_its_recorded_value():
    lc = load_benchmark_case(BENCHMARK, "RSC-2026-00040", max_events=None, min_events=1, max_hops=10)
    ctx, X = lc.model.ctx, lc.model.observed
    for order in (["e5", "e3"], ["e5", "e4"], ["e5", "e3", "e4"], ["e3", "e5", "e4"]):
        assert _amounts(swap_state(X, order, ctx), ctx) == _amounts(X, ctx), order
    # rounding after a discount the order DID move has a reason to change, and only then
    moved = swap_state(X, ["e4", "e3", "e5"], ctx)
    assert moved.nodes["e4"]["amount"] == X.nodes["e4"]["amount"] and moved.nodes["e3"]["amount"] != X.nodes["e3"]["amount"]
    assert moved.nodes["e5"]["adj"] != X.nodes["e5"]["adj"]
    assert swap_state(X, ["e4", "e5", "e3"], ctx).nodes["e5"]["adj"] == X.nodes["e5"]["adj"]  # it ran before e3: it stays


def test_no_order_ever_changes_a_recorded_input(root):
    for cid in load_benchmark_index(root):
        lc = _lc(root, cid)
        ctx, X = lc.model.ctx, lc.model.observed
        posted = _posted(lc)
        assert _inputs(swap_state(X, list(reversed(ctx.stage_sorted(posted))), ctx), ctx) == _inputs(X, ctx), cid


def test_the_console_and_analysis_show_the_original_graph_and_the_compliant_total_stays():
    lc = load_benchmark_case(BENCHMARK, "RSC-2026-00040", max_events=None, min_events=1, max_hops=10)
    a = analyse(lc)
    assert Decimal(a["totals"]["posted_total"]) == Decimal("906570")
    assert Decimal(a["totals"]["compliant_total"]) == Decimal("1018904.97")  # the pipeline itself did not change
    e3e4 = next(o for p in a["pairs"] if p["pair"] == ["e3", "e4"] for o in p["orders"] if o["order"] == ["e3", "e4"])
    e4e3 = next(o for p in a["pairs"] if p["pair"] == ["e3", "e4"] for o in p["orders"] if o["order"] == ["e4", "e3"])
    assert Decimal(e3e4["net"]) == Decimal("906570") and Decimal(e4e3["net"]) != Decimal("906570")
    run = run_pair(lc, "e3", "e4")
    assert Decimal(run["start_total"]) == Decimal("906570")
    other = next(o for o in run["orders"] if o["order"] == ["e4", "e3"])
    assert Decimal(other["steps"][0]["new_value"]) == Decimal("1025.29869")
    assert Decimal(other["steps"][1]["new_value"]) == Decimal("0.11") * (Decimal("11520.21") + Decimal("1025.29869"))


def test_case_40_e3_e4_is_the_original_graph_and_only_e4_e3_differs():
    lc = load_benchmark_case(BENCHMARK, "RSC-2026-00040", max_events=None, min_events=1, max_hops=10)
    _, cv = ledger_view(lc)
    op = SwapOperator(lc.model)
    posted_total = op.observed_net

    same = run_scenario(lc, cv, ["e3", "e4"], ["e3", "e4"], op=op)
    assert Decimal(same["selected"]["net"]) == posted_total == Decimal("906570")
    assert same["selected"]["node_effects"]["e3"]["changes"] == same["selected"]["node_effects"]["e4"]["changes"] == []
    assert all(not s["own_changes"] and Decimal(s["delta_net"]) == 0 and not s["affects"] for s in same["influence"]["steps"])

    other = run_scenario(lc, cv, ["e3", "e4"], ["e4", "e3"], op=op)
    effects = other["selected"]["node_effects"]
    assert effects["e4"]["changes"] == []  # tax went first: it keeps its recorded amount
    change = effects["e3"]["changes"][0]
    after = Decimal("0.11") * (Decimal("11520.21") + Decimal("1025.29869"))  # the discount is taken on gross + tax
    assert change["field"] == "amount" and Decimal(change["before"]) == Decimal("1267.2231") and Decimal(change["after"]) == after
    assert round(Decimal(other["selected"]["net"]), 2) == Decimal("897504.30")
    # the report names e4 as the reason e3 moved
    row = next(i for i in other["influence"]["influence"] if i["from"] == "e4" and i["to"] == "e3")
    assert Decimal(row["alone"]) == Decimal("1267.2231") and Decimal(row["after_upstream"]) == after

    assert same["selected_order"] == ["e3", "e4"]
    assert run_scenario(lc, cv, ["e3", "e4"], op=op)["selected_order"] == ["e3", "e4"]  # it opens on the posted order


def test_run_change_starts_from_the_books_and_keeps_edits():
    lc = load_benchmark_case(BENCHMARK, "RSC-2026-00040", max_events=None, min_events=1, max_hops=10)
    posted_total = lc.operator().observed_net
    only_swap = run_change(lc, {}, ["e3", "e4"], "swap_first")
    assert Decimal(only_swap["start_total"]) == posted_total == Decimal(only_swap["runs"][0]["final_net"])
    assert Decimal(only_swap["runs"][0]["state"]["e3"]["amount"]) == Decimal("1267.2231")

    edited = run_change(lc, {"e3": {"rate": "0.20"}}, ["e3", "e4"], "edit_first")
    assert Decimal(edited["runs"][0]["state"]["e3"]["rate"]) == Decimal("0.20")  # the swap does not put the rate back
    assert Decimal(edited["runs"][0]["state"]["e3"]["amount"]) == Decimal("0.20") * Decimal("11520.21")
    assert analyse(lc)["editable"]["e3"]["rate"] == "0.11"  # the panel opens on the recorded value
