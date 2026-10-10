"""
confluence.py
-------------
Member 1 -- the composition-consistency (confluence) checker (roadmap Month 4, the
critical milestone). It decides, for every subset S of the candidate events,
whether correcting S yields ONE well-defined financial outcome, and classifies

    PASS            every legitimate application order gives the same net
    POLICY_ORDERED  orders disagree, but the policy fixes an authoritative order
    BLOCKED         orders disagree and the policy does not resolve it
                    -> no defensible number; attribution must be withheld

Division of labour
------------------
    this module (Member 1)  WHETHER orders disagree, and WHICH pairs.
    policy_engine.ordering.resolve_order (Member 2)  WHETHER THE POLICY RESOLVES it.
    policy_engine.loss.coalition_value               v(S) on the chosen order.

What "legitimate order" means
-----------------------------
A permutation of S that respects every STRUCTURAL lock (the log fixed that order;
`given_constraints` from constraint_extraction). Structural locks are closed
transitively (a<c and c<b lock a<b even if c is not in S). Only PAIRS WITH NO LOCK
are ever swapped -- those are the permutable pairs. Structure narrows the search;
it does not decide the answer: a structurally permutable pair can still disagree
(its correction arithmetic does not commute) -- that is exactly what is tested.

Events whose correction is the identity (context events, approved exceptions) cannot
change any outcome, so they are dropped from the order search -- but exempt events
remain PLAYERS (value 0) in the subset enumeration, as in the benchmark truth.

How the search works (exact, not sampled)
-----------------------------------------
Brute-forcing all |S|! permutations is ~110k replays for 8 events. Instead we walk the
lattice of "order ideals" (sets of already-applied events that respect the locks) and
keep the set of DISTINCT STATES reached at each ideal, not the set of orders.
    * S agrees  <=>  all distinct final states have the same net.
    * pair (a,b) is order-sensitive  <=>  at some reachable (ideal, state) where both
      are applicable, applying a;b vs b;a leads to states that some common suffix
      carries to different final nets  (memoised `_differ`).
This is exactly the definition of `policy_engine.ordering.probe_subset` (adjacent
swap of an unlocked pair changes the final net) -- the test-suite asserts the two
agree on every subset of every benchmark case -- at a small fraction of the cost.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from itertools import combinations
from typing import Any, Iterable, Mapping, Sequence

from policy_engine import CaseState, apply_correction, compute_net
from policy_engine.ordering import (
    BLOCKED, PASS, POLICY_ORDERED, OrderResolution, classify_case, resolve_order,
)
from policy_engine.schema import CasePolicy, Policy

from replay_core.replay import ReplayOperator, subset_key


class ConfluenceInvariantError(RuntimeError):
    """An internal consistency check failed (a bug, never a data problem)."""


def _state_key(state: CaseState) -> tuple:
    """Hashable, value-equal identity of a state (Decimal hash/eq are value-based).
    Relies on stable dict order (corrections update fields in place); if two equal states ever
    got different keys the only effect would be lost sharing, never a wrong verdict, because
    final outcomes are compared by net, not by key."""
    return tuple((n, tuple(a.items())) for n, a in state.nodes.items())


def transitive_closure(pairs: Iterable[tuple[str, str]]) -> set[tuple[str, str]]:
    cl = {(a, b) for a, b in pairs}
    changed = True
    while changed:
        changed = False
        for (a, b) in list(cl):
            for (c, d) in list(cl):
                if b == c and a != d and (a, d) not in cl:
                    cl.add((a, d))
                    changed = True
    return cl


# --------------------------------------------------------------------------- results
@dataclass(frozen=True)
class SubsetVerdict:
    subset: tuple[str, ...]  # sorted
    verdict: str  # PASS | POLICY_ORDERED | BLOCKED
    agree: bool  # do all legitimate orders give one net?
    effective: tuple[str, ...]  # members whose correction is not the identity
    unlocked_pairs: int  # pairs actually tested (no structural lock)
    locked_pairs: int  # pairs skipped because the log fixed their order
    disagreeing_pairs: tuple[tuple[str, str], ...]
    distinct_nets: tuple[Decimal, ...]  # distinct outcomes over legitimate orders
    order_used: tuple[str, ...] | None  # order replayed for v(S); None if BLOCKED
    value: Decimal | None  # v(S); None if BLOCKED
    resolution: OrderResolution | None  # set when the orders disagreed

    @property
    def key(self) -> str:
        return subset_key(self.subset)

    @property
    def blocked(self) -> bool:
        return self.verdict == BLOCKED

    def to_dict(self) -> dict[str, Any]:
        r = self.resolution
        return {
            "key": self.key, "subset": list(self.subset), "verdict": self.verdict, "agree": self.agree,
            "effective": list(self.effective),
            "unlocked_pairs": self.unlocked_pairs, "locked_pairs": self.locked_pairs,
            "disagreeing_pairs": [list(p) for p in self.disagreeing_pairs],
            "distinct_nets": [str(n) for n in self.distinct_nets],
            "order_used": list(self.order_used) if self.order_used is not None else None,
            "value": str(self.value) if self.value is not None else None,
            "policy": None if r is None else {
                "status": r.status, "reason_code": r.reason_code,
                "applied_rules": list(r.applied_rules),
                "overridden_rules": list(r.overridden_rules),
                "unresolved_pairs": [list(p) for p in r.unresolved_pairs],
                "unresolved_fields": list(r.unresolved_fields),
            },
        }


@dataclass(frozen=True)
class CaseVerdict:
    classification: str  # worst subset verdict
    players: tuple[str, ...]
    subsets: Mapping[str, SubsetVerdict]  # key -> verdict, every subset of the players
    stats: Mapping[str, int]

    @property
    def blocked_subsets(self) -> tuple[SubsetVerdict, ...]:
        return tuple(v for v in self.subsets.values() if v.blocked)

    @property
    def attribution_allowed(self) -> bool:
        """Attribution is only defensible when no subset is BLOCKED."""
        return self.classification != BLOCKED

    def coalition_values(self) -> dict[str, Decimal | None]:
        """key -> v(S), None for BLOCKED subsets (benchmark/evaluate.py format, before str())."""
        return {k: v.value for k, v in self.subsets.items()}

    def prediction(self, shapley: Mapping[str, Any] | None = None) -> dict[str, Any]:
        """The dict `policy_engine.benchmark.evaluate.score_case` expects. `shapley` comes from
        the attribution layer (Member 3); it is forced to None when attribution is not allowed."""
        return {
            "classification": self.classification,
            "coalition_values": {k: (None if v is None else str(v)) for k, v in self.coalition_values().items()},
            "shapley": ({k: str(v) for k, v in shapley.items()} if (shapley and self.attribution_allowed) else None),
        }

    def to_dict(self, include_subsets: bool = True) -> dict[str, Any]:
        worst = [v.to_dict() for v in self.blocked_subsets]
        d: dict[str, Any] = {
            "classification": self.classification, "attribution_allowed": self.attribution_allowed,
            "players": list(self.players), "stats": dict(self.stats),
            "counts": {c: sum(1 for v in self.subsets.values() if v.verdict == c)
                       for c in (PASS, POLICY_ORDERED, BLOCKED)},
            "blocked_subsets": worst[:20],
        }
        if include_subsets:
            d["subsets"] = [v.to_dict() for v in self.subsets.values()]
        return d


# --------------------------------------------------------------------------- the checker
class ConfluenceChecker:
    """Order-invariance testing + verdict classification for ONE case."""

    def __init__(
        self,
        operator: ReplayOperator,
        policy: CasePolicy | Policy,
        structural_pairs: Iterable[tuple[str, str]] | None = None,
        permutable_pairs: Iterable[tuple[str, str]] | None = None,
    ):
        self.op = operator
        self.ctx = operator.ctx
        self.model = operator.model
        self.policy = policy
        if structural_pairs is None:
            structural_pairs = policy.structural_pairs() if isinstance(policy, CasePolicy) else []
        self.locks: set[tuple[str, str]] = transitive_closure(structural_pairs)
        self._permutable = (
            {frozenset(p) for p in permutable_pairs} if permutable_pairs is not None else None
        )
        self.players: tuple[str, ...] = tuple(self.ctx.active_nodes())
        self._rank = {n: i for i, n in enumerate(self.ctx.stage_sorted(self.ctx.node_types))}
        self._cache: dict[frozenset, SubsetVerdict] = {}
        # A state depends only on the sequence of corrections applied to X, so a transition
        # (state, node) -> state is the same in every subset's search: share them all.
        self._trans: dict[tuple, tuple[tuple, CaseState]] = {}
        self._obs_key = _state_key(operator.observed)
        # states reachable at an ideal depend only on the events INSIDE it (locks among them),
        # so a layer is shared by every subset that contains the ideal.
        self._layers: dict[frozenset, dict[tuple, CaseState]] = {}
        self._nets: dict[tuple, Decimal] = {}
        self.stats = {"corrections_applied": 0, "states_explored": 0, "subsets_checked": 0}

    # ---- construction from a loaded benchmark case --------------------------------
    @classmethod
    def from_loaded(cls, loaded) -> "ConfluenceChecker":
        permutable = [(p.event_id_a, p.event_id_b) for p in loaded.constraints.permutable_pairs]
        return cls(loaded.operator(), loaded.policy, permutable_pairs=permutable)

    # ---- internals --------------------------------------------------------------
    def _step(self, key: tuple, state: CaseState, node: str) -> tuple[tuple, CaseState]:
        """Apply one correction, memoised on (state, node). Returns (new key, new state)."""
        hit = self._trans.get((key, node))
        if hit is not None:
            return hit
        self.stats["corrections_applied"] += 1
        nxt = apply_correction(state, node, self.ctx)
        out = (_state_key(nxt), nxt)
        self._trans[(key, node)] = out
        return out

    def _net(self, key: tuple, state: CaseState) -> Decimal:
        n = self._nets.get(key)
        if n is None:
            n = self._nets[key] = compute_net(state, self.ctx)
        return n

    def _layer(self, ideal: frozenset) -> dict[tuple, CaseState]:
        """Distinct states reachable by applying exactly the events of `ideal`, in every order
        consistent with the locks. Built from the layers of (ideal minus one maximal event)."""
        hit = self._layers.get(ideal)
        if hit is not None:
            return hit
        if not ideal:
            out = {self._obs_key: self.op.observed}
        else:
            locks = self._locks_among(ideal)
            out = {}
            for c in sorted(ideal):
                if any(a == c for (a, _b) in locks):  # c has a successor inside the ideal: not last
                    continue
                for k, st in self._layer(ideal - {c}).items():
                    k2, s2 = self._step(k, st, c)
                    out.setdefault(k2, s2)
        self._layers[ideal] = out
        self.stats["states_explored"] += len(out)
        return out

    def _locks_among(self, nodes: Iterable[str]) -> set[tuple[str, str]]:
        s = set(nodes)
        return {(a, b) for (a, b) in self.locks if a in s and b in s}

    def _canonical_legit_order(self, nodes: Sequence[str]) -> tuple[str, ...]:
        """A deterministic order consistent with the locks: stage order wherever free."""
        locks = self._locks_among(nodes)
        remaining, out = set(nodes), []
        while remaining:
            ready = [n for n in remaining if not any((m, n) in locks for m in remaining if m != n)]
            if not ready:
                raise ConfluenceInvariantError(f"structural locks form a cycle among {sorted(remaining)}")
            nxt = min(ready, key=lambda n: self._rank[n])
            out.append(nxt)
            remaining.remove(nxt)
        return tuple(out)

    def _search(self, effective: Sequence[str]):
        """Walk the ideal lattice. Returns (distinct final nets, order-sensitive pairs, #final states)."""
        locks = self._locks_among(effective)
        preds = {n: {a for (a, b) in locks if b == n} for n in effective}
        full = frozenset(effective)

        def enabled(ideal: frozenset) -> list[str]:
            return [n for n in effective if n not in ideal and preds[n] <= ideal]

        final_states = self._layer(full)
        nets = {self._net(k, st) for k, st in final_states.items()}
        n_states = len(final_states)

        # pairs: exists a reachable (ideal, state) and a common suffix where a;b and b;a end apart
        memo: dict[tuple, bool] = {}

        def differ(k1: tuple, s1: CaseState, k2: tuple, s2: CaseState, ideal: frozenset) -> bool:
            if k1 == k2:
                return False
            mk = (ideal, k1, k2)
            if mk in memo:
                return memo[mk]
            if ideal == full:
                res = self._net(k1, s1) != self._net(k2, s2)
            else:
                res = False
                for c in enabled(ideal):
                    a1, b1 = self._step(k1, s1, c)
                    a2, b2 = self._step(k2, s2, c)
                    if differ(a1, b1, a2, b2, ideal | {c}):
                        res = True
                        break
            memo[mk] = res
            return res

        pairs: set[tuple[str, str]] = set()
        if len(nets) > 1:  # a pair can only be order-sensitive if the subset disagrees overall
            ideals, queue = {frozenset()}, [frozenset()]
            while queue:  # every order ideal of this subset, via the enabled events
                cur = queue.pop()
                for c in enabled(cur):
                    if (cur | {c}) not in ideals:
                        ideals.add(cur | {c})
                        queue.append(cur | {c})
            for ideal in ideals:
                states = self._layer(ideal)
                en = enabled(ideal)
                for a, b in combinations(en, 2):
                    if tuple(sorted((a, b))) in pairs:
                        continue
                    for k, s in states.items():
                        ka, sa = self._step(k, s, a)
                        kb, sb = self._step(k, s, b)
                        kab, sab = self._step(ka, sa, b)
                        kba, sba = self._step(kb, sb, a)
                        if differ(kab, sab, kba, sba, ideal | {a, b}):
                            pairs.add(tuple(sorted((a, b))))
                            break
        return tuple(sorted(nets)), tuple(sorted(pairs)), n_states

    # ---- public API ---------------------------------------------------------------
    def check_subset(self, subset: Iterable[str]) -> SubsetVerdict:
        S = tuple(sorted(subset))
        for n in S:
            if n not in self.players:
                raise ValueError(f"{n!r} is not a player (correctable candidate) of this case")
        fs = frozenset(S)
        if fs in self._cache:
            return self._cache[fs]
        self.stats["subsets_checked"] += 1

        effective = tuple(n for n in S if self.op.noop_reason(n) is None)
        locks_in = self._locks_among(effective)
        total_pairs = len(effective) * (len(effective) - 1) // 2
        nets, dis_pairs, n_states = self._search(effective)
        agree = len(nets) <= 1

        # invariant: only permutable pairs can disagree (locked pairs are never swapped)
        for a, b in dis_pairs:
            if (a, b) in locks_in or (b, a) in locks_in:
                raise ConfluenceInvariantError(f"locked pair {a},{b} reported order-sensitive")
            if self._permutable is not None and frozenset((a, b)) not in self._permutable:
                raise ConfluenceInvariantError(
                    f"pair {a},{b} is order-sensitive but constraint extraction did not call it permutable")

        resolution: OrderResolution | None = None
        if agree:
            verdict, order = PASS, self._canonical_legit_order(S)
        else:
            resolution = resolve_order(
                self.policy, list(S), self.model.correction_ids, dis_pairs,
                structural_pairs=self.locks, slots=self.ctx.slots,
            )
            verdict = resolution.classification
            order = tuple(resolution.sequence) if verdict == POLICY_ORDERED else None
            if order is not None:
                if sorted(order) != sorted(S):
                    raise ConfluenceInvariantError(f"policy order {order} is not a permutation of {S}")
                pos = {n: i for i, n in enumerate(order)}
                if any(a in pos and b in pos and pos[a] > pos[b] for (a, b) in self.locks):
                    raise ConfluenceInvariantError(f"policy order {order} violates a structural lock")

        value = None
        if order is not None:
            replay = self.op.replay(S, order)
            value = replay.value

        v = SubsetVerdict(
            subset=S, verdict=verdict, agree=agree, effective=effective,
            unlocked_pairs=total_pairs - len(locks_in), locked_pairs=len(locks_in),
            disagreeing_pairs=dis_pairs, distinct_nets=nets, order_used=order, value=value,
            resolution=resolution,
        )
        self._cache[fs] = v
        return v

    def iter_subsets(self) -> Iterable[tuple[str, ...]]:
        for r in range(len(self.players) + 1):
            yield from combinations(self.players, r)

    def check_case(self) -> CaseVerdict:
        subsets = {}
        for S in self.iter_subsets():
            v = self.check_subset(S)
            subsets[v.key] = v
        verdict = classify_case(v.verdict for v in subsets.values())
        stats = dict(self.stats)
        stats["subsets"] = len(subsets)
        stats["pairs_tested"] = sum(v.unlocked_pairs for v in subsets.values())
        stats["pairs_skipped_locked"] = sum(v.locked_pairs for v in subsets.values())
        stats["pairs_order_sensitive"] = sum(len(v.disagreeing_pairs) for v in subsets.values())
        return CaseVerdict(classification=verdict, players=self.players, subsets=subsets, stats=stats)
