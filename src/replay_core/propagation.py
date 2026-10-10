"""
propagation.py
--------------
Member 1 -- propagate_multi(): multi-node edit with ONE cascade (roadmap Month 3).

The user edits several nodes' input fields in the UI, clicks Run once, and every
downstream value is recomputed in a single topological pass -- two edits that
feed the same descendant are combined, not applied one after the other.

All arithmetic is Member 2's: `policy_engine.cascade_edit` / `recompute_chain`
(which call her `transfer_function`). This module only adds what the UI needs
around it:

    * validation   -- only a node's own INPUT fields can be edited (never a derived
                      amount, never a context node or the target), with a clear error;
    * coercion     -- JSON strings/numbers -> exact Decimal / int;
    * a report     -- which nodes were recomputed (in order), which fields changed,
                      and the net / loss before and after.

Note on "descendants": the cascade follows the frozen-domain STAGE dependencies
(gross -> discount -> tax -> ... -> net), not the OCEL event-graph edges. That is
deliberate: the dependency of one amount on another is a property of the money
arithmetic; the event graph only supplies which events are candidates and the
structural order locks.

Contrast with replay (replay.py): a replay applies a correction that re-derives
ONLY the corrected node's own stored amount (so order matters); a cascade
re-derives EVERY descendant (so the result is order-free and fully consistent).
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, Mapping

from policy_engine import CaseModel, CaseState, cascade_edit, compute_net, loss
from policy_engine.domain import (
    ADJUSTMENT, CURRENCY, DISCOUNT, GROSS_PRICE, GROSS_QTY, ROUNDING, ROUNDING_MODES, TAX,
)

from replay_core.replay import state_differences, state_to_json

# The input fields a user may edit, per frozen-domain node type. Derived fields
# (discount.amount, tax.amount, rounding.adj, net.*) are recomputed, never edited.
EDITABLE_FIELDS: dict[str, tuple[str, ...]] = {
    GROSS_PRICE: ("unit_price",),
    GROSS_QTY: ("quantity",),
    DISCOUNT: ("rate",),
    TAX: ("rate",),
    CURRENCY: ("fx_rate",),
    ADJUSTMENT: ("amount",),
    ROUNDING: ("decimals", "mode"),
}


class PropagationError(ValueError):
    """An edit that cannot be applied (unknown node, non-editable field, bad value)."""


@dataclass(frozen=True)
class PropagationResult:
    base: CaseState
    state: CaseState
    edited: tuple[str, ...]  # nodes the user edited
    recomputed: tuple[str, ...]  # every node the cascade recomputed, in stage order
    changed: tuple[dict[str, Any], ...]  # (node, field, before, after) that actually moved
    net_before: Decimal
    net_after: Decimal
    loss_before: Decimal
    loss_after: Decimal

    def to_dict(self) -> dict[str, Any]:
        return {
            "edited": list(self.edited), "recomputed": list(self.recomputed),
            "changed": list(self.changed),
            "net_before": str(self.net_before), "net_after": str(self.net_after),
            "net_delta": str(self.net_after - self.net_before),
            "loss_before": str(self.loss_before), "loss_after": str(self.loss_after),
            "state_before": state_to_json(self.base), "state_after": state_to_json(self.state),
        }


def _coerce(node: str, ntype: str, fld: str, value: Any) -> Any:
    try:
        if fld == "decimals":
            d = Decimal(str(value))
            if d != d.to_integral_value() or d < 0:
                raise PropagationError(f"{node}.{fld} must be a non-negative whole number, got {value!r}")
            return int(d)
        if fld == "mode":
            if str(value) not in ROUNDING_MODES:
                raise PropagationError(f"{node}.mode must be one of {sorted(ROUNDING_MODES)}, got {value!r}")
            return str(value)
        return Decimal(str(value))
    except InvalidOperation:
        raise PropagationError(f"{node}.{fld}: {value!r} is not a number") from None


def validate_edits(model: CaseModel, edits: Mapping[str, Mapping[str, Any]]) -> dict[str, dict[str, Any]]:
    ctx = model.ctx
    out: dict[str, dict[str, Any]] = {}
    for node, fields in edits.items():
        if node not in ctx.node_types:
            raise PropagationError(f"unknown node {node!r}")
        ntype = ctx.type_of(node)
        allowed = EDITABLE_FIELDS.get(ntype)
        if not allowed:
            raise PropagationError(f"node {node!r} ({ntype}) has no editable fields")
        if not fields:
            raise PropagationError(f"no fields given for node {node!r}")
        out[node] = {}
        for fld, value in fields.items():
            if fld not in allowed:
                raise PropagationError(
                    f"{node}.{fld} is not editable for a {ntype} node (editable: {list(allowed)}); "
                    "derived amounts are recomputed, not edited"
                )
            out[node][fld] = _coerce(node, ntype, fld, value)
    return out


def propagate_multi(
    model: CaseModel,
    edits: Mapping[str, Mapping[str, Any]],
    base: CaseState | None = None,
) -> PropagationResult:
    """Apply several node edits and cascade once.

    `edits` maps node id -> {input field: new value}. `base` defaults to the
    observed state X. Returns the new state plus a report of what moved."""
    ctx = model.ctx
    start = base if base is not None else model.observed
    clean = validate_edits(model, edits)
    new_state = cascade_edit(start, ctx, clean)
    recomputed = tuple(ctx.stage_sorted(ctx.downstream_closure(clean.keys())))
    return PropagationResult(
        base=start, state=new_state, edited=tuple(sorted(clean)), recomputed=recomputed,
        changed=tuple(state_differences(start, new_state)),
        net_before=compute_net(start, ctx), net_after=compute_net(new_state, ctx),
        loss_before=loss(start, model.observed, ctx), loss_after=loss(new_state, model.observed, ctx),
    )
