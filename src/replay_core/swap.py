"""
swap.py
-------
Member 1 -- a SWAP: run chosen posted documents in another order, and change nothing else.

A correction (policy_engine.corrections) restores a node's input to the policy value, so it changes the node's
value whatever the order. A swap does not touch any input, and it never recalculates a node that has no reason to move.
The chosen nodes are applied one by one over the books, each with its OWN RECORDED input:

    * a node that runs BEFORE something it reads keeps its recorded value;
    * any other node is worked out from the values in the books at that moment;
    * a discount that runs after the tax is taken on gross + tax (domain.discount_after_tax).

    case 40, discount e3 (rate 0.11), tax e4 (rate 0.10), rounding e5:
        e3 -> e4   the order that was posted: e3 = 1,267.22, e4 = 1,025.30, the total does not move
        e4 -> e3   tax went first, so it keeps its recorded 1,025.30 and the discount reads it:
                   e3 = 0.11 x (11,520.21 + 1,025.30) = 1,380.01
        e5 -> e3   rounding went first and keeps its recorded -0.02; a discount does not read rounding: nothing moves

So a value only ever moves because the ORDER made it necessary. The stage order always reproduces the books, since that is
how they were posted (domain.recompute_chain). Value changes the user asks for are the Edit button's job.

SwapOperator plugs into everything built on ReplayOperator (run_scenario, build_influence). No money arithmetic lives
here: every amount comes from the domain's own functions.
"""

from __future__ import annotations

from typing import Sequence

from policy_engine import CaseState, compute_net
from policy_engine.corrections import is_exempt
from policy_engine.domain import (
    DISCOUNT, ROUNDING, TAX, DomainContext, _gather_inputs, discount_after_tax, transfer_function,
)

from replay_core.replay import ReplayOperator, ReplayStep, state_differences

DERIVED_FIELD = {DISCOUNT: "amount", TAX: "amount", ROUNDING: "adj"}


def _movable(node_id: str, ctx: DomainContext) -> bool:
    return ctx.type_of(node_id) in DERIVED_FIELD and not is_exempt(node_id, ctx)


def swap_steps(state: CaseState, order: Sequence[str], ctx: DomainContext) -> list[CaseState]:
    """The books after each node of `order` is applied. Nodes that store no derived amount, and exempt nodes, stay put."""
    out, cur = [], state
    for i, n in enumerate(order):
        if _movable(n, ctx) and not set(ctx.upstream(n)) & {x for x in order[i + 1:] if _movable(x, ctx)}:
            inputs = _gather_inputs(cur.nodes, n, ctx)
            tax_first = next((x for x in order[:i] if ctx.type_of(x) == TAX and _movable(x, ctx)), None)
            cur = cur.with_node(n, (discount_after_tax(n, inputs, cur.nodes[tax_first]["amount"], ctx)
                                    if ctx.type_of(n) == DISCOUNT and tax_first else transfer_function(n, inputs, ctx)))
        out.append(cur)
    return out


def swap_state(state: CaseState, order: Sequence[str], ctx: DomainContext) -> CaseState:
    steps = swap_steps(state, order, ctx)
    return steps[-1] if steps else state


class SwapOperator(ReplayOperator):
    """ReplayOperator whose steps re-run the recorded documents in the given order instead of correcting them."""

    is_swap = True

    def noop_reason(self, node_id: str) -> str | None:
        return super().noop_reason(node_id) or (None if _movable(node_id, self.ctx) else "input")

    def _run(self, start: CaseState, order: Sequence[str]) -> tuple[CaseState, tuple[ReplayStep, ...]]:
        cur, steps = start, []
        for i, (nid, nxt) in enumerate(zip(order, swap_steps(start, order, self.ctx))):
            reason = self.noop_reason(nid)
            steps.append(ReplayStep(
                index=i, node_id=nid, correction_id=None, applied=reason is None, noop_reason=reason, state_after=nxt,
                net_after=compute_net(nxt, self.ctx), changed=tuple(state_differences(cur, nxt)),
            ))
            cur = nxt
        return cur, tuple(steps)
