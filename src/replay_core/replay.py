"""
replay.py
---------
Member 1 -- the replay operator R_P(X, S)  (roadmap Month 3).

    X   the observed (as-posted, anomalous) state of one case
    S   a subset of the candidate events whose corrections we apply
    P   the policy (carried inside the CaseModel's DomainContext)

    R_P(X, S) = c(e_k) o ... o c(e_1) (X)      in a GIVEN application order

What lives where
----------------
    policy_engine (Member 2)   the arithmetic: the correction functions c(e),
                               the net, the loss, v(S) = Loss(empty) - Loss(R(S)).
    this module   (Member 1)   WHICH subset, in WHICH order, and the audit
                               trail: the state after every single correction.

This module deliberately contains no money arithmetic. It composes
`apply_correction` and reads `compute_net` / `loss` / `coalition_value`, so a
change to a correction function in policy_engine changes replay results and
nothing here needs to be edited.

The ORDER is an input, never something this operator decides:
    * default order  = canonical = stage order, upstream first
                       (gross -> discount -> tax -> currency -> adjustment -> rounding);
    * the confluence checker (Month 4) calls `replay` with every legitimate
      order and compares the outcomes;
    * `policy_engine.ordering.resolve_order` supplies the authoritative order
      for POLICY-ORDERED subsets.

Idempotence (`check_idempotence`) is likewise ORDER-SPECIFIC: R(R(X,S),S) = R(X,S)
holds for the canonical order but can fail for others (tax-then-discount leaves
the tax computed on the old discount; replaying converges it on the second pass).
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Iterable, Sequence

from policy_engine import CaseModel, CaseState, apply_correction, compute_net, loss
from policy_engine.corrections import compliant_state, is_exempt
from policy_engine.domain import CONTEXT, NET, DomainContext
from policy_engine.loss import coalition_value, compliant_net


class ReplayError(ValueError):
    """Bad subset / order passed to the replay operator."""


# --------------------------------------------------------------------------- helpers
def subset_key(subset: Iterable[str]) -> str:
    """Canonical string key for a subset, e.g. ('e2','e1') -> 'e1,e2'; empty -> ''.
    Matches the key format of the benchmark's coalition_values / subset_verdicts."""
    return ",".join(sorted(subset))


def _jsonable(x: Any) -> Any:
    return str(x) if isinstance(x, Decimal) else x


def state_to_json(state: CaseState) -> dict[str, dict[str, Any]]:
    """Decimal-safe dict form of a state (every Decimal as an exact string)."""
    return {n: {k: _jsonable(v) for k, v in attrs.items()} for n, attrs in sorted(state.nodes.items())}


def _values_equal(a: Any, b: Any) -> bool:
    if isinstance(a, Decimal) or isinstance(b, Decimal):
        try:
            return Decimal(str(a)) == Decimal(str(b))  # 1.0 == 1.00
        except Exception:
            return False
    return a == b


def state_differences(a: CaseState, b: CaseState) -> list[dict[str, Any]]:
    """Every (node, field) where two states differ -- exact Decimal comparison."""
    out: list[dict[str, Any]] = []
    for node in sorted(set(a.nodes) | set(b.nodes)):
        fa, fb = a.nodes.get(node, {}), b.nodes.get(node, {})
        for fld in sorted(set(fa) | set(fb)):
            if fld not in fa or fld not in fb or not _values_equal(fa[fld], fb[fld]):
                out.append({"node": node, "field": fld,
                            "before": _jsonable(fa.get(fld)), "after": _jsonable(fb.get(fld))})
    return out


# --------------------------------------------------------------------------- results
@dataclass(frozen=True)
class ReplayStep:
    """One correction in the replay: what was applied and what the case looked like after."""

    index: int
    node_id: str
    correction_id: str | None
    applied: bool  # False => the correction was the identity (see noop_reason)
    noop_reason: str | None  # "context" | "exempt" | None
    state_after: CaseState
    net_after: Decimal
    changed: tuple[dict[str, Any], ...]  # field-level diff vs the previous step

    def to_dict(self) -> dict[str, Any]:
        return {
            "index": self.index, "node_id": self.node_id, "correction_id": self.correction_id,
            "applied": self.applied, "noop_reason": self.noop_reason,
            "net_after": str(self.net_after), "changed": list(self.changed),
            "state_after": state_to_json(self.state_after),
        }


@dataclass(frozen=True)
class ReplayResult:
    subset: tuple[str, ...]  # S, sorted
    order: tuple[str, ...]  # the application order actually used
    state: CaseState  # R_P(X, S)
    net: Decimal
    loss: Decimal  # Loss(R_P(X, S))
    value: Decimal  # v(S) = Loss(empty) - Loss(R_P(X, S))
    observed_net: Decimal
    compliant_net: Decimal  # N*
    trace: tuple[ReplayStep, ...]
    noops: tuple[str, ...]  # nodes in S whose correction was the identity

    @property
    def key(self) -> str:
        return subset_key(self.subset)

    @property
    def reaches_compliant_net(self) -> bool:
        return self.net == self.compliant_net

    def to_dict(self, include_trace: bool = True) -> dict[str, Any]:
        d: dict[str, Any] = {
            "subset": list(self.subset), "key": self.key, "order": list(self.order),
            "net": str(self.net), "observed_net": str(self.observed_net),
            "compliant_net": str(self.compliant_net),
            "loss": str(self.loss), "value": str(self.value),
            "reaches_compliant_net": self.reaches_compliant_net,
            "noops": list(self.noops), "state": state_to_json(self.state),
        }
        if include_trace:
            d["trace"] = [s.to_dict() for s in self.trace]
        return d


@dataclass(frozen=True)
class IdempotenceResult:
    """R(R(X,S),S) vs R(X,S) for ONE application order."""

    order: tuple[str, ...]
    idempotent: bool
    differences: tuple[dict[str, Any], ...]  # (node, field) that moved on the second pass
    net_once: Decimal
    net_twice: Decimal

    def to_dict(self) -> dict[str, Any]:
        return {
            "order": list(self.order), "idempotent": self.idempotent,
            "net_once": str(self.net_once), "net_twice": str(self.net_twice),
            "differences": list(self.differences),
        }


# --------------------------------------------------------------------------- operator
class ReplayOperator:
    """R_P(X, S) for one case. Pure and stateless apart from cached case constants."""

    def __init__(self, model: CaseModel):
        self.model = model
        self.ctx: DomainContext = model.ctx
        self.observed: CaseState = model.observed
        self.observed_net: Decimal = compute_net(self.observed, self.ctx)
        self.compliant_state: CaseState = compliant_state(self.observed, self.ctx)
        self.compliant_net: Decimal = compliant_net(self.observed, self.ctx)
        self.observed_loss: Decimal = loss(self.observed, self.observed, self.ctx)  # Loss(empty)

    # ---- the candidate set ---------------------------------------------------
    @property
    def candidate_ids(self) -> tuple[str, ...]:
        """E: every candidate event node (the target / net node is not a candidate)."""
        return tuple(self.ctx.stage_sorted(n for n, t in self.ctx.node_types.items() if t != NET))

    @property
    def active_ids(self) -> tuple[str, ...]:
        """Candidates whose correction actually changes something: correctable and not exempt.
        These are the only players the confluence checker and Shapley need to consider."""
        return tuple(n for n in self.ctx.active_nodes() if not is_exempt(n, self.ctx))

    @property
    def is_replayable(self) -> bool:
        """False when no candidate has a correctable, non-exempt effect. That is what a
        case with no pricing fields looks like (e.g. real VBFA events: every candidate
        becomes a null 'context' node and the loss is zero). Callers must report such a
        case as NOT APPLICABLE -- never as a PASS with nothing to attribute."""
        return bool(self.active_ids)

    def noop_reason(self, node_id: str) -> str | None:
        t = self.ctx.type_of(node_id)
        if t == CONTEXT:
            return "context"
        if is_exempt(node_id, self.ctx):
            return "exempt"
        return None

    # ---- orders ----------------------------------------------------------------
    def canonical_order(self, subset: Iterable[str]) -> tuple[str, ...]:
        """Stage order, upstream first. The default order, and the order for which
        idempotence is expected to hold."""
        return tuple(self.ctx.stage_sorted(self._validated_subset(subset)))

    # ---- validation ------------------------------------------------------------
    def _validated_subset(self, subset: Iterable[str]) -> tuple[str, ...]:
        ids = list(subset)
        if len(set(ids)) != len(ids):
            raise ReplayError(f"duplicate events in subset: {sorted(i for i in ids if ids.count(i) > 1)}")
        for n in ids:
            if n not in self.ctx.node_types:
                raise ReplayError(f"unknown event id {n!r} (not a candidate of this case)")
            if self.ctx.type_of(n) == NET:
                raise ReplayError(f"{n!r} is the target event, not a candidate; it cannot be corrected")
        return tuple(ids)

    def _validated_order(self, subset: tuple[str, ...], order: Sequence[str] | None) -> tuple[str, ...]:
        if order is None:
            return tuple(self.ctx.stage_sorted(subset))
        order = tuple(order)
        if sorted(order) != sorted(subset):
            raise ReplayError(f"order {list(order)} is not a permutation of the subset {sorted(subset)}")
        return order

    # ---- the operator ----------------------------------------------------------
    def _run(self, start: CaseState, order: Sequence[str]) -> tuple[CaseState, tuple[ReplayStep, ...]]:
        cur = start
        steps: list[ReplayStep] = []
        for i, nid in enumerate(order):
            nxt = apply_correction(cur, nid, self.ctx)
            reason = self.noop_reason(nid)
            steps.append(ReplayStep(
                index=i, node_id=nid, correction_id=self.model.correction_ids.get(nid),
                applied=reason is None, noop_reason=reason, state_after=nxt,
                net_after=compute_net(nxt, self.ctx),
                changed=tuple(state_differences(cur, nxt)),
            ))
            cur = nxt
        return cur, tuple(steps)

    def replay(self, subset: Iterable[str], order: Sequence[str] | None = None) -> ReplayResult:
        """R_P(X, S) applying the corrections of `subset` in `order`
        (default: canonical stage order)."""
        sub = self._validated_subset(subset)
        used = self._validated_order(sub, order)
        final, trace = self._run(self.observed, used)
        return ReplayResult(
            subset=tuple(sorted(sub)), order=used, state=final,
            net=compute_net(final, self.ctx),
            loss=loss(final, self.observed, self.ctx),
            value=coalition_value(final, self.observed, self.ctx),
            observed_net=self.observed_net, compliant_net=self.compliant_net,
            trace=trace, noops=tuple(n for n in used if self.noop_reason(n)),
        )

    def replay_all(self, order: Sequence[str] | None = None) -> ReplayResult:
        """R_P(X, E): every candidate corrected (canonical order unless given)."""
        return self.replay(self.candidate_ids, order)

    def check_idempotence(self, subset: Iterable[str], order: Sequence[str] | None = None) -> IdempotenceResult:
        """Is R(R(X,S),S) = R(X,S) for this order? Re-applies the SAME order to
        the already-replayed state and reports any (node, field) that moves."""
        sub = self._validated_subset(subset)
        used = self._validated_order(sub, order)
        once, _ = self._run(self.observed, used)
        twice, _ = self._run(once, used)
        diffs = tuple(state_differences(once, twice))
        return IdempotenceResult(
            order=used, idempotent=not diffs, differences=diffs,
            net_once=compute_net(once, self.ctx), net_twice=compute_net(twice, self.ctx),
        )

    def idempotent_in_canonical_order(self, subset: Iterable[str]) -> bool:
        return self.check_idempotence(subset).idempotent
