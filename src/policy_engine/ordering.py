"""
ordering.py
-----------
Member 2 -- policy-defined canonical ordering and POLICY-ORDERED
classification (Month 4).

Division of labour with Member 1's confluence checker
-----------------------------------------------------
    Member 1  decides WHETHER orders disagree (order-invariance testing over
              the permutable pairs) and reports which pairs disagree.
    Member 2  (this module) decides WHETHER THE POLICY RESOLVES the
              disagreement:

        resolve_order(...) -> OrderResolution
            status RESOLVED   -> one authoritative total order exists (the
                                 case is POLICY-ORDERED, replay in `sequence`)
            status UNRESOLVED -> at least one disagreeing pair has no
                                 authoritative order (the case is BLOCKED;
                                 `reason_code`/`unresolved_pairs` are what
                                 Member 3 puts in the evidence packet)

Precedence of authority (strictly in this order):
    1. structural `given_constraints` (hard; the log fixed the order)
    2. policy `canonical_orderings` (authoritative where the log is silent)
A policy rule that contradicts a structural lock is NOT applied; it is
reported in `overridden_rules` so the evidence packet can show it. Structure
beats policy because the structural order is what actually happened.

Also here: a REFERENCE probe (`probe_subset`) that brute-forces all legitimate
orders against an `evaluate(order)` callable. It exists so this module and the
benchmark can be tested without Member 1's checker. It is not the official
confluence checker.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from itertools import permutations
from typing import Callable, Iterable, Iterator, Mapping, Sequence

from policy_engine.domain import STAGE_RANK
from policy_engine.schema import CasePolicy, Policy

PASS = "PASS"
POLICY_ORDERED = "POLICY_ORDERED"
BLOCKED = "BLOCKED"

REASON_NO_POLICY_ORDER = "ORDERS_DISAGREE_NO_POLICY_ORDER"
REASON_POLICY_CYCLE = "POLICY_AND_STRUCTURE_CYCLE"


@dataclass(frozen=True)
class OrderResolution:
    status: str  # "NOT_NEEDED" | "RESOLVED" | "UNRESOLVED"
    sequence: tuple[str, ...] = ()
    applied_rules: tuple[str, ...] = ()
    overridden_rules: tuple[dict, ...] = ()
    unresolved_pairs: tuple[tuple[str, str], ...] = ()
    reason_code: str | None = None
    unresolved_fields: tuple[str, ...] = ()  # correction ids involved in unresolved pairs

    @property
    def classification(self) -> str:
        """Verdict for a subset whose orders were found to DISAGREE."""
        return POLICY_ORDERED if self.status == "RESOLVED" else BLOCKED


def _reaches(edges: set[tuple[str, str]], a: str, b: str) -> bool:
    frontier, seen = [a], set()
    while frontier:
        cur = frontier.pop()
        if cur == b:
            return True
        if cur in seen:
            continue
        seen.add(cur)
        frontier.extend(y for (x, y) in edges if x == cur)
    return False


def _policy_edge_rule(policy: Policy, cid_a: str, slot_a: int, cid_b: str, slot_b: int) -> str | None:
    """rule_id of the policy rule that says a-before-b, else None.
    a, b are (correction id, stacking slot). Chains count: a rule chain
    price -> discount -> tax orders price before tax even when no discount
    event is in the subset."""
    if cid_a == cid_b:
        r = policy.within_type_rule(cid_a)
        return r.rule_id if (r is not None and slot_a < slot_b) else None
    if not policy.precedes(cid_a, cid_b):
        return None
    for r in policy.ordering_rules:  # prefer the direct rule on the chain
        if r.kind == "pairwise" and r.before == cid_a and (r.after == cid_b or policy.precedes(r.after, cid_b)):
            return r.rule_id
    return "transitive"


def resolve_order(
    policy: Policy | CasePolicy,
    nodes: Sequence[str],
    correction_ids: Mapping[str, str | None],
    disagreeing_pairs: Iterable[tuple[str, str]],
    structural_pairs: Iterable[tuple[str, str]] | None = None,
    slots: Mapping[str, int] | None = None,
) -> OrderResolution:
    """
    nodes             -- the event ids in the subset S being replayed
    correction_ids    -- node id -> policy correction id (None = no correction)
    disagreeing_pairs -- pairs Member 1's checker found order-sensitive
    structural_pairs  -- (before, after) hard locks; defaults to the CasePolicy's
                         given_constraints when a CasePolicy is passed
    slots             -- discount stacking slot per node (for within-type rules)
    """
    if isinstance(policy, CasePolicy):
        if structural_pairs is None:
            structural_pairs = policy.structural_pairs()
        policy = policy.policy
    slots = slots or {}
    active = [n for n in nodes if correction_ids.get(n)]
    active_set = set(active)

    structural: set[tuple[str, str]] = {
        (a, b) for (a, b) in (structural_pairs or []) if a in active_set and b in active_set
    }
    # transitive closure of structural locks (a chain a<b<c locks a<c too)
    changed = True
    while changed:
        changed = False
        for (a, b) in list(structural):
            for (c, d) in list(structural):
                if b == c and (a, d) not in structural:
                    structural.add((a, d))
                    changed = True

    policy_edges: set[tuple[str, str]] = set()
    applied: list[str] = []
    overridden: list[dict] = []
    for a, b in permutations(active, 2):
        rid = _policy_edge_rule(policy, correction_ids[a], slots.get(a, 0), correction_ids[b], slots.get(b, 0))
        if rid is None:
            continue
        if (b, a) in structural:
            overridden.append({"rule_id": rid, "policy_says": [a, b], "structure_says": [b, a]})
            continue
        policy_edges.add((a, b))
        if rid not in applied:
            applied.append(rid)

    combined = structural | policy_edges
    if _has_cycle(active, combined):
        return OrderResolution(status="UNRESOLVED", reason_code=REASON_POLICY_CYCLE,
                               overridden_rules=tuple(overridden))

    unresolved = []
    for a, b in disagreeing_pairs:
        if a not in active_set or b not in active_set:
            continue  # a pair involving a no-op node cannot be order-sensitive
        if not (_reaches(combined, a, b) or _reaches(combined, b, a)):
            unresolved.append((a, b))
    if unresolved:
        fields = sorted({correction_ids[x] for p in unresolved for x in p})
        return OrderResolution(
            status="UNRESOLVED",
            applied_rules=tuple(applied),
            overridden_rules=tuple(overridden),
            unresolved_pairs=tuple(unresolved),
            reason_code=REASON_NO_POLICY_ORDER,
            unresolved_fields=tuple(fields),
        )

    return OrderResolution(
        status="RESOLVED",
        sequence=tuple(_topological(active, combined, correction_ids, slots)),
        applied_rules=tuple(applied),
        overridden_rules=tuple(overridden),
    )


def _has_cycle(nodes: Sequence[str], edges: set[tuple[str, str]]) -> bool:
    remaining = set(nodes)
    while remaining:
        ready = [n for n in remaining if not any((m, n) in edges for m in remaining if m != n)]
        if not ready:
            return True
        remaining.difference_update(ready)
    return False


def _topological(
    nodes: Sequence[str], edges: set[tuple[str, str]], correction_ids: Mapping[str, str | None], slots: Mapping[str, int]
) -> list[str]:
    """Deterministic topological order (ties: stage rank, slot, id)."""
    from policy_engine.corrections import CORRECTIONS_BY_ID

    def key(n: str):
        cid = correction_ids.get(n)
        rank = STAGE_RANK[CORRECTIONS_BY_ID[cid].node_type] if cid else 99
        return (rank, slots.get(n, 0), n)

    remaining = set(nodes)
    out: list[str] = []
    while remaining:
        ready = sorted((n for n in remaining if not any((m, n) in edges for m in remaining if m != n)), key=key)
        out.append(ready[0])
        remaining.remove(ready[0])
    return out


# ---- reference confluence probe (tests / benchmark; NOT the official checker) ---
def legitimate_orders(nodes: Sequence[str], structural_pairs: Iterable[tuple[str, str]]) -> Iterator[tuple[str, ...]]:
    """Every permutation of `nodes` consistent with the structural locks."""
    locks = [(a, b) for (a, b) in structural_pairs if a in nodes and b in nodes]
    for perm in permutations(nodes):
        pos = {n: i for i, n in enumerate(perm)}
        if all(pos[a] < pos[b] for a, b in locks):
            yield perm


@dataclass(frozen=True)
class SubsetProbe:
    agree: bool
    outcomes: Mapping[tuple[str, ...], Decimal]
    disagreeing_pairs: tuple[tuple[str, str], ...]


def probe_subset(
    nodes: Sequence[str],
    structural_pairs: Iterable[tuple[str, str]],
    evaluate: Callable[[Sequence[str]], Decimal],
) -> SubsetProbe:
    """Brute-force order sensitivity of one subset. `evaluate(order)` returns
    the replayed net for that application order.

    A pair (a, b) is reported order-sensitive iff there are two legitimate
    orders that differ ONLY by swapping a and b while they are adjacent, and
    the outcomes differ. (Adjacent-swap is the right test: the legitimate
    orders form a connected graph under adjacent swaps of unconstrained pairs,
    so the subset agrees iff no adjacent swap changes the outcome. Comparing
    outcome *sets* per relative order, which this replaced, falsely flags
    commuting pairs whenever a third event sits between them in some orders.)
    """
    outcomes = {o: evaluate(o) for o in legitimate_orders(list(nodes), list(structural_pairs))}
    agree = len(set(outcomes.values())) <= 1
    pairs: set[tuple[str, str]] = set()
    if not agree:
        for o, v in outcomes.items():
            for i in range(len(o) - 1):
                swapped = o[:i] + (o[i + 1], o[i]) + o[i + 2:]
                if swapped in outcomes and outcomes[swapped] != v:
                    a, b = sorted((o[i], o[i + 1]))
                    pairs.add((a, b))
    return SubsetProbe(agree=agree, outcomes=outcomes, disagreeing_pairs=tuple(sorted(pairs)))


def classify_case(subset_verdicts: Iterable[str]) -> str:
    """Case-level verdict = the worst subset verdict: BLOCKED > POLICY_ORDERED > PASS."""
    rank = {PASS: 0, POLICY_ORDERED: 1, BLOCKED: 2}
    return max(subset_verdicts, key=rank.__getitem__, default=PASS)
