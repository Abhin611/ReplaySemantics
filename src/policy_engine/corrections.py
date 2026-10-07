"""
corrections.py
--------------
Member 2 -- correction functions c(e_i) for the frozen domain (Month 2) and
their extension to interacting fields (Month 3: discount stacking, rounding).

A correction c(e_i) does exactly two things to the replay state X:

    1. restore the node's OWN input field to the policy-compliant value
       (contract price, ordered quantity, authorized discount rate, policy
       tax rate, policy FX rate, authorized posting amount, policy rounding);
    2. re-derive the node's OWN stored amount from the CURRENT upstream
       attributes, via the same `transfer_function` the manual-edit cascade
       uses.

It never touches downstream nodes. That is deliberate (see domain.py): it is
the source of the order-dependence the confluence checker tests for, and it
is why "the existing correction function is a transfer function whose only
input is the node's own prior state" -- here it literally calls one.

`apply_corrections` is the building block Member 1's replay operator
R_P(X, S) composes. R_P itself (subset selection, order resolution,
idempotence testing) stays in replay_core -- this module does not replace it.

CORRECTION_REGISTRY is keyed by ACTIVITY STRING (what `OCELEvent.activity`
carries), so Member 1's candidate events can be dispatched directly.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Iterable, Sequence

from policy_engine.domain import (
    ADJUSTMENT,
    CONTEXT,
    CURRENCY,
    DISCOUNT,
    GROSS_PRICE,
    GROSS_QTY,
    NET,
    ROUNDING,
    TAX,
    CaseState,
    DomainContext,
    D,
    _gather_inputs,
    recompute_chain,
    transfer_function,
)


@dataclass(frozen=True)
class CorrectionSpec:
    correction_id: str
    activity: str
    node_type: str
    description: str
    # (node_id, ctx) -> the node's policy-compliant INPUT fields
    compliant_fields: Callable[[str, DomainContext], dict[str, Any]]


def _price(node_id: str, ctx: DomainContext) -> dict:
    return {"unit_price": ctx.reference.contract_price}


def _quantity(node_id: str, ctx: DomainContext) -> dict:
    return {"quantity": ctx.reference.ordered_quantity}


def _discount(node_id: str, ctx: DomainContext) -> dict:
    slot = ctx.slots[node_id]
    return {"rate": ctx.reference.authorized_discount_rates.get(slot, D("0"))}


def _tax(node_id: str, ctx: DomainContext) -> dict:
    return {"rate": ctx.reference.tax_rate}


def _currency(node_id: str, ctx: DomainContext) -> dict:
    return {"fx_rate": ctx.reference.fx_rate}


def _adjustment(node_id: str, ctx: DomainContext) -> dict:
    return {"amount": ctx.reference.authorized_adjustments.get(node_id, D("0"))}


def _rounding(node_id: str, ctx: DomainContext) -> dict:
    return {"decimals": ctx.rounding_decimals, "mode": ctx.rounding_mode}


_SPECS = [
    CorrectionSpec("price_correction", "Override Unit Price", GROSS_PRICE,
                   "Restore the contract unit price.", _price),
    CorrectionSpec("quantity_correction", "Adjust Quantity", GROSS_QTY,
                   "Restore the ordered quantity.", _quantity),
    CorrectionSpec("discount_correction", "Apply Discount", DISCOUNT,
                   "Restore the authorized discount rate for this stacking slot.", _discount),
    CorrectionSpec("tax_correction", "Apply Tax Code", TAX,
                   "Restore the policy tax rate and re-derive tax on the current post-discount base.", _tax),
    CorrectionSpec("currency_correction", "Convert Currency", CURRENCY,
                   "Restore the policy FX rate.", _currency),
    CorrectionSpec("adjustment_correction", "Post Manual Adjustment", ADJUSTMENT,
                   "Restore the authorized posting amount.", _adjustment),
    CorrectionSpec("rounding_correction", "Apply Rounding", ROUNDING,
                   "Re-round the current pre-rounding amount under the policy rounding rule.", _rounding),
]

CORRECTION_REGISTRY: dict[str, CorrectionSpec] = {s.activity: s for s in _SPECS}
CORRECTIONS_BY_ID: dict[str, CorrectionSpec] = {s.correction_id: s for s in _SPECS}

# Real ERP activity strings seen in the P2P/O2C datasets that map onto a
# frozen-domain correction. Everything else maps to None = CONTEXT (a null
# player: no financial field this domain tracks). Extend deliberately, with a
# test -- an over-eager alias silently turns a benign event into a player.
ACTIVITY_ALIASES: dict[str, str] = {
    "Change PO Quantity": "Adjust Quantity",
}
KNOWN_CONTEXT_ACTIVITIES = frozenset(
    {
        "Create Purchase Order", "Insert Invoice", "Set Payment Block", "Approve Order",
        "Post Invoice",  # the benchmark target (NET) event
    }
)


def spec_for_activity(activity: str) -> CorrectionSpec | None:
    return CORRECTION_REGISTRY.get(ACTIVITY_ALIASES.get(activity, activity))


def unmapped_activities(activities: Iterable[str]) -> list[str]:
    """Activities that resolve to no correction and are not known context
    activities -- the alignment check for CORRECTION_REGISTRY vs. whatever
    `candidate_extraction` emits on a new dataset."""
    return sorted(
        {a for a in activities if spec_for_activity(a) is None and a not in KNOWN_CONTEXT_ACTIVITIES}
    )


def is_exempt(node_id: str, ctx: DomainContext) -> bool:
    """Policy exception: an approved override. Its correction is the identity
    and the compliant reference keeps its observed value."""
    return node_id in ctx.reference.exceptions


def apply_correction(state: CaseState, node_id: str, ctx: DomainContext) -> CaseState:
    """c(e_i) applied to X. Pure; returns a new state."""
    ntype = ctx.type_of(node_id)
    if ntype in (CONTEXT, NET) or is_exempt(node_id, ctx):
        return state
    spec = next(s for s in _SPECS if s.node_type == ntype)
    own = state.attrs(node_id)
    own.update(spec.compliant_fields(node_id, ctx))
    nodes = {k: dict(v) for k, v in state.nodes.items()}
    nodes[node_id] = own
    nodes[node_id] = transfer_function(node_id, _gather_inputs(nodes, node_id, ctx), ctx)
    return CaseState(nodes)


def apply_corrections(state: CaseState, node_ids: Sequence[str], ctx: DomainContext) -> CaseState:
    """Apply c(e) for each node in the given ORDER (left to right). The order
    is the caller's responsibility -- see ordering.resolve_order."""
    cur = state
    for nid in node_ids:
        cur = apply_correction(cur, nid, ctx)
    return cur


def compliant_state(observed: CaseState, ctx: DomainContext) -> CaseState:
    """X*: every non-exempt input field restored, then fully re-posted
    (consistently) through the pipeline. N* = net(X*) is the policy-compliant
    outcome that Loss(.) measures deviation from."""
    nodes = {k: dict(v) for k, v in observed.nodes.items()}
    for nid in ctx.active_nodes():
        if is_exempt(nid, ctx):
            continue
        spec = next(s for s in _SPECS if s.node_type == ctx.type_of(nid))
        nodes[nid].update(spec.compliant_fields(nid, ctx))
    return recompute_chain(CaseState(nodes), ctx)
