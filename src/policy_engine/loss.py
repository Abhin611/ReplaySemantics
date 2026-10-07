"""
loss.py
-------
Member 2 -- Loss(.) and the coalition value v(S) = Loss(empty) - Loss(R_P(X,S)).

Loss measures deviation of a replay state from the policy-compliant net N*
under the case's LossSpec (see domain.LossSpec). Member 3 owns the coalition
*table* and Shapley; this module only supplies the domain's Loss function so
that v(S) is defined in one place.
"""

from __future__ import annotations

from decimal import Decimal

from policy_engine.corrections import compliant_state
from policy_engine.domain import ZERO, CaseState, DomainContext, compute_net


def compliant_net(observed: CaseState, ctx: DomainContext) -> Decimal:
    return compute_net(compliant_state(observed, ctx), ctx)


def deviation(state: CaseState, observed: CaseState, ctx: DomainContext) -> Decimal:
    """Signed: N* - net(state). Positive = under-billed relative to policy."""
    return compliant_net(observed, ctx) - compute_net(state, ctx)


def loss(state: CaseState, observed: CaseState, ctx: DomainContext) -> Decimal:
    spec = ctx.reference.loss
    dev = deviation(state, observed, ctx)
    if spec.kind == "shortfall":
        return max(ZERO, dev)
    if spec.kind == "absolute":
        return abs(dev)
    return spec.amount if abs(dev) > spec.tolerance else ZERO  # threshold


def coalition_value(replayed: CaseState, observed: CaseState, ctx: DomainContext) -> Decimal:
    """v(S) = Loss(empty) - Loss(R_P(X,S)), where `replayed` = R_P(X,S)."""
    return loss(observed, observed, ctx) - loss(replayed, observed, ctx)
