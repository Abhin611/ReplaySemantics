"""propagate_multi: multi-node edit, one cascade (Member 1, Month 3)."""
from decimal import Decimal as Dc
from types import SimpleNamespace as NS

import pytest

from policy_engine import CaseReference, CaseState, build_case, cascade_edit, compute_net, load_policy, recompute_chain
from replay_core.propagation import EDITABLE_FIELDS, PropagationError, propagate_multi

P1 = "P-2026-Q3-001"


def ev(i, act, **attrs):
    return NS(event_id=i, activity=act, attributes={k: str(v) for k, v in attrs.items()})


REF = CaseReference(Dc(100), Dc(10), Dc("0.18"), Dc("83.125"), authorized_discount_rates={1: Dc("0.05")})
EVS = [
    ev("p", "Override Unit Price", unit_price=80), ev("q", "Adjust Quantity", quantity=8),
    ev("d", "Apply Discount", rate="0.15", slot=1), ev("t", "Apply Tax Code", rate="0.12"),
    ev("c", "Convert Currency", fx_rate="80.1111"), ev("r", "Apply Rounding", decimals=0, mode="ROUND_DOWN"),
    ev("x", "Approve Order"),
]


@pytest.fixture()
def model():
    return build_case(EVS, load_policy(P1), REF, ev("tgt", "Post Invoice"))


def manual_full_cascade(model, edits):
    """The reference: write the new inputs in, then re-post EVERYTHING in stage order."""
    nodes = {k: dict(v) for k, v in model.observed.nodes.items()}
    for n, f in edits.items():
        nodes[n].update(f)
    return recompute_chain(CaseState(nodes), model.ctx)


def test_equals_recompute_chain_for_a_multi_node_edit(model):
    edits = {"d": {"rate": "0.05"}, "t": {"rate": "0.18"}, "p": {"unit_price": "100"}}
    res = propagate_multi(model, edits)
    clean = {"d": {"rate": Dc("0.05")}, "t": {"rate": Dc("0.18")}, "p": {"unit_price": Dc(100)}}
    assert res.state.snapshot() == manual_full_cascade(model, clean).snapshot()
    assert res.state.snapshot() == cascade_edit(model.observed, model.ctx, clean).snapshot()
    assert res.net_after == compute_net(manual_full_cascade(model, clean), model.ctx)


def test_two_edits_feeding_the_same_descendant_are_combined_not_overwritten(model):
    both = propagate_multi(model, {"p": {"unit_price": "100"}, "d": {"rate": "0.05"}})
    step1 = propagate_multi(model, {"p": {"unit_price": "100"}})
    step2 = propagate_multi(model, {"d": {"rate": "0.05"}}, base=step1.state)
    assert both.state.snapshot() == step2.state.snapshot()  # one click == two clicks in sequence
    assert both.state.snapshot() != step1.state.snapshot()


def test_edits_are_independent_of_the_order_they_are_listed_in(model):
    a = propagate_multi(model, {"d": {"rate": "0.05"}, "t": {"rate": "0.18"}})
    b = propagate_multi(model, {"t": {"rate": "0.18"}, "d": {"rate": "0.05"}})
    assert a.state.snapshot() == b.state.snapshot()


def test_report_lists_the_recomputed_nodes_and_only_real_changes(model):
    res = propagate_multi(model, {"t": {"rate": "0.18"}})
    assert res.edited == ("t",)
    assert set(res.recomputed) == model.ctx.downstream_closure({"t"})
    assert "r" in res.recomputed and "tgt" in res.recomputed and "p" not in res.recomputed
    assert {c["node"] for c in res.changed} <= set(res.recomputed)
    assert res.net_after != res.net_before and res.net_before == compute_net(model.observed, model.ctx)


def test_editing_to_the_same_value_changes_nothing(model):
    current = model.observed.nodes["d"]["rate"]
    res = propagate_multi(model, {"d": {"rate": str(current)}})
    assert res.changed == () and res.net_after == res.net_before


def test_editing_the_compliant_values_recovers_the_compliant_net(model):
    from policy_engine.loss import compliant_net
    edits = {"p": {"unit_price": "100"}, "q": {"quantity": "10"}, "d": {"rate": "0.05"}, "t": {"rate": "0.18"},
             "c": {"fx_rate": "83.125"}, "r": {"decimals": 2, "mode": "ROUND_HALF_UP"}}
    assert propagate_multi(model, edits).net_after == compliant_net(model.observed, model.ctx)


def test_values_are_coerced_to_exact_decimals_and_ints(model):
    res = propagate_multi(model, {"d": {"rate": 0.05}, "r": {"decimals": "2", "mode": "ROUND_HALF_UP"}})
    assert res.state.nodes["d"]["rate"] == Dc("0.05")
    assert res.state.nodes["r"]["decimals"] == 2 and isinstance(res.state.nodes["r"]["decimals"], int)


@pytest.mark.parametrize("edits,msg", [
    ({"nope": {"rate": "0.1"}}, "unknown node"),
    ({"d": {"amount": "5"}}, "not editable"),  # derived field
    ({"t": {"amount": "5"}}, "not editable"),
    ({"d": {"unit_price": "5"}}, "not editable"),  # a field of another node type
    ({"x": {"rate": "0.1"}}, "no editable fields"),  # context node
    ({"tgt": {"net": "1"}}, "no editable fields"),  # the target
    ({"d": {}}, "no fields given"),
    ({"d": {"rate": "abc"}}, "not a number"),
    ({"r": {"decimals": "-1"}}, "non-negative"),
    ({"r": {"decimals": "1.5"}}, "whole number"),
    ({"r": {"mode": "ROUND_SIDEWAYS"}}, "must be one of"),
])
def test_invalid_edits_are_rejected_with_a_clear_message(model, edits, msg):
    with pytest.raises(PropagationError, match=msg):
        propagate_multi(model, edits)


def test_editable_fields_cover_exactly_the_input_fields_of_the_domain(model):
    for node, attrs in model.observed.nodes.items():
        t = model.ctx.type_of(node)
        for f in EDITABLE_FIELDS.get(t, ()):
            assert f in attrs, (node, t, f)  # every editable field really exists on the node


def test_result_serialises_with_exact_strings(model):
    import json
    d = json.loads(json.dumps(propagate_multi(model, {"t": {"rate": "0.18"}}).to_dict()))
    assert d["net_delta"] == str(Dc(d["net_after"]) - Dc(d["net_before"]))


def test_matches_recompute_chain_on_every_benchmark_case(bench_root):
    pytest.importorskip("pm4py")
    from replay_core.benchmark_io import load_benchmark_case, load_benchmark_index
    n = 0
    for cid in load_benchmark_index(bench_root):
        m = load_benchmark_case(bench_root, cid).model
        edits, clean = {}, {}
        for node in m.ctx.active_nodes():
            t = m.ctx.type_of(node)
            fld = EDITABLE_FIELDS[t][0]
            if fld in ("decimals",):
                continue
            old = Dc(str(m.observed.nodes[node][fld]))
            edits[node] = {fld: str(old + Dc("1.25"))}
            clean[node] = {fld: old + Dc("1.25")}
        if not edits:
            continue
        n += 1
        assert propagate_multi(m, edits).state.snapshot() == manual_full_cascade(m, clean).snapshot(), cid
    assert n >= 20
