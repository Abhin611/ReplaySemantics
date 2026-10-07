"""Member 2 tests: policy schema, frozen domain, transfer functions, corrections, loss."""
import copy
import json
from decimal import Decimal as Dc
from pathlib import Path
from types import SimpleNamespace as NS

import pytest

from policy_engine import (
    CaseReference, LossSpec, Policy, apply_corrections, build_case, cascade_edit,
    compute_net, load_policy, loss, recompute_chain, transfer_function,
)
from policy_engine.corrections import CORRECTION_REGISTRY, spec_for_activity, unmapped_activities
from policy_engine.domain import D, DomainModelError
from policy_engine.loss import coalition_value, compliant_net
from policy_engine.schema import PolicyValidationError, list_policies

P1 = "P-2026-Q3-001"


def ev(i, act, **attrs):
    return NS(event_id=i, activity=act, attributes={k: str(v) for k, v in attrs.items()})


def make(events, ref=None, policy=P1, target=True):
    ref = ref or CaseReference(contract_price=Dc(100), ordered_quantity=Dc(10), tax_rate=Dc("0.18"),
                               fx_rate=Dc(1), authorized_discount_rates={1: Dc("0.05")})
    return build_case(events, load_policy(policy), ref, ev("t", "Post Invoice") if target else None)


def net_after(m, order):
    return compute_net(apply_corrections(m.observed, order, m.ctx), m.ctx)


# ------------------------------------------------------------------ policy schema
def test_shipped_policies_load_and_carry_remediation_cost():
    assert list_policies() == ["P-2026-Q3-001", "P-2026-Q3-002", "P-2026-Q3-003"]
    for v in list_policies():
        p = load_policy(v)
        assert p.warnings == ()
        assert all(isinstance(c.remediation_cost, int) and c.remediation_cost == 1 for c in p.corrections)


def test_missing_remediation_cost_defaults_to_one_with_warning():
    d = load_policy(P1).to_dict()
    del d["corrections"][0]["remediation_cost"]
    p = Policy.from_dict(d)
    assert p.corrections[0].remediation_cost == 1 and "remediation_cost missing" in p.warnings[0]


@pytest.mark.parametrize("mutate,msg", [
    (lambda d: d.update(policy_version="P-2026-Q5-001"), "policy_version"),
    (lambda d: d["corrections"][0].update(remediation_cost=-1), "non-negative"),
    (lambda d: d["corrections"][0].update(remediation_cost=True), "non-negative"),
    (lambda d: d["corrections"][1].update(correction_id=d["corrections"][0]["correction_id"]), "duplicate correction_id"),
    (lambda d: d["canonical_orderings"][0].update(before="nope"), "unknown correction_id"),
    (lambda d: d["rounding"].update(mode="ROUND_UP"), "rounding.mode"),
    (lambda d: d["stacking"].update(max_total_discount="1.5"), "max_total_discount"),
    (lambda d: d.update(schema_version="9"), "schema_version"),
])
def test_invalid_policies_rejected(mutate, msg):
    d = copy.deepcopy(load_policy(P1).to_dict())
    mutate(d)
    with pytest.raises(PolicyValidationError, match=msg):
        Policy.from_dict(d)


def test_cyclic_canonical_ordering_rejected():
    d = copy.deepcopy(load_policy(P1).to_dict())
    d["canonical_orderings"].append({"rule_id": "CO-99", "before": "rounding_correction", "after": "price_correction"})
    with pytest.raises(PolicyValidationError, match="cycle"):
        Policy.from_dict(d)


def test_precedence_is_transitive_over_types():
    p = load_policy(P1)
    assert p.precedes("price_correction", "rounding_correction")
    assert not p.precedes("rounding_correction", "price_correction")
    assert not load_policy("P-2026-Q3-003").precedes("price_correction", "rounding_correction")


def test_fingerprint_stable_and_sensitive_and_case_overlay_does_not_bump_policy():
    p = load_policy(P1)
    assert p.fingerprint() == load_policy(P1).fingerprint()
    d = p.to_dict(); d["corrections"][0]["remediation_cost"] = 2
    assert Policy.from_dict(d).fingerprint() != p.fingerprint()
    cp = p.with_given_constraints("e9", [{"before": "e1", "after": "e2", "shared_object": "INV-1", "reason": "structural_precedence"}])
    assert cp.policy.fingerprint() == p.fingerprint() and cp.policy.policy_version == P1
    assert cp.fingerprint() != p.fingerprint()
    assert cp.structural_pairs() == [("e1", "e2")]
    assert cp.to_dict()["given_constraints"]["target_event_id"] == "e9"


def test_json_schema_file_accepts_shipped_policies():
    jsonschema = pytest.importorskip("jsonschema")
    schema = json.loads((Path(__file__).parent.parent / "src/policy_engine/policy.schema.json").read_text())
    for v in list_policies():
        jsonschema.validate(load_policy(v).to_dict(), schema)


# ------------------------------------------------------------------ domain / worked example
DISC_TAX = [ev("e1", "Apply Discount", rate="0.15", slot=1), ev("e2", "Apply Tax Code", rate="0.18")]


def test_worked_example_numbers():
    m = make(DISC_TAX)
    assert compute_net(m.observed, m.ctx) == Dc("1003")
    assert compliant_net(m.observed, m.ctx) == Dc("1121")
    assert loss(m.observed, m.observed, m.ctx) == Dc("118")
    assert net_after(m, ["e1", "e2"]) == Dc("1121")   # discount, then tax: tax sees the corrected base
    assert net_after(m, ["e2", "e1"]) == Dc("1103")   # tax first: tax stays computed on the bad discount
    assert net_after(m, ["e1"]) == Dc("1103")
    assert net_after(m, ["e2"]) == Dc("1003")


def test_floats_rejected():
    with pytest.raises(TypeError):
        D(0.1)


def test_transfer_function_is_pure_and_uses_own_attrs():
    m = make(DISC_TAX)
    inputs = {k: dict(v) for k, v in m.observed.nodes.items()}
    before = copy.deepcopy(inputs)
    inputs["e2"]["rate"] = Dc("0.28")
    out = transfer_function("e2", {u: inputs[u] for u in m.ctx.upstream("e2") + ["e2"]}, m.ctx)
    assert out["amount"] == Dc("0.28") * (Dc(1000) - Dc(150))
    assert inputs["e1"] == before["e1"]  # untouched


def test_recompute_chain_is_idempotent_and_matches_manual_cascade():
    m = make(DISC_TAX)
    once = recompute_chain(m.observed, m.ctx)
    assert once.snapshot() == recompute_chain(once, m.ctx).snapshot()
    edited = m.observed.nodes["e1"] | {"rate": Dc("0.05")}
    manual = recompute_chain(m.observed.with_node("e1", edited), m.ctx)
    casc = cascade_edit(m.observed, m.ctx, {"e1": {"rate": Dc("0.05")}})
    assert casc.snapshot() == manual.snapshot()
    assert compute_net(casc, m.ctx) == Dc("1121")  # discount 50, tax 0.18*950 = 171


def test_multi_edit_combines_edits_that_feed_the_same_descendant():
    evs = [ev("e1", "Override Unit Price", unit_price=80), ev("e2", "Adjust Quantity", quantity=8),
           ev("e3", "Apply Discount", rate="0.10", slot=1)]
    m = make(evs)
    both = cascade_edit(m.observed, m.ctx, {"e1": {"unit_price": Dc(100)}, "e2": {"quantity": Dc(10)}})
    assert both.nodes["e3"]["amount"] == Dc("0.10") * 1000          # discount saw BOTH edits
    only_price = cascade_edit(m.observed, m.ctx, {"e1": {"unit_price": Dc(100)}})
    assert only_price.nodes["e3"]["amount"] == Dc("0.10") * 800    # not the last-edit-wins value


def test_downstream_closure():
    m = make(DISC_TAX + [ev("e3", "Apply Rounding", decimals=0, mode="ROUND_DOWN")])
    assert m.ctx.downstream_closure({"e1"}) == {"e1", "e2", "e3", "t"}
    assert m.ctx.downstream_closure({"e3"}) == {"e3", "t"}


def test_absent_stages_are_derived_fresh_not_stale():
    m = make([ev("e1", "Apply Discount", rate="0.15", slot=1)])  # no tax event in the case
    assert net_after(m, ["e1"]) == compliant_net(m.observed, m.ctx) == Dc("1121.00")


def test_domain_rejects_unrepresentable_cases():
    with pytest.raises(DomainModelError, match="at most one"):
        make([ev("e1", "Apply Tax Code", rate="0.1"), ev("e2", "Apply Tax Code", rate="0.2")])
    with pytest.raises(DomainModelError, match="slots must be unique"):
        make([ev("e1", "Apply Discount", rate="0.1", slot=1), ev("e2", "Apply Discount", rate="0.1", slot=1)])
    with pytest.raises(DomainModelError, match="missing attribute 'rate'"):
        make([ev("e1", "Apply Tax Code")])


# ------------------------------------------------------------------ corrections
def test_registry_dispatch_aliases_and_alignment_report():
    assert spec_for_activity("Apply Discount").correction_id == "discount_correction"
    assert spec_for_activity("Change PO Quantity").correction_id == "quantity_correction"
    assert spec_for_activity("Set Payment Block") is None
    assert set(CORRECTION_REGISTRY) == {c.activity for c in load_policy(P1).corrections}
    assert unmapped_activities(["Apply Tax Code", "Set Payment Block", "Create Invoice (from Order)"]) == [
        "Create Invoice (from Order)"]


def test_each_correction_restores_only_its_own_field():
    evs = [ev("p", "Override Unit Price", unit_price=70), ev("q", "Adjust Quantity", quantity=7),
           ev("c", "Convert Currency", fx_rate="0.9"), ev("a", "Post Manual Adjustment", amount=500)]
    ref = CaseReference(Dc(100), Dc(10), Dc("0.18"), Dc(1), authorized_adjustments={"a": Dc(900)})
    m = make(evs, ref)
    s = apply_corrections(m.observed, ["p"], m.ctx)
    assert s.nodes["p"]["unit_price"] == 100 and s.nodes["q"]["quantity"] == 7 and s.nodes["c"]["fx_rate"] == Dc("0.9")
    s = apply_corrections(m.observed, ["a"], m.ctx)
    assert s.nodes["a"]["amount"] == 900 and s.nodes["p"]["unit_price"] == 70


def test_exempt_event_is_untouched_and_kept_in_compliant_reference():
    ref = CaseReference(Dc(100), Dc(10), Dc("0.18"), Dc(1), authorized_discount_rates={1: Dc("0.05")},
                        exceptions={"e1": "APR-2026-00001"})
    m = make([ev("e1", "Apply Discount", rate="0.15", slot=1)], ref)
    assert apply_corrections(m.observed, ["e1"], m.ctx).snapshot() == m.observed.snapshot()
    assert compliant_net(m.observed, m.ctx) == compute_net(m.observed, m.ctx)
    assert loss(m.observed, m.observed, m.ctx) == 0


def test_corrections_are_idempotent_individually():
    m = make(DISC_TAX)
    for n in ("e1", "e2"):
        once = apply_corrections(m.observed, [n], m.ctx)
        assert apply_corrections(once, [n], m.ctx).snapshot() == once.snapshot()


def test_canonical_order_is_idempotent_but_non_canonical_is_not():
    """Why upstream-first is the right canonical order: re-applying the SAME
    sequence converges only when upstream is corrected first."""
    m = make(DISC_TAX)
    good = apply_corrections(m.observed, ["e1", "e2"], m.ctx)
    assert apply_corrections(good, ["e1", "e2"], m.ctx).snapshot() == good.snapshot()
    bad = apply_corrections(m.observed, ["e2", "e1"], m.ctx)
    assert compute_net(apply_corrections(bad, ["e2", "e1"], m.ctx), m.ctx) != compute_net(bad, m.ctx)


# which pairs are order-sensitive in the frozen domain (the structure the confluence checker finds)
def _commutes(evs, a, b, ref=None, policy=P1):
    m = make(evs, ref)
    return net_after(m, [a, b]) == net_after(m, [b, a])


REF2 = CaseReference(Dc(100), Dc(10), Dc("0.18"), Dc(1), authorized_discount_rates={1: Dc("0.05"), 2: Dc("0.02")})


def test_price_and_quantity_commute():
    assert _commutes([ev("a", "Override Unit Price", unit_price=70), ev("b", "Adjust Quantity", quantity=7)], "a", "b")


def test_discount_tax_and_gross_discount_do_not_commute():
    assert not _commutes(DISC_TAX, "e1", "e2")
    assert not _commutes([ev("a", "Override Unit Price", unit_price=70), ev("b", "Apply Discount", rate="0.15", slot=1)], "a", "b", REF2)


def test_currency_commutes_with_tax_but_not_with_rounding():
    ref = CaseReference(Dc(100), Dc(10), Dc("0.18"), Dc("83.125"), authorized_discount_rates={})
    cur = ev("c", "Convert Currency", fx_rate="80.1111")
    assert _commutes([cur, ev("t", "Apply Tax Code", rate="0.12")], "c", "t", ref)
    assert not _commutes([cur, ev("r", "Apply Rounding", decimals=0, mode="ROUND_DOWN")], "c", "r", ref)


def test_stacking_mode_controls_whether_slots_interact():
    evs = [ev("d1", "Apply Discount", rate="0.15", slot=1), ev("d2", "Apply Discount", rate="0.10", slot=2)]
    assert not _commutes(evs, "d1", "d2", REF2)  # multiplicative (P-001): slot 2 reads slot 1's amount
    d = load_policy(P1).to_dict(); d["stacking"]["mode"] = "additive"
    m = build_case(evs, Policy.from_dict(d), REF2)
    assert net_after(m, ["d1", "d2"]) == net_after(m, ["d2", "d1"])


# ------------------------------------------------------------------ loss kinds
def _adj_case(amounts, loss_spec):
    evs = [ev(f"a{i}", "Post Manual Adjustment", amount=obs) for i, (obs, _) in enumerate(amounts)]
    ref = CaseReference(Dc(100), Dc(10), Dc("0.18"), Dc(1),
                        authorized_adjustments={f"a{i}": Dc(auth) for i, (_, auth) in enumerate(amounts)}, loss=loss_spec)
    return make(evs, ref)


def test_shortfall_loss_is_additive_for_independent_adjustments():
    m = _adj_case([(900, 1000), (4500, 5000)], LossSpec("shortfall"))
    v = lambda s: coalition_value(apply_corrections(m.observed, s, m.ctx), m.observed, m.ctx)
    assert (v(["a0"]), v(["a1"]), v(["a0", "a1"])) == (100, 500, 600)


def test_threshold_loss_gives_interaction_and_redundancy_games():
    # interaction: each deviation alone exceeds tolerance -> both corrections needed
    m = _adj_case([(900, 1000), (4500, 5000)], LossSpec("threshold", Dc(50), Dc(600)))
    v = lambda m, s: coalition_value(apply_corrections(m.observed, s, m.ctx), m.observed, m.ctx)
    assert (v(m, ["a0"]), v(m, ["a1"]), v(m, ["a0", "a1"])) == (0, 0, 600)
    # redundancy: each deviation alone is within tolerance -> either correction clears the breach
    m = _adj_case([(900, 1000), (4500, 5000)], LossSpec("threshold", Dc(550), Dc(600)))
    assert (v(m, ["a0"]), v(m, ["a1"]), v(m, ["a0", "a1"])) == (600, 600, 600)


def test_threshold_requires_amount():
    with pytest.raises(DomainModelError):
        LossSpec("threshold")
