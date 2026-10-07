"""
case_builder.py
---------------
Member 2 -- glue between Member 1's candidate events and the frozen domain.

    candidate events (OCELEvent: .event_id, .activity, .attributes)
        + Policy + CaseReference
        -> DomainContext (node types, stacking slots, policy constants)
        -> observed state X (posted consistently from the observed raw fields)

Dispatch is by ACTIVITY STRING through the policy's correction table (with
the aliases in corrections.py). Candidates whose activity is not in the
policy become CONTEXT nodes: null players with no replayable correction.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Protocol

from policy_engine.corrections import CORRECTIONS_BY_ID
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
    CaseReference,
    CaseState,
    DomainContext,
    DomainModelError,
    D,
    recompute_chain,
)
from policy_engine.schema import Policy


class EventLike(Protocol):  # replay_core.models.OCELEvent satisfies this
    event_id: str
    activity: str
    attributes: Mapping[str, Any]


@dataclass(frozen=True)
class CaseModel:
    ctx: DomainContext
    observed: CaseState  # X: the as-posted (anomalous) state
    correction_ids: Mapping[str, str | None]  # node id -> policy correction id (None for context/net)

    def node_for(self, event_id: str) -> str:
        return event_id


def _raw_fields(ntype: str, ev: EventLike) -> dict[str, Any]:
    a = ev.attributes

    def need(key: str) -> Any:
        if key not in a or a[key] in (None, ""):
            raise DomainModelError(f"event {ev.event_id} ({ev.activity}) is missing attribute '{key}'")
        return a[key]

    if ntype == GROSS_PRICE:
        return {"unit_price": D(need("unit_price"))}
    if ntype == GROSS_QTY:
        return {"quantity": D(need("quantity"))}
    if ntype == DISCOUNT:
        return {"rate": D(need("rate")), "slot": int(need("slot"))}
    if ntype == TAX:
        return {"rate": D(need("rate"))}
    if ntype == CURRENCY:
        return {"fx_rate": D(need("fx_rate"))}
    if ntype == ADJUSTMENT:
        return {"amount": D(need("amount"))}
    if ntype == ROUNDING:
        return {"decimals": int(need("decimals")), "mode": str(need("mode"))}
    return {}


def build_case(
    candidate_events: Iterable[EventLike],
    policy: Policy,
    reference: CaseReference,
    target_event: EventLike | None = None,
) -> CaseModel:
    node_types: dict[str, str] = {}
    slots: dict[str, int] = {}
    raw: dict[str, dict[str, Any]] = {}
    cids: dict[str, str | None] = {}

    for ev in candidate_events:
        rule = policy.correction_for_activity(ev.activity)
        if rule is None:
            node_types[ev.event_id] = CONTEXT
            raw[ev.event_id] = {}
            cids[ev.event_id] = None
            continue
        ntype = CORRECTIONS_BY_ID[rule.correction_id].node_type
        node_types[ev.event_id] = ntype
        raw[ev.event_id] = _raw_fields(ntype, ev)
        cids[ev.event_id] = rule.correction_id
        if ntype == DISCOUNT:
            slots[ev.event_id] = raw[ev.event_id].pop("slot")

    if target_event is not None:
        node_types[target_event.event_id] = NET
        raw[target_event.event_id] = {}
        cids[target_event.event_id] = None

    ctx = DomainContext(
        node_types=node_types,
        reference=reference,
        stacking_mode=policy.stacking_mode,
        rounding_decimals=policy.rounding_decimals,
        rounding_mode=policy.rounding_mode,
        slots=slots,
        policy_version=policy.policy_version,
    )
    observed = recompute_chain(CaseState(raw), ctx)  # post consistently from the observed raw fields
    return CaseModel(ctx=ctx, observed=observed, correction_ids=cids)
