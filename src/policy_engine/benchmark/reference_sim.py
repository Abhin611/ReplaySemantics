"""
reference_sim.py
----------------
Member 2 -- the benchmark's REFERENCE SIMULATOR and ground-truth oracle.

    *** This is NOT the replay operator R_P(X,S). ***
    R_P is Member 1's deliverable (replay_core). This module is a deliberately
    separate, from-scratch re-implementation of the frozen-domain arithmetic
    that the benchmark generator uses to compute HIDDEN ground truth
    (coalition values, Shapley shares, validity label). It imports nothing
    from policy_engine.domain / corrections, so that

        system output  ==  benchmark truth

    is evidence of two independent implementations agreeing, not one
    implementation agreeing with itself. tests/test_benchmark.py cross-checks
    the two on every generated case.

It works on plain dicts (`base`, `events`) built by the generator, never on
the system's CaseModel.
"""

from __future__ import annotations

from decimal import ROUND_DOWN, ROUND_HALF_EVEN, ROUND_HALF_UP, Decimal
from fractions import Fraction
from itertools import combinations, permutations
from math import factorial
from typing import Iterable, Mapping, Sequence

_MODES = {"ROUND_HALF_UP": ROUND_HALF_UP, "ROUND_HALF_EVEN": ROUND_HALF_EVEN, "ROUND_DOWN": ROUND_DOWN}
_RANK = {"price": 0, "qty": 0, "discount": 1, "tax": 2, "currency": 3, "adjustment": 4, "rounding": 5}
ACTIVE_KINDS = frozenset(_RANK)


def _q(x: Decimal, dp: int, mode: str) -> Decimal:
    return x.quantize(Decimal(1).scaleb(-dp), rounding=_MODES[mode])


class _Ledger:
    """raw input fields + stored (posted) derived amounts, per active event."""

    def __init__(self, base: Mapping, events: Mapping[str, Mapping], fields: Mapping[str, Mapping]):
        self.base = base
        self.kind = {i: e["kind"] for i, e in events.items() if e["kind"] in ACTIVE_KINDS}
        self.slot = {i: e.get("slot") or 0 for i, e in events.items() if e["kind"] == "discount"}
        self.raw = {i: dict(fields[i]) for i in self.kind}
        self.amt: dict[str, Decimal] = {}  # discount/tax stored amounts
        self.adj: Decimal | None = None  # rounding stored adj
        self.has = set(self.kind.values())

    # -- accessors
    def ids(self, kind: str) -> list[str]:
        return sorted((i for i, k in self.kind.items() if k == kind), key=lambda i: (self.slot.get(i, 0), i))

    def gross(self) -> Decimal:
        p = self.raw[self.ids("price")[0]]["unit_price"] if "price" in self.has else self.base["price"]
        q = self.raw[self.ids("qty")[0]]["quantity"] if "qty" in self.has else self.base["qty"]
        return p * q

    def disc_total(self) -> Decimal:
        return sum((self.amt[i] for i in self.ids("discount")), Decimal(0))

    def tax(self) -> Decimal:
        if "tax" in self.has:
            return self.amt[self.ids("tax")[0]]
        return self.base["tax_rate"] * (self.gross() - self.disc_total())

    def fx(self) -> Decimal:
        return self.raw[self.ids("currency")[0]]["fx_rate"] if "currency" in self.has else self.base["fx"]

    def adj_total(self) -> Decimal:
        return sum((self.raw[i]["amount"] for i in self.ids("adjustment")), Decimal(0))

    def pre(self) -> Decimal:
        return (self.gross() - self.disc_total() + self.tax()) * self.fx() + self.adj_total()

    def net(self) -> Decimal:
        pre = self.pre()
        if "rounding" in self.has:
            return pre + self.adj
        return _q(pre, self.base["dp"], self.base["mode"])

    # -- (re)derive ONE node's stored amount from current state
    def derive(self, nid: str) -> None:
        k = self.kind[nid]
        if k == "discount":
            base_amt = self.gross()
            if self.base["stacking"] == "multiplicative":
                for j in self.ids("discount"):
                    if self.slot[j] < self.slot[nid]:
                        base_amt -= self.amt[j]
            self.amt[nid] = self.raw[nid]["rate"] * base_amt
        elif k == "tax":
            self.amt[nid] = self.raw[nid]["rate"] * (self.gross() - self.disc_total())
        elif k == "rounding":
            pre = self.pre()
            self.adj = _q(pre, self.raw[nid]["decimals"], self.raw[nid]["mode"]) - pre

    def post_all(self) -> None:
        """Consistent posting from the raw fields, stage by stage."""
        for nid in sorted(self.kind, key=lambda i: (_RANK[self.kind[i]], self.slot.get(i, 0), i)):
            self.derive(nid)


def _observed_fields(events: Mapping[str, Mapping]) -> dict[str, dict]:
    return {i: dict(e["observed"]) for i, e in events.items() if e["kind"] in ACTIVE_KINDS}


def simulate(base: Mapping, events: Mapping[str, Mapping], order: Sequence[str]) -> Decimal:
    """Net after correcting exactly `order` (left to right) starting from the
    observed, consistently posted ledger."""
    fields = _observed_fields(events)
    led = _Ledger(base, events, fields)
    led.post_all()
    for nid in order:
        e = events[nid]
        if e["kind"] not in ACTIVE_KINDS or e.get("exempt"):
            continue
        led.raw[nid].update(e["compliant"])
        led.derive(nid)
    return led.net()


def compliant_net(base: Mapping, events: Mapping[str, Mapping]) -> Decimal:
    fields = {
        i: dict(e["observed"] if e.get("exempt") else e["compliant"])
        for i, e in events.items() if e["kind"] in ACTIVE_KINDS
    }
    led = _Ledger(base, events, fields)
    led.post_all()
    return led.net()


def loss_of(spec: Mapping, net: Decimal, n_star: Decimal) -> Decimal:
    dev = n_star - net
    if spec["kind"] == "shortfall":
        return max(Decimal(0), dev)
    if spec["kind"] == "absolute":
        return abs(dev)
    return spec["amount"] if abs(dev) > spec["tolerance"] else Decimal(0)


# ---- policy precedence, re-derived independently from the policy JSON ---------
_CID_KIND = {
    "price_correction": "price", "quantity_correction": "qty", "discount_correction": "discount",
    "tax_correction": "tax", "currency_correction": "currency",
    "adjustment_correction": "adjustment", "rounding_correction": "rounding",
}


def policy_kind_precedence(policy_dict: Mapping) -> tuple[set[tuple[str, str]], bool]:
    """(transitive closure of 'kind a before kind b', within-type slot rule present)."""
    edges = {
        (_CID_KIND[r["before"]], _CID_KIND[r["after"]])
        for r in policy_dict.get("canonical_orderings", []) if "before" in r
    }
    within = any("within" in r for r in policy_dict.get("canonical_orderings", []))
    kinds = {k for e in edges for k in e}
    for m in kinds:
        for a in kinds:
            for b in kinds:
                if (a, m) in edges and (m, b) in edges:
                    edges.add((a, b))
    return edges, within


def _policy_pairs(active: Sequence[str], events: Mapping, prec: set, within: bool) -> set[tuple[str, str]]:
    out = set()
    for a, b in permutations(active, 2):
        ka, kb = events[a]["kind"], events[b]["kind"]
        if ka == kb:
            if within and ka == "discount" and events[a]["slot"] < events[b]["slot"]:
                out.add((a, b))
        elif (ka, kb) in prec:
            out.add((a, b))
    return out


def _closure(pairs: Iterable[tuple[str, str]]) -> set[tuple[str, str]]:
    cl = set(pairs)
    changed = True
    while changed:
        changed = False
        for (a, b) in list(cl):
            for (c, d) in list(cl):
                if b == c and (a, d) not in cl:
                    cl.add((a, d))
                    changed = True
    return cl


def _legit(nodes: Sequence[str], structural: set[tuple[str, str]]) -> list[tuple[str, ...]]:
    out = []
    for perm in permutations(nodes):
        pos = {n: i for i, n in enumerate(perm)}
        if all(pos[a] < pos[b] for (a, b) in structural if a in pos and b in pos):
            out.append(perm)
    return out


def shapley_exact(players: Sequence[str], v: Mapping[frozenset, Fraction]) -> dict[str, Fraction]:
    n = len(players)
    phi: dict[str, Fraction] = {}
    for i in players:
        rest = [p for p in players if p != i]
        total = Fraction(0)
        for r in range(len(rest) + 1):
            w = Fraction(factorial(r) * factorial(n - r - 1), factorial(n))
            for S in combinations(rest, r):
                s = frozenset(S)
                total += w * (v[s | {i}] - v[s])
        phi[i] = total
    return phi


def compute_truth(
    base: Mapping,
    events: Mapping[str, Mapping],
    loss_spec: Mapping,
    policy_dict: Mapping,
    structural_pairs: Iterable[tuple[str, str]],
) -> dict:
    """Hidden ground truth for one case.

    Verdict definition (outcome-based):
      * legitimate orders = permutations of S consistent with the structural
        locks. If every legitimate order yields the same NET -> PASS for S.
      * else restrict to legitimate orders that also respect every policy
        precedence not contradicted by a structural lock. If all of THOSE
        agree -> POLICY_ORDERED for S (value = that common net).
      * else -> BLOCKED for S (no defensible value).
    Case verdict = worst subset verdict. Shapley is defined only when no
    subset is BLOCKED.
    """
    active = sorted(i for i, e in events.items() if e["kind"] in ACTIVE_KINDS)
    all_ids = sorted(events)
    structural = _closure({(a, b) for (a, b) in structural_pairs if a in active and b in active})
    prec, within = policy_kind_precedence(policy_dict)
    pol = {(a, b) for (a, b) in _policy_pairs(active, events, prec, within) if (b, a) not in structural}

    n_star = compliant_net(base, events)
    l0 = loss_of(loss_spec, simulate(base, events, []), n_star)

    values: dict[frozenset, Fraction | None] = {}
    verdicts: dict[frozenset, str] = {}
    for r in range(len(active) + 1):
        for S in combinations(active, r):
            legit = _legit(S, structural)
            nets = {o: simulate(base, events, o) for o in legit}
            if len(set(nets.values())) <= 1:
                verdict, net = "PASS", next(iter(nets.values()))
            else:
                consistent = [o for o in legit if all(o.index(a) < o.index(b) for (a, b) in pol if a in o and b in o)]
                cn = {nets[o] for o in consistent}
                if consistent and len(cn) == 1:
                    verdict, net = "POLICY_ORDERED", next(iter(cn))
                else:
                    verdict, net = "BLOCKED", None
            verdicts[frozenset(S)] = verdict
            values[frozenset(S)] = None if net is None else Fraction(l0 - loss_of(loss_spec, net, n_star))

    rank = {"PASS": 0, "POLICY_ORDERED": 1, "BLOCKED": 2}
    case_verdict = max(verdicts.values(), key=rank.__getitem__)
    phi = None
    if case_verdict != "BLOCKED":
        phi = shapley_exact(active, values)  # type: ignore[arg-type]
        assert sum(phi.values()) == values[frozenset(active)]  # efficiency, exact in Fraction

    return {
        "candidate_event_ids": all_ids,
        "active_event_ids": active,
        "realized_loss": l0,
        "compliant_net": n_star,
        "classification": case_verdict,
        "subset_verdicts": {tuple(sorted(s)): v for s, v in verdicts.items()},
        "coalition_values": {tuple(sorted(s)): v for s, v in values.items()},
        "shapley": phi,
    }
