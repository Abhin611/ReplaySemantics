"""Confluence checker: PASS / POLICY_ORDERED / BLOCKED (Member 1, Month 4)."""
import json
import random
from decimal import Decimal as Dc
from itertools import combinations
from types import SimpleNamespace as NS

import pytest

from policy_engine import CaseReference, apply_corrections, build_case, compute_net, load_policy
from policy_engine.benchmark import evaluate as bench_eval
from policy_engine.ordering import BLOCKED, PASS, POLICY_ORDERED, probe_subset
from replay_core.confluence import ConfluenceChecker, ConfluenceInvariantError, transitive_closure
from replay_core.replay import ReplayOperator

P1, P3 = "P-2026-Q3-001", "P-2026-Q3-003"  # P1 orders the whole chain; P3 leaves pairs unresolved


def ev(i, act, **attrs):
    return NS(event_id=i, activity=act, attributes={k: str(v) for k, v in attrs.items()})


REF = CaseReference(Dc(100), Dc(10), Dc("0.18"), Dc("83.125"),
                    authorized_discount_rates={1: Dc("0.05"), 2: Dc("0.02")}, authorized_adjustments={"a": Dc(100)})
EVS = [
    ev("p", "Override Unit Price", unit_price=80), ev("q", "Adjust Quantity", quantity=8),
    ev("d1", "Apply Discount", rate="0.15", slot=1), ev("d2", "Apply Discount", rate="0.10", slot=2),
    ev("t", "Apply Tax Code", rate="0.12"), ev("c", "Convert Currency", fx_rate="80.1111"),
    ev("r", "Apply Rounding", decimals=0, mode="ROUND_DOWN"), ev("a", "Post Manual Adjustment", amount="500"),
]
SIX = [e for e in EVS if e.event_id in {"p", "d1", "t", "c", "r", "a"}]


def make(policy=P1, locks=(), events=EVS, ref=REF, permutable=None):
    m = build_case(events, load_policy(policy), ref, ev("tgt", "Post Invoice"))
    return ConfluenceChecker(ReplayOperator(m), load_policy(policy), structural_pairs=locks, permutable_pairs=permutable)


# ------------------------------------------------------------- structure does not decide the answer
def test_permutable_pairs_can_still_commute_or_not():
    ch = make()
    commuting, clashing = ch.check_subset(["p", "q"]), ch.check_subset(["p", "d1"])
    assert commuting.unlocked_pairs == 1 and clashing.unlocked_pairs == 1  # both structurally permutable
    assert commuting.agree and commuting.verdict == PASS and commuting.disagreeing_pairs == ()
    assert not clashing.agree and clashing.disagreeing_pairs == (("d1", "p"),)  # but the arithmetic does not commute
    assert len(clashing.distinct_nets) == 2


def test_policy_resolves_the_disagreement_to_policy_ordered_and_values_that_order():
    ch = make(P1)
    v = ch.check_subset(["p", "d1"])
    assert v.verdict == POLICY_ORDERED and v.order_used == ("p", "d1")
    assert v.value == ch.op.replay(["p", "d1"], ["p", "d1"]).value
    assert v.value != ch.op.replay(["p", "d1"], ["d1", "p"]).value  # the other order would give another number
    assert v.resolution.status == "RESOLVED" and v.resolution.applied_rules


def test_unresolved_policy_blocks_and_withholds_the_number():
    v = make(P3).check_subset(["p", "d1"])
    assert v.verdict == BLOCKED and v.value is None and v.order_used is None
    assert v.resolution.reason_code == "ORDERS_DISAGREE_NO_POLICY_ORDER"
    assert v.resolution.unresolved_pairs == (("d1", "p"),) and v.resolution.unresolved_fields


# ------------------------------------------------------------- structural locks
def test_a_structural_lock_removes_the_disagreement_by_removing_the_choice():
    ch = make(P3, locks=[("p", "d1")])  # even under the policy that blocks the free case
    v = ch.check_subset(["p", "d1"])
    assert v.verdict == PASS and v.agree and v.locked_pairs == 1 and v.unlocked_pairs == 0
    assert v.order_used == ("p", "d1")


def test_structure_beats_policy_when_they_conflict():
    ch = make(P1, locks=[("d1", "p")])  # the log says discount happened first; policy says price first
    v = ch.check_subset(["p", "d1"])
    assert v.verdict == PASS and v.order_used == ("d1", "p")
    assert v.value == ch.op.replay(["p", "d1"], ["d1", "p"]).value


def test_locks_are_closed_transitively_even_through_an_event_outside_the_subset():
    assert ("p", "r") in transitive_closure([("p", "t"), ("t", "r")])
    free = make(P3).check_subset(["p", "r"])
    chained = make(P3, locks=[("p", "t"), ("t", "r")]).check_subset(["p", "r"])  # t is not in the subset
    assert free.verdict == BLOCKED
    assert chained.verdict == PASS and chained.order_used == ("p", "r") and chained.locked_pairs == 1


# ------------------------------------------------------------- players, exemptions, invariants
def test_exempt_event_is_a_player_with_zero_value_and_never_causes_disagreement():
    ref = CaseReference(Dc(100), Dc(10), Dc("0.18"), Dc("83.125"), authorized_discount_rates={1: Dc("0.05")},
                        exceptions={"d1": "APR-2026-00001"})
    ch = make(P3, events=SIX, ref=ref)
    assert "d1" in ch.players
    solo = ch.check_subset(["d1"])
    assert solo.value == 0 and solo.effective == () and solo.verdict == PASS
    with_tax = ch.check_subset(["d1", "t"])
    assert with_tax.verdict == PASS and "d1" not in with_tax.effective
    assert with_tax.value == ch.check_subset(["t"]).value


def test_a_pair_extraction_called_locked_cannot_be_reported_order_sensitive():
    ch = make(P1, permutable=[("p", "q")])  # extraction says only (p,q) is permutable...
    with pytest.raises(ConfluenceInvariantError, match="did not call it permutable"):
        ch.check_subset(["p", "d1"])  # ...but (p,d1) really is order-sensitive: a bug upstream


def test_non_player_and_empty_subset():
    ch = make()
    with pytest.raises(ValueError, match="not a player"):
        ch.check_subset(["p", "tgt"])
    empty = ch.check_subset([])
    assert empty.verdict == PASS and empty.value == 0 and empty.order_used == ()
    assert ch.check_subset(["p", "q"]) is ch.check_subset(["q", "p"])  # cached, order-insensitive


# ------------------------------------------------------------- the whole case
def test_case_verdict_is_the_worst_subset_and_attribution_follows_it():
    cv = make(P3, events=SIX).check_case()
    assert cv.classification == BLOCKED and not cv.attribution_allowed and cv.blocked_subsets
    assert len(cv.subsets) == 2 ** len(cv.players)
    pred = cv.prediction(shapley={"p": Dc(1)})
    assert pred["classification"] == BLOCKED and pred["shapley"] is None  # forced withheld
    assert pred["coalition_values"][",".join(sorted(cv.players))] is None
    ok = make(P1, events=SIX).check_case()
    assert ok.classification == POLICY_ORDERED and ok.attribution_allowed
    assert ok.prediction(shapley={"p": Dc(1)})["shapley"] == {"p": "1"}
    d = json.loads(json.dumps(ok.to_dict()))
    assert d["classification"] == POLICY_ORDERED and len(d["subsets"]) == 64
    assert d["counts"][PASS] + d["counts"][POLICY_ORDERED] + d["counts"][BLOCKED] == 64


def test_pair_accounting_shows_how_many_permutable_pairs_were_really_order_sensitive():
    st = make(P1, events=SIX).check_case().stats
    assert st["pairs_tested"] > st["pairs_order_sensitive"] > 0  # structure alone is not the verdict
    locked = make(P1, events=SIX, locks=[("p", "d1"), ("d1", "t")]).check_case().stats
    assert locked["pairs_skipped_locked"] > 0 and locked["pairs_tested"] < st["pairs_tested"]


def test_eight_free_events_use_a_small_fraction_of_the_brute_force_replays():
    ch = make(P1)
    cv = ch.check_case()
    assert len(cv.players) == 8 and len(cv.subsets) == 256
    brute = sum(__import__("math").comb(8, k) * __import__("math").factorial(k) * k for k in range(9))
    assert cv.stats["corrections_applied"] < brute / 10


# ------------------------------------------------------------- equals the brute-force reference
def _probe_net(op):
    return lambda order: compute_net(apply_corrections(op.observed, list(order), op.ctx), op.ctx)


def test_matches_brute_force_probe_for_random_lock_structures():
    rng = random.Random(2026)
    nodes = ["p", "d1", "t", "c", "r", "a"]
    for trial in range(12):
        total = nodes[:]
        rng.shuffle(total)  # locks consistent with a random total order => acyclic
        locks = [(a, b) for a, b in combinations(total, 2) if rng.random() < 0.22]
        ch = make(P3, events=SIX, locks=locks)
        closed = transitive_closure(locks)
        for r in range(len(nodes) + 1):
            for S in combinations(ch.players, r):
                v = ch.check_subset(S)
                pr = probe_subset(list(S), closed, _probe_net(ch.op))
                assert v.agree == pr.agree, (locks, S)
                assert v.disagreeing_pairs == tuple(sorted(pr.disagreeing_pairs)), (locks, S)
                assert len(v.distinct_nets) == len(set(pr.outcomes.values())), (locks, S)


# ------------------------------------------------------------- against the sealed benchmark truth
@pytest.fixture(scope="module")
def checked(bench_root):
    pytest.importorskip("pm4py")
    from replay_core.benchmark_io import load_benchmark_case, load_benchmark_index
    truth = bench_eval.load_truth(bench_root)
    out = []
    for cid in load_benchmark_index(bench_root):
        lc = load_benchmark_case(bench_root, cid)
        ch = ConfluenceChecker.from_loaded(lc)
        out.append((cid, truth[cid], ch, ch.check_case()))
    return out


def test_every_subset_verdict_and_value_matches_the_hidden_truth(checked):
    assert len(checked) == 28
    for cid, t, ch, cv in checked:
        assert cv.classification == t["classification"], cid
        assert set(cv.subsets) == set(t["subset_verdicts"]), cid
        for key, sv in cv.subsets.items():
            assert sv.verdict == t["subset_verdicts"][key], (cid, key)
            tv = t["coalition_values"][key]
            if tv is None:
                assert sv.value is None, (cid, key)
            else:
                assert sv.value is not None and abs(Dc(tv) - sv.value) < Dc("0.0001"), (cid, key)


def test_every_family_is_classified_as_designed(checked):
    expect = {"policy_ordered": POLICY_ORDERED, "non_confluent": BLOCKED}
    seen = set()
    for cid, t, ch, cv in checked:
        seen.add(t["family"])
        assert cv.classification == expect.get(t["family"], PASS), (cid, t["family"])
    assert len(seen) == 7


def test_checker_agrees_with_the_brute_force_probe_on_every_benchmark_subset(checked):
    n = 0
    for cid, t, ch, cv in checked:
        for key, sv in cv.subsets.items():
            if len(sv.subset) > 5:
                continue
            pr = probe_subset(list(sv.subset), ch.locks, _probe_net(ch.op))
            assert (pr.agree, tuple(sorted(pr.disagreeing_pairs))) == (sv.agree, sv.disagreeing_pairs), (cid, key)
            n += 1
    assert n > 150


def test_predictions_score_clean_with_the_evaluator_and_never_attribute_a_blocked_case(checked):
    for cid, t, ch, cv in checked:
        pred = cv.prediction(shapley=t["shapley"])  # even handed the true shapley, a BLOCKED case yields None
        s = bench_eval.score_case(t, pred)
        assert s["classification_correct"] and s["attribution_withheld_correctly"], cid
        assert s["max_abs_coalition_error"] and Dc(s["max_abs_coalition_error"]) < Dc("0.0001"), cid
        if cv.classification == BLOCKED:
            assert pred["shapley"] is None and not s["false_attribution"]


def test_structural_permutable_pairs_are_not_all_order_sensitive_on_benchmark_data(checked):
    tested = sum(cv.stats["pairs_tested"] for *_, cv in checked)
    sensitive = sum(cv.stats["pairs_order_sensitive"] for *_, cv in checked)
    assert 0 < sensitive < tested
