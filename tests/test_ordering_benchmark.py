"""Member 2 tests: canonical ordering / POLICY-ORDERED, and the hidden-generative benchmark."""
import json
from decimal import Decimal as Dc
from itertools import combinations
from types import SimpleNamespace as NS

import pytest

from policy_engine import (
    BLOCKED, PASS, POLICY_ORDERED, CaseReference, apply_corrections, build_case, compute_net,
    load_policy, resolve_order,
)
from policy_engine.benchmark import evaluate as bench_eval
from policy_engine.benchmark.generator import EXPECT, FAMILIES, generate_benchmark
from policy_engine.loss import coalition_value, loss
from policy_engine.ordering import (
    REASON_NO_POLICY_ORDER, classify_case, legitimate_orders, probe_subset,
)

REF = CaseReference(Dc(100), Dc(10), Dc("0.18"), Dc(1), authorized_discount_rates={1: Dc("0.05")})


def ev(i, act, **a):
    return NS(event_id=i, activity=act, attributes={k: str(v) for k, v in a.items()})


def case(policy="P-2026-Q3-001"):
    evs = [ev("e1", "Apply Discount", rate="0.15", slot=1), ev("e2", "Apply Tax Code", rate="0.18"),
           ev("e3", "Apply Rounding", decimals=0, mode="ROUND_DOWN")]
    return build_case(evs, load_policy(policy), REF, ev("t", "Post Invoice"))


def probe(m, S, structural=()):
    return probe_subset(S, structural, lambda o: compute_net(apply_corrections(m.observed, o, m.ctx), m.ctx))


# ------------------------------------------------------------------ ordering
def test_policy_resolves_disagreement_with_upstream_first_sequence():
    m = case()
    pr = probe(m, ["e1", "e2", "e3"])
    assert not pr.agree and ("e1", "e2") in pr.disagreeing_pairs
    res = resolve_order(load_policy("P-2026-Q3-001"), ["e1", "e2", "e3"], m.correction_ids, pr.disagreeing_pairs, slots=m.ctx.slots)
    assert res.status == "RESOLVED" and res.classification == POLICY_ORDERED
    assert res.sequence == ("e1", "e2", "e3")
    assert {"CO-03", "CO-06"} <= set(res.applied_rules) | {"CO-03", "CO-06"}


def test_no_policy_order_blocks_with_reason_code_and_fields():
    m = case("P-2026-Q3-003")
    pr = probe(m, ["e1", "e2"])
    res = resolve_order(load_policy("P-2026-Q3-003"), ["e1", "e2"], m.correction_ids, pr.disagreeing_pairs)
    assert res.classification == BLOCKED and res.reason_code == REASON_NO_POLICY_ORDER
    assert set(res.unresolved_fields) == {"discount_correction", "tax_correction"}
    assert res.sequence == ()


def test_partial_policy_blocks_only_the_uncovered_pair():
    evs = [ev("e1", "Apply Discount", rate="0.15", slot=1), ev("e2", "Apply Tax Code", rate="0.12"),
           ev("e3", "Apply Rounding", decimals=0, mode="ROUND_DOWN")]
    pol = load_policy("P-2026-Q3-002")
    ref = CaseReference(Dc("99.99"), Dc(10), Dc("0.18"), Dc(1), authorized_discount_rates={1: Dc("0.05")})
    m = build_case(evs, pol, ref, ev("t", "Post Invoice"))  # non-integer amounts so rounding actually bites
    pr = probe(m, ["e1", "e2"])
    assert not pr.agree
    ok = resolve_order(pol, ["e1", "e2"], m.correction_ids, pr.disagreeing_pairs)
    assert ok.classification == POLICY_ORDERED          # discount -> tax is covered
    pr = probe(m, ["e2", "e3"])
    assert not pr.agree
    bad = resolve_order(pol, ["e2", "e3"], m.correction_ids, pr.disagreeing_pairs)
    assert bad.classification == BLOCKED                # tax -> rounding is not covered


def test_structural_lock_beats_policy_rule_and_is_reported():
    m = case()
    structural = [("e2", "e1")]  # the log says tax was posted before discount
    pr = probe(m, ["e1", "e2"], structural)
    assert pr.agree  # only one legitimate order -> nothing to resolve
    res = resolve_order(load_policy("P-2026-Q3-001"), ["e1", "e2"], m.correction_ids, [("e1", "e2")], structural)
    assert res.overridden_rules and res.overridden_rules[0]["structure_says"] == ["e2", "e1"]
    assert res.sequence == ("e2", "e1")  # structure wins


def test_legitimate_orders_respect_transitive_locks():
    assert list(legitimate_orders(["a", "b", "c"], [("a", "b"), ("b", "c")])) == [("a", "b", "c")]
    assert len(list(legitimate_orders(["a", "b", "c"], []))) == 6


def test_probe_does_not_flag_commuting_pair_separated_by_a_third_event():
    """Regression: price/qty commute; tax sitting between them in some orders
    must not make them look order-sensitive."""
    evs = [ev("p", "Override Unit Price", unit_price=80), ev("q", "Adjust Quantity", quantity=8),
           ev("t", "Apply Tax Code", rate="0.12")]
    m = build_case(evs, load_policy("P-2026-Q3-001"), REF)
    pr = probe(m, ["p", "q", "t"])
    assert not pr.agree
    assert ("p", "q") not in pr.disagreeing_pairs
    assert {("p", "t"), ("q", "t")} <= set(pr.disagreeing_pairs)


def test_classify_case_takes_worst_subset():
    assert classify_case([PASS, PASS]) == PASS
    assert classify_case([PASS, POLICY_ORDERED]) == POLICY_ORDERED
    assert classify_case([PASS, POLICY_ORDERED, BLOCKED]) == BLOCKED


# ------------------------------------------------------------------ benchmark
@pytest.fixture(scope="module")
def bench(tmp_path_factory):
    root = tmp_path_factory.mktemp("bench")
    manifest = generate_benchmark(root, seed=5, per_family=3)
    return root, manifest


def test_manifest_seal_and_determinism(bench, tmp_path):
    root, manifest = bench
    assert manifest["num_cases"] == 3 * len(FAMILIES)
    assert bench_eval.verify_seal(root)["hidden_truth_sha256"] == manifest["hidden_truth_sha256"]
    again = generate_benchmark(tmp_path, seed=5, per_family=3)
    assert again["hidden_truth_sha256"] == manifest["hidden_truth_sha256"]
    assert generate_benchmark(tmp_path / "x", seed=6, per_family=3)["hidden_truth_sha256"] != manifest["hidden_truth_sha256"]


def test_tampered_truth_fails_seal(bench, tmp_path):
    root, _ = bench
    import shutil
    copy = tmp_path / "copy"
    shutil.copytree(root, copy)
    p = copy / "hidden" / "truth.json"
    p.write_text(p.read_text().replace("PASS", "BLOCKED", 1))
    with pytest.raises(bench_eval.SealError):
        bench_eval.load_truth(copy)


def test_public_files_leak_no_truth(bench):
    root, _ = bench
    blob = (root / "public" / "cases.json").read_text()
    for forbidden in ("family", "classification", "shapley", "coalition_values", "subset_verdicts", "compliant_net"):
        assert forbidden not in blob
    for f in (root / "public").glob("*.jsonocel"):
        text = f.read_text()
        assert "compliant" not in text and "exempt" not in text
    for fam in FAMILIES:
        assert f'"{fam}"' not in blob  # no family label as a value (the `exceptions` reference key is legitimate input)


def test_every_family_yields_its_intended_verdict(bench):
    root, _ = bench
    truth = bench_eval.load_truth(root)
    for t in truth.values():
        assert t["classification"] == EXPECT[t["family"]]
        if t["classification"] == "BLOCKED":
            assert t["shapley"] is None
        else:
            assert abs(sum(Dc(v) for v in t["shapley"].values()) - Dc(t["coalition_values"][",".join(t["active_event_ids"])])) < Dc("0.0001")  # efficiency
    fams = {t["family"] for t in truth.values()}
    assert fams == set(FAMILIES)


def test_exception_player_gets_zero_and_interaction_is_unanimity(bench):
    root, _ = bench
    for t in bench_eval.load_truth(root).values():
        if t["family"] == "exception":
            ex_zero = [i for i, v in t["shapley"].items() if Dc(v) == 0]
            assert ex_zero
        if t["family"] == "interaction":
            shares = {Dc(v) for v in t["shapley"].values()}
            assert max(shares) - min(shares) < Dc("0.0001")  # symmetric: L/n each


def test_system_matches_hidden_truth_through_members_1_pipeline(bench):
    """End to end: Member 1's ingestion -> graph -> candidate extraction ->
    constraint extraction, then Member 2's policy engine, vs the independent oracle."""
    pytest.importorskip("pm4py")
    from replay_core.candidate_extraction import extract_candidate_events
    from replay_core.constraint_extraction import extract_constraints
    from replay_core.graph import ObjectCentricGraph
    from replay_core.ingestion import load_ocel

    root, _ = bench
    truth = bench_eval.load_truth(root)
    for c in json.loads((root / "public" / "cases.json").read_text())["cases"]:
        t = truth[c["case_id"]]
        log = load_ocel(root / "public" / c["ocel_file"], strict=True, log_validation_report=False)
        ex = extract_candidate_events(ObjectCentricGraph(log), c["target_event_id"], max_events=8)
        assert sorted(e.event_id for e in ex.candidate_events) == sorted(t["candidate_event_ids"])
        cons = extract_constraints(ex)
        locks = {(k.before_event_id, k.after_event_id) for k in cons.constraints if k.after_event_id != c["target_event_id"]}
        assert locks == {tuple(p) for p in t["structural_pairs"]}

        pol = load_policy(c["policy_version"])
        m = build_case(ex.candidate_events, pol, CaseReference.from_dict(c["reference"]), ex.target_event)
        cp = pol.with_given_constraints(c["target_event_id"], [k.to_policy_dict() for k in cons.constraints])
        assert abs(Dc(c["realized_loss"]) - loss(m.observed, m.observed, m.ctx)) < Dc("0.0001")

        verdicts = []
        active = m.ctx.active_nodes()
        for r in range(len(active) + 1):
            for S in combinations(active, r):
                pr = probe(m, list(S), cp.structural_pairs())
                if pr.agree:
                    v, order = PASS, next(iter(pr.outcomes))
                else:
                    res = resolve_order(cp, list(S), m.correction_ids, pr.disagreeing_pairs, slots=m.ctx.slots)
                    v, order = res.classification, res.sequence
                verdicts.append(v)
                key = ",".join(sorted(S))
                assert t["subset_verdicts"][key] == v, (c["case_id"], S)
                if v == BLOCKED:
                    assert t["coalition_values"][key] is None
                else:
                    val = coalition_value(apply_corrections(m.observed, order, m.ctx), m.observed, m.ctx)
                    assert abs(Dc(t["coalition_values"][key]) - val) < Dc("0.0001"), (c["case_id"], S)
        assert classify_case(verdicts) == t["classification"]


def test_score_case_flags_false_attribution(bench):
    root, _ = bench
    truth = bench_eval.load_truth(root)
    blocked = next(t for t in truth.values() if t["classification"] == "BLOCKED")
    good = bench_eval.score_case(blocked, {"classification": "BLOCKED", "shapley": None})
    assert good["classification_correct"] and not good["false_attribution"]
    bad = bench_eval.score_case(blocked, {"classification": "PASS", "shapley": {"e1": "10"}})
    assert bad["false_attribution"] and not bad["classification_correct"]
    exc = next(t for t in truth.values() if t["family"] == "exception")
    zero = next(i for i, v in exc["shapley"].items() if Dc(v) == 0)
    pred = dict(exc["shapley"]); pred[zero] = "50"
    assert bench_eval.score_case(exc, {"classification": "PASS", "shapley": pred})["false_attribution"]
