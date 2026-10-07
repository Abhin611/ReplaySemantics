"""
domain.py
---------
Member 2 (Policy, Correction Functions & Benchmark) -- frozen financial domain.

The frozen domain is the small, fully specified financial pipeline that every
correction function, transfer function and benchmark case in ReplaySemantics
operates on:

    Gross (price x quantity) -> Discount (stacked) -> Tax -> Currency
        -> Adjustment (fixed-amount postings) -> Rounding -> Net

    net = (gross - sum(discount) + tax) * fx_rate + sum(adjustment) + rounding_adj

MODELLING ASSUMPTION (read before extending -- this is what makes the
confluence check meaningful):

    Every candidate event is a *posted document* that stores its own derived
    amount (discount.amount, tax.amount, rounding.adj). A correction restores
    its own input field to the policy-compliant value and re-derives ITS OWN
    stored amount from the *current* values of its upstream nodes. It does
    NOT re-post downstream documents. So correcting tax before discount
    leaves tax computed on the old discount (stale); discount-then-tax does
    not. That is the "discount-then-tax vs tax-then-discount" non-commutativity
    from the proposal, and it is exactly what Month 4's order tests detect.

    Stages that are NOT candidate events (no node in the case) are re-derived
    fresh at posting time, so they are never stale.

    A full cascade (propagate_multi, the manual multi-edit feature) is the
    opposite semantic: it re-derives *every* descendant in topological order.
    `recompute_chain` below is the reference implementation of that cascade
    for the frozen domain.

Everything is exact `Decimal` arithmetic -- no floats anywhere -- so two
orders either agree to the paisa or they do not.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import (
    ROUND_DOWN,
    ROUND_HALF_EVEN,
    ROUND_HALF_UP,
    Decimal,
)
from typing import Any, Iterable, Mapping

ZERO = Decimal("0")
ONE = Decimal("1")

# ---- node types (one per frozen-domain stage) -------------------------------
GROSS_PRICE = "gross_price"
GROSS_QTY = "gross_qty"
DISCOUNT = "discount"
TAX = "tax"
CURRENCY = "currency"
ADJUSTMENT = "adjustment"
ROUNDING = "rounding"
NET = "net"
CONTEXT = "context"  # candidate event with no financial effect (a null player)

STAGE_RANK: dict[str, int] = {
    GROSS_PRICE: 0,
    GROSS_QTY: 0,
    DISCOUNT: 1,
    TAX: 2,
    CURRENCY: 3,
    ADJUSTMENT: 4,
    ROUNDING: 5,
    NET: 6,
    CONTEXT: 99,
}
ACTIVE_TYPES = frozenset(
    {GROSS_PRICE, GROSS_QTY, DISCOUNT, TAX, CURRENCY, ADJUSTMENT, ROUNDING}
)
STACKING_MODES = ("additive", "multiplicative")
ROUNDING_MODES: dict[str, str] = {
    "ROUND_HALF_UP": ROUND_HALF_UP,
    "ROUND_HALF_EVEN": ROUND_HALF_EVEN,
    "ROUND_DOWN": ROUND_DOWN,
}


class DomainModelError(ValueError):
    """The case cannot be represented in the frozen domain."""


def D(x: Any) -> Decimal:
    """Exact Decimal from str/int/Decimal. Floats are rejected on purpose."""
    if isinstance(x, Decimal):
        return x
    if isinstance(x, float):
        raise TypeError("floats are not allowed in the financial domain; pass a str or Decimal")
    return Decimal(str(x))


def quantize(x: Decimal, decimals: int, mode: str) -> Decimal:
    return x.quantize(Decimal(1).scaleb(-decimals), rounding=ROUNDING_MODES[mode])


# ---- loss specification -----------------------------------------------------
@dataclass(frozen=True)
class LossSpec:
    """How a deviation from the compliant net becomes a *realized loss*.

    kind="shortfall": loss = max(0, N* - net)            (continuous, under-billing)
    kind="absolute":  loss = |N* - net|
    kind="threshold": loss = `amount` if |N* - net| > tolerance else 0
        -- the proposal's "contract ceiling" mechanism: the confirmed loss is
        realized in full while the breach persists. This is what produces
        genuine interaction (every cause needed) and redundancy (any cause
        suffices) games, depending on how each deviation compares to the
        tolerance.
    """

    kind: str = "shortfall"
    tolerance: Decimal = ZERO
    amount: Decimal | None = None

    def __post_init__(self) -> None:
        if self.kind not in ("shortfall", "absolute", "threshold"):
            raise DomainModelError(f"unknown loss kind {self.kind!r}")
        if self.kind == "threshold" and self.amount is None:
            raise DomainModelError("threshold loss needs an `amount`")

    def to_dict(self) -> dict:
        return {
            "kind": self.kind,
            "tolerance": str(self.tolerance),
            "amount": None if self.amount is None else str(self.amount),
        }

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> "LossSpec":
        amt = d.get("amount")
        return cls(
            kind=d.get("kind", "shortfall"),
            tolerance=D(d.get("tolerance", "0")),
            amount=None if amt is None else D(amt),
        )


# ---- per-case reference data ------------------------------------------------
@dataclass(frozen=True)
class CaseReference:
    """Policy-compliant reference values for ONE case (contract terms, tax
    table lookup, FX table lookup). This is legitimately visible to the
    system -- it is what a compliant posting *would have used* -- and is NOT
    benchmark ground truth."""

    contract_price: Decimal
    ordered_quantity: Decimal
    tax_rate: Decimal
    fx_rate: Decimal
    authorized_discount_rates: Mapping[int, Decimal] = field(default_factory=dict)  # by stack slot
    authorized_adjustments: Mapping[str, Decimal] = field(default_factory=dict)  # by event id
    exceptions: Mapping[str, str] = field(default_factory=dict)  # event id -> approval ref
    loss: LossSpec = field(default_factory=LossSpec)

    def to_dict(self) -> dict:
        return {
            "contract_price": str(self.contract_price),
            "ordered_quantity": str(self.ordered_quantity),
            "tax_rate": str(self.tax_rate),
            "fx_rate": str(self.fx_rate),
            "authorized_discount_rates": {str(k): str(v) for k, v in self.authorized_discount_rates.items()},
            "authorized_adjustments": {k: str(v) for k, v in self.authorized_adjustments.items()},
            "exceptions": dict(self.exceptions),
            "loss": self.loss.to_dict(),
        }

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> "CaseReference":
        return cls(
            contract_price=D(d["contract_price"]),
            ordered_quantity=D(d["ordered_quantity"]),
            tax_rate=D(d["tax_rate"]),
            fx_rate=D(d["fx_rate"]),
            authorized_discount_rates={int(k): D(v) for k, v in d.get("authorized_discount_rates", {}).items()},
            authorized_adjustments={k: D(v) for k, v in d.get("authorized_adjustments", {}).items()},
            exceptions=dict(d.get("exceptions", {})),
            loss=LossSpec.from_dict(d.get("loss", {})),
        )


# ---- state ------------------------------------------------------------------
@dataclass(frozen=True)
class CaseState:
    """The replay state X: attribute dict per node (candidate event) id."""

    nodes: Mapping[str, Mapping[str, Any]]

    def attrs(self, node_id: str) -> dict[str, Any]:
        return dict(self.nodes[node_id])

    def with_node(self, node_id: str, attrs: Mapping[str, Any]) -> "CaseState":
        new = {k: dict(v) for k, v in self.nodes.items()}
        new[node_id] = dict(attrs)
        return CaseState(new)

    def with_nodes(self, updates: Mapping[str, Mapping[str, Any]]) -> "CaseState":
        new = {k: dict(v) for k, v in self.nodes.items()}
        for k, v in updates.items():
            new[k] = dict(v)
        return CaseState(new)

    def snapshot(self) -> dict[str, dict[str, str]]:
        return {k: {a: str(b) for a, b in v.items()} for k, v in sorted(self.nodes.items())}


# ---- graph context (what transfer functions receive) --------------------------
@dataclass(frozen=True)
class DomainContext:
    """The `graph_context` argument of transfer_function().

    node_types: node (event) id -> frozen-domain node type
    slots:      discount node id -> stacking slot (1-based, ascending = applied first)
    """

    node_types: Mapping[str, str]
    reference: CaseReference
    stacking_mode: str = "multiplicative"
    rounding_decimals: int = 2
    rounding_mode: str = "ROUND_HALF_UP"
    slots: Mapping[str, int] = field(default_factory=dict)
    policy_version: str = ""

    def __post_init__(self) -> None:
        if self.stacking_mode not in STACKING_MODES:
            raise DomainModelError(f"unknown stacking mode {self.stacking_mode!r}")
        if self.rounding_mode not in ROUNDING_MODES:
            raise DomainModelError(f"unknown rounding mode {self.rounding_mode!r}")
        for t in (GROSS_PRICE, GROSS_QTY, TAX, CURRENCY, ROUNDING, NET):
            if len(self.nodes_of(t)) > 1:
                raise DomainModelError(
                    f"at most one '{t}' node per case is supported, found {self.nodes_of(t)}"
                )
        slots = [self.slots.get(n) for n in self.nodes_of(DISCOUNT)]
        if len(set(slots)) != len(slots):
            raise DomainModelError(f"discount stacking slots must be unique, got {slots}")

    def type_of(self, node_id: str) -> str:
        return self.node_types[node_id]

    def nodes_of(self, ntype: str) -> list[str]:
        ids = [n for n, t in self.node_types.items() if t == ntype]
        return sorted(ids, key=lambda n: (self.slots.get(n, 0), n))

    def stage_sorted(self, node_ids: Iterable[str] | None = None) -> list[str]:
        ids = list(self.node_types) if node_ids is None else list(node_ids)
        return sorted(ids, key=lambda n: (STAGE_RANK[self.node_types[n]], self.slots.get(n, 0), n))

    def active_nodes(self) -> list[str]:
        return self.stage_sorted(n for n, t in self.node_types.items() if t in ACTIVE_TYPES)

    def upstream(self, node_id: str) -> list[str]:
        """Nodes whose attributes this node's derived amount reads."""
        t = self.node_types[node_id]
        gross = self.nodes_of(GROSS_PRICE) + self.nodes_of(GROSS_QTY)
        if t in (GROSS_PRICE, GROSS_QTY, CURRENCY, ADJUSTMENT, CONTEXT):
            return []
        if t == DISCOUNT:
            prior = []
            if self.stacking_mode == "multiplicative":
                me = self.slots.get(node_id, 0)
                prior = [n for n in self.nodes_of(DISCOUNT) if self.slots.get(n, 0) < me]
            return gross + prior
        if t == TAX:
            return gross + self.nodes_of(DISCOUNT)
        if t == ROUNDING:
            return (
                gross + self.nodes_of(DISCOUNT) + self.nodes_of(TAX)
                + self.nodes_of(CURRENCY) + self.nodes_of(ADJUSTMENT)
            )
        if t == NET:
            return [n for n, nt in self.node_types.items() if nt in ACTIVE_TYPES]
        raise DomainModelError(f"unknown node type {t!r}")

    def downstream_closure(self, node_ids: Iterable[str]) -> set[str]:
        """Every node that (transitively) reads any of `node_ids` -- the set a
        cascade has to recompute."""
        seen: set[str] = set()
        frontier = set(node_ids)
        while frontier:
            nxt = {n for n in self.node_types if any(u in frontier for u in self.upstream(n))} - seen - frontier
            seen |= frontier
            frontier = nxt
        return seen


# ---- arithmetic helpers -------------------------------------------------------
def _own(inputs: Mapping[str, Mapping[str, Any]], ctx: DomainContext, ntype: str) -> Mapping[str, Any] | None:
    ids = ctx.nodes_of(ntype)
    return inputs[ids[0]] if ids else None


def gross_amount(inputs: Mapping[str, Mapping[str, Any]], ctx: DomainContext) -> Decimal:
    p = _own(inputs, ctx, GROSS_PRICE)
    q = _own(inputs, ctx, GROSS_QTY)
    price = D(p["unit_price"]) if p else ctx.reference.contract_price
    qty = D(q["quantity"]) if q else ctx.reference.ordered_quantity
    return price * qty


def discount_total(inputs: Mapping[str, Mapping[str, Any]], ctx: DomainContext) -> Decimal:
    return sum((D(inputs[n]["amount"]) for n in ctx.nodes_of(DISCOUNT)), ZERO)


def tax_amount(inputs: Mapping[str, Mapping[str, Any]], ctx: DomainContext) -> Decimal:
    t = _own(inputs, ctx, TAX)
    if t is not None:
        return D(t["amount"])
    # no tax document in the case: re-derived fresh at posting time
    return ctx.reference.tax_rate * (gross_amount(inputs, ctx) - discount_total(inputs, ctx))


def fx_rate(inputs: Mapping[str, Mapping[str, Any]], ctx: DomainContext) -> Decimal:
    c = _own(inputs, ctx, CURRENCY)
    return D(c["fx_rate"]) if c else ctx.reference.fx_rate


def adjustment_total(inputs: Mapping[str, Mapping[str, Any]], ctx: DomainContext) -> Decimal:
    return sum((D(inputs[n]["amount"]) for n in ctx.nodes_of(ADJUSTMENT)), ZERO)


def pre_rounding(inputs: Mapping[str, Mapping[str, Any]], ctx: DomainContext) -> Decimal:
    base = gross_amount(inputs, ctx) - discount_total(inputs, ctx) + tax_amount(inputs, ctx)
    return base * fx_rate(inputs, ctx) + adjustment_total(inputs, ctx)


def net_components(inputs: Mapping[str, Mapping[str, Any]], ctx: DomainContext) -> dict[str, Decimal]:
    pre = pre_rounding(inputs, ctx)
    r = _own(inputs, ctx, ROUNDING)
    if r is not None:
        adj = D(r["adj"])  # stored (possibly stale) posted rounding difference
    else:
        adj = quantize(pre, ctx.rounding_decimals, ctx.rounding_mode) - pre  # fresh
    g = gross_amount(inputs, ctx)
    return {
        "gross": g,
        "discount": discount_total(inputs, ctx),
        "tax": tax_amount(inputs, ctx),
        "fx_rate": fx_rate(inputs, ctx),
        "adjustment": adjustment_total(inputs, ctx),
        "rounding_adj": adj,
        "net": pre + adj,
    }


def compute_net(state: CaseState, ctx: DomainContext) -> Decimal:
    return net_components(state.nodes, ctx)["net"]


# ---- the transfer functions ------------------------------------------------------
def transfer_function(node_id: str, inputs: Mapping[str, Mapping[str, Any]], graph_context: DomainContext) -> dict[str, Any]:
    """Recompute `node_id`'s attribute dict from its inputs.

    Contract (matches docs/month3_handoff_to_member2.md, section 3, with one
    clarification):

        inputs[node_id]  -- the node's OWN current attribute dict (its input
                            fields, e.g. `rate`, `unit_price`). A cascade
                            merges overrides into this first, then calls us.
        inputs[u]        -- the current attribute dict of every upstream node
                            `u` in graph_context.upstream(node_id), already
                            recomputed if it was edited or is itself
                            downstream of an edit.

    Returns the node's full updated attribute dict: input fields passed
    through unchanged, derived fields (`amount`, `adj`, `net`...) recomputed.
    Pure: never mutates `inputs`.
    """
    ctx = graph_context
    t = ctx.type_of(node_id)
    own = dict(inputs[node_id])

    if t in (GROSS_PRICE, GROSS_QTY, CURRENCY, ADJUSTMENT, CONTEXT):
        return own  # source nodes: no derived field

    if t == DISCOUNT:
        rate = D(own["rate"])
        base = gross_amount(inputs, ctx)
        if ctx.stacking_mode == "multiplicative":
            me = ctx.slots.get(node_id, 0)
            for n in ctx.nodes_of(DISCOUNT):
                if ctx.slots.get(n, 0) < me:
                    base -= D(inputs[n]["amount"])
        own["amount"] = rate * base
        return own

    if t == TAX:
        base = gross_amount(inputs, ctx) - discount_total(inputs, ctx)
        own["amount"] = D(own["rate"]) * base
        return own

    if t == ROUNDING:
        pre = pre_rounding(inputs, ctx)
        own["adj"] = quantize(pre, int(own["decimals"]), own["mode"]) - pre
        return own

    if t == NET:
        comp = net_components(inputs, ctx)
        own.update({k: v for k, v in comp.items()})
        return own

    raise DomainModelError(f"no transfer function for node type {t!r}")


def _gather_inputs(state_nodes: Mapping[str, Mapping[str, Any]], node_id: str, ctx: DomainContext) -> dict[str, Mapping[str, Any]]:
    inputs = {u: state_nodes[u] for u in ctx.upstream(node_id) if u in state_nodes}
    inputs[node_id] = state_nodes[node_id]
    return inputs


def recompute_chain(state: CaseState, ctx: DomainContext, nodes: Iterable[str] | None = None) -> CaseState:
    """Reference FULL CASCADE for the frozen domain: recompute `nodes` (default:
    every node) in stage order, each from already-recomputed upstream.

    This is what a manual multi-edit does (Member 1's propagate_multi should
    produce identical states -- see tests/test_domain.py::test_recompute_chain_matches_manual_cascade).
    It is also how the observed ledger X is "posted": consistently, from the
    (possibly anomalous) raw input fields."""
    order = ctx.stage_sorted(ctx.node_types if nodes is None else nodes)
    cur = {k: dict(v) for k, v in state.nodes.items()}
    for nid in order:
        cur[nid] = transfer_function(nid, _gather_inputs(cur, nid, ctx), ctx)
    return CaseState(cur)


def cascade_edit(state: CaseState, ctx: DomainContext, overrides: Mapping[str, Mapping[str, Any]]) -> CaseState:
    """Apply field overrides to several nodes and recompute exactly their
    downstream closure, in one topological pass (the multi-edit semantic: two
    edits that feed the same descendant are combined, not overwritten)."""
    cur = {k: dict(v) for k, v in state.nodes.items()}
    for nid, fields in overrides.items():
        cur[nid].update(fields)
    touched = ctx.downstream_closure(overrides.keys())
    return recompute_chain(CaseState(cur), ctx, nodes=touched)
