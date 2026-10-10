"""Replay operator R_P(X, S) and the idempotence check (Member 1, Month 3)."""
import json
from decimal import Decimal as Dc
from itertools import combinations, permutations
from types import SimpleNamespace as NS

import pytest

from policy_engine import CaseReference, apply_corrections, build_case, compute_net, load_policy
from policy_engine.loss import coalition_value
from replay_core.replay import ReplayError, ReplayOperator, subset_key

P1 = "P-2026-Q3-001"


def ev(i, act, **attrs):
    return NS(event_id=i, activity=act, attributes={k: str(v) for k, v in attrs.items()})


REF = CaseReference(Dc(100), Dc(10), Dc("0.18"), Dc(1), authorized_discount_rates={1: Dc("0.05")})
DISC_TAX = [ev("e1", "Apply Discount", rate="0.15", slot=1), ev("e2", "Apply Tax Code", rate="0.12")]


def operator(events, ref=REF):
    return ReplayOperator(build_case(events, load_policy(P1), ref, ev("t", "Post Invoice")))


# ------------------------------------------------------------- the operator, hand-built case
def test_empty_subset_is_the_observed_state():
    op = operator(DISC_TAX)
    r = op.replay([])
    assert r.state.snapshot() == op.observed.snapshot()
    assert r.net == op.observed_net and r.value == 0 and r.trace == () and r.order == ()


def test_full_canonical_replay_reaches_the_compliant_net():
    op = operator(DISC_TAX)
    r = op.replay_all()
    assert r.reaches_compliant_net and r.net == op.compliant_net
    assert r.net != op.observed_net  # the case really is anomalous
    assert r.value == op.observed_loss - r.loss


def test_default_order_is_canonical_stage_order_upstream_first():
    op = operator(list(reversed(DISC_TAX)))
    assert op.canonical_order(["e2", "e1"]) == ("e1", "e2")  # discount before tax
    assert op.replay(["e2", "e1"]).order == ("e1", "e2")


def test_replay_is_apply_corrections_not_a_second_implementation():
    op = operator(DISC_TAX)
    for order in permutations(["e1", "e2"]):
        r = op.replay(order, order)
        direct = apply_corrections(op.observed, list(order), op.ctx)
        assert r.state.snapshot() == direct.snapshot()
        assert r.net == compute_net(direct, op.ctx)
        assert r.value == coalition_value(direct, op.observed, op.ctx)


def test_order_changes_the_outcome_for_interacting_events():
    op = operator(DISC_TAX)
    assert op.replay(["e1", "e2"], ["e1", "e2"]).net != op.replay(["e1", "e2"], ["e2", "e1"]).net


def test_trace_has_the_state_after_every_correction():
    op = operator(DISC_TAX)
    r = op.replay(["e1", "e2"], ["e1", "e2"])
    assert [s.node_id for s in r.trace] == ["e1", "e2"] and [s.index for s in r.trace] == [0, 1]
    for i, step in enumerate(r.trace):
        prefix = apply_corrections(op.observed, list(r.order[: i + 1]), op.ctx)
        assert step.state_after.snapshot() == prefix.snapshot()
        assert step.net_after == compute_net(prefix, op.ctx)
        assert step.applied and step.noop_reason is None and step.changed
    assert r.trace[-1].state_after.snapshot() == r.state.snapshot()


def test_trace_marks_context_and_exempt_nodes_as_noops():
    ref = CaseReference(Dc(100), Dc(10), Dc("0.18"), Dc(1), authorized_discount_rates={1: Dc("0.05")},
                        exceptions={"e1": "APR-2026-00001"})
    op = operator([ev("e1", "Apply Discount", rate="0.15", slot=1), ev("c1", "Approve Order"),
                   ev("e2", "Apply Tax Code", rate="0.12")], ref)
    r = op.replay(["e1", "c1", "e2"])
    reasons = {s.node_id: s.noop_reason for s in r.trace}
    assert reasons == {"e1": "exempt", "c1": "context", "e2": None}
    assert set(r.noops) == {"e1", "c1"} and op.active_ids == ("e2",)
    assert all(not s.changed for s in r.trace if s.noop_reason)


@pytest.mark.parametrize("bad,msg", [
    (lambda op: op.replay(["e1", "zzz"]), "unknown event id"),
    (lambda op: op.replay(["e1", "e1"]), "duplicate"),
    (lambda op: op.replay(["t"]), "target event"),
    (lambda op: op.replay(["e1"], ["e2"]), "not a permutation"),
    (lambda op: op.replay(["e1", "e2"], ["e1"]), "not a permutation"),
])
def test_bad_subsets_and_orders_are_rejected(bad, msg):
    with pytest.raises(ReplayError, match=msg):
        bad(operator(DISC_TAX))


def test_result_is_json_serialisable_with_exact_decimals():
    r = operator(DISC_TAX).replay_all()
    d = json.loads(json.dumps(r.to_dict()))
    assert d["net"] == str(r.net) and d["key"] == "e1,e2" and len(d["trace"]) == 2


def test_subset_key_matches_the_benchmark_key_format():
    assert subset_key([]) == "" and subset_key(["e2", "e1"]) == "e1,e2"


def test_case_with_no_correctable_events_is_not_replayable():
    op = operator([ev("c1", "Approve Order"), ev("c2", "Insert Invoice")])
    assert not op.is_replayable and op.observed_loss == 0 and op.active_ids == ()
    assert operator(DISC_TAX).is_replayable


# ------------------------------------------------------------- idempotence
def test_idempotent_in_canonical_order_but_not_in_the_reverse_order():
    op = operator(DISC_TAX)
    good = op.check_idempotence(["e1", "e2"])  # canonical
    assert good.idempotent and good.differences == () and good.net_once == good.net_twice
    bad = op.check_idempotence(["e1", "e2"], ["e2", "e1"])  # tax before discount
    assert not bad.idempotent and bad.net_once != bad.net_twice
    assert {d["node"] for d in bad.differences} == {"e2"} and bad.differences[0]["field"] == "amount"


def test_single_corrections_are_idempotent():
    op = operator(DISC_TAX)
    assert op.check_idempotence(["e1"]).idempotent and op.check_idempotence(["e2"]).idempotent


# ------------------------------------------------------------- over the benchmark
@pytest.fixture(scope="module")
def loaded(bench_root):
    pytest.importorskip("pm4py")
    from replay_core.benchmark_io import load_benchmark_case, load_benchmark_index
    return [load_benchmark_case(bench_root, cid) for cid in load_benchmark_index(bench_root)]


def test_every_benchmark_case_meets_the_phase1_done_criteria(loaded):
    assert len(loaded) == 28
    for lc in loaded:
        op = lc.operator()
        assert op.is_replayable
        r0 = op.replay([])
        assert r0.state.snapshot() == op.observed.snapshot() and r0.value == 0, lc.case_id
        rf = op.replay_all()
        assert rf.reaches_compliant_net, (lc.case_id, rf.net, rf.compliant_net)
        assert abs(Dc(lc.entry["realized_loss"]) - op.observed_loss) < Dc("0.0001"), lc.case_id


def test_canonical_order_is_idempotent_for_every_subset_of_every_case(loaded):
    for lc in loaded:
        op = lc.operator()
        act = op.active_ids
        for r in range(len(act) + 1):
            for S in combinations(act, r):
                assert op.idempotent_in_canonical_order(S), (lc.case_id, S)


def test_some_non_canonical_orders_fail_idempotence_so_the_check_is_not_vacuous(loaded):
    failures = 0
    for lc in loaded:
        op = lc.operator()
        act = op.active_ids
        if len(act) < 2 or len(act) > 4:
            continue
        for order in permutations(act):
            if order != op.canonical_order(act) and not op.check_idempotence(act, order).idempotent:
                failures += 1
    assert failures > 0
