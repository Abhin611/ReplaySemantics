"""
influence.py
------------
Month 6 (interface support) -- HOW a correction in one node reaches the other nodes.

The replay of step 4 corrects a node by restoring its own input and re-deriving ONLY its own stored
amount. Every node that reads that amount (the dependents in the money model: price -> discount -> tax
-> rounding -> total) is therefore left out of date until it is corrected itself. This module makes
that visible and exact, for one chosen change and one chosen order:

  steps       after each correction: the node's own field changes, the change in the case total, and every
              dependent whose stored amount is now out of date, by exactly how much (stale gap =
              what the node's own transfer function would produce now minus what it stores).
  influence   for each pair (u, d) of corrected nodes where d depends on u: d's corrected amount when u
              was corrected first minus d's corrected amount without u. This is the number that makes
              the ORDER of corrections matter.
  interactions for each pair in the change: v(ab) - v(a) - v(b) from the coalition table. Zero means the
              two corrections add up; non-zero means they interact (synergy or overlap).
  nodes       one ledger row per node touched: hop, role, field changes, who influenced it, who it
              influences, its marginal value at its step and its Shapley share.
  narrative   the same facts as plain sentences (also used for the downloadable report).

Nothing here is a new model: every number is produced by replaying the real correction functions and
transfer functions of the policy engine, so it cannot disagree with the replay or the checker.
"""

from __future__ import annotations

from decimal import Decimal
from itertools import combinations
from typing import Any, Mapping, Sequence

from policy_engine.domain import (  # noqa: PLC2701 (_gather_inputs is the domain's own input gatherer)
    CONTEXT, DISCOUNT, NET, ROUNDING, TAX, _gather_inputs, transfer_function,
)
from replay_core.explain import fmt
from replay_core.replay import subset_key

# the stored, derived field of each node type (what a transfer function re-derives)
DERIVED_FIELD = {DISCOUNT: "amount", TAX: "amount", ROUNDING: "adj"}
TYPE_LABEL = {
    "gross_price": "unit price", "gross_qty": "quantity", "discount": "discount", "tax": "tax",
    "currency": "FX rate", "adjustment": "adjustment", "rounding": "rounding", "net": "invoice total",
}


def _d(x: Any) -> Decimal:
    return Decimal(str(x))


def _s(x: Decimal) -> str:
    """Plain decimal text without trailing zeros or exponent (0E-24 -> '0', 2.50000 -> '2.5')."""
    out = format(Decimal(x).normalize(), "f")
    return "0" if out in ("-0", "") else out


def _signed(x: Decimal) -> str:
    return ("+" if x > 0 else "-" if x < 0 else "") + fmt(abs(x)) if x != 0 else "0.00"


def build_influence(lc, op, subset: Sequence[str], order: Sequence[str],
                    coalition: Mapping[str, Decimal | None], shapley: Mapping[str, Any] | None) -> dict[str, Any]:
    """`coalition` maps subset_key -> v(S) (None for BLOCKED); `shapley` maps node -> share or None."""
    ctx = op.ctx
    ext = lc.extraction
    target_id = ext.target_event.event_id
    hops = dict(ext.event_hops)
    hops[target_id] = None
    act = {e.event_id: e.activity for e in ext.candidate_events}
    act[target_id] = ext.target_event.activity
    S, order = tuple(subset), tuple(order)
    is_swap = getattr(op, "is_swap", False)

    def label(n: str) -> str:
        h = hops.get(n)
        return f"{n} {act.get(n, '')}".strip() + (f" (hop {h})" if h is not None else " (target)")

    res = op.replay(S, order)

    # ---------------- per-step propagation ----------------
    steps: list[dict[str, Any]] = []
    prev_net = res.observed_net
    prefix_val = {(): _d(0)}
    for k, st in enumerate(res.trace):
        u = st.node_id
        own = [{"field": c["field"], "before": _s(_d(c["before"])) if _is_num(c["before"]) else str(c["before"]),
                "after": _s(_d(c["after"])) if _is_num(c["after"]) else str(c["after"])}
               for c in st.changed if c["node"] == u]
        cur = st.state_after.nodes
        affects = []
        for d in sorted(ctx.downstream_closure([u]) - {u}):
            t = ctx.type_of(d)
            if t in (CONTEXT, NET) or t not in DERIVED_FIELD:
                continue
            f = DERIVED_FIELD[t]
            new = transfer_function(d, _gather_inputs(cur, d, ctx), ctx)
            gap = _d(new[f]) - _d(cur[d][f])
            if gap == 0:
                continue
            if d in order[:k]:
                rel = "stale"            # already corrected earlier: its corrected amount is now out of date
            elif d in order[k + 1:]:
                rel = "pending"          # corrected later: will absorb this change
            else:
                rel = "not_in_change"    # never corrected in this change: stays out of date
            affects.append({"node_id": d, "activity": act.get(d, ""), "hop": hops.get(d), "type": t, "field": f,
                            "stored": _s(_d(cur[d][f])), "would_be": _s(_d(new[f])), "gap": _s(gap), "relation": rel})
        key_prefix = tuple(sorted(order[:k + 1]))
        v_now = coalition.get(subset_key(key_prefix))
        v_prev = coalition.get(subset_key(tuple(sorted(order[:k]))))
        marginal = None if v_now is None or v_prev is None else _s(v_now - v_prev)
        steps.append({
            "index": st.index, "node_id": u, "activity": act.get(u, ""), "hop": hops.get(u), "type": ctx.type_of(u),
            "applied": st.applied, "noop_reason": st.noop_reason, "own_changes": own,
            "net_before": _s(prev_net), "net_after": _s(st.net_after), "delta_net": _s(st.net_after - prev_net),
            "marginal_value": marginal, "affects": affects,
        })
        prev_net = st.net_after

    # ---------------- pairwise influence (why order matters) ----------------
    influence: list[dict[str, Any]] = []
    for u in S:
        for d in S:
            if u == d or (not is_swap and d not in ctx.downstream_closure([u])):
                continue
            t = ctx.type_of(d)
            f = DERIVED_FIELD.get(t)
            if f is None:
                continue
            try:
                # a swap compares d applied before u (the alternative order) with d applied after u
                alone = _d((op.replay((u, d), (d, u)) if is_swap else op.replay((d,), (d,))).state.nodes[d][f])
                after_u = _d(op.replay((u, d), (u, d)).state.nodes[d][f])
            except Exception:  # noqa: BLE001  (a pair the replay cannot validate is simply not reported)
                continue
            delta = after_u - alone
            influence.append({"from": u, "to": d, "field": f, "alone": _s(alone), "after_upstream": _s(after_u),
                              "delta": _s(delta)})

    # ---------------- pairwise interaction (Shapley view) ----------------
    interactions: list[dict[str, Any]] = []
    for a, b in combinations(sorted(S), 2):
        va, vb = coalition.get(subset_key((a,))), coalition.get(subset_key((b,)))
        vab = coalition.get(subset_key((a, b)))
        if None in (va, vb, vab):
            interactions.append({"a": a, "b": b, "v_a": None, "v_b": None, "v_ab": None, "synergy": None, "kind": "withheld"})
            continue
        syn = vab - va - vb
        kind = "independent" if syn == 0 else ("synergy" if syn > 0 else "overlap")
        interactions.append({"a": a, "b": b, "v_a": _s(va), "v_b": _s(vb), "v_ab": _s(vab), "synergy": _s(syn), "kind": kind})

    # ---------------- node ledger ----------------
    touched: dict[str, dict[str, Any]] = {}
    for s in steps:
        touched.setdefault(s["node_id"], {})
        for a in s["affects"]:
            touched.setdefault(a["node_id"], {})
    ledger = []
    for n in sorted(touched, key=lambda x: (-(hops.get(x) or 0), x)):
        step = next((s for s in steps if s["node_id"] == n), None)
        gaps = [{"from": s["node_id"], "step": s["index"] + 1, "gap": a["gap"], "relation": a["relation"]}
                for s in steps for a in s["affects"] if a["node_id"] == n]
        ledger.append({
            "node_id": n, "activity": act.get(n, ""), "hop": hops.get(n), "type": ctx.type_of(n),
            "role": "corrected" if step else "affected", "step": (step["index"] + 1) if step else None,
            "own_changes": step["own_changes"] if step else [],
            "marginal_value": step["marginal_value"] if step else None,
            "shapley": None if not shapley or n not in shapley else _s(_d(shapley[n])),
            "influenced_by": [{"from": i["from"], "delta": i["delta"]} for i in influence if i["to"] == n],
            "influences": [{"to": i["to"], "delta": i["delta"]} for i in influence if i["from"] == n],
            "stale_gaps": gaps,
        })

    # ---------------- plain-language report ----------------
    levels = sorted({hops.get(n) for n in touched if hops.get(n) is not None}, reverse=True)
    deep = len(levels)
    path = " → ".join(f"hop {h}" for h in levels) + " → invoice total (target)"
    names = ', '.join(label(n) for n in order)
    if is_swap and res.net == res.observed_net:
        opening = f"Applying {names} in this order reproduces the graph as posted: the invoice total stays {fmt(res.net)}."
    else:
        opening = (f"{'Applying' if is_swap else 'Correcting'} {names} in this order moves the invoice total from "
                   f"{fmt(res.observed_net)} to {fmt(res.net)} ({_signed(res.net - res.observed_net)}). "
                   f"The effect travels {path}.")
    narrative: list[str] = [opening]
    for s in steps:
        tail = ""
        if s["own_changes"]:
            tail = "; ".join(f"{c['field']} {fmt(c['before'])} → {fmt(c['after'])}" if _is_num(c["before"]) else f"{c['field']} {c['before']} → {c['after']}" for c in s["own_changes"])
        if is_swap:
            line = (f"Step {s['index'] + 1}: {label(s['node_id'])} is applied" +
                    (f" ({tail}); the total moves {_signed(_d(s['delta_net']))}." if tail else "; its value stays as posted."))
        else:
            line = (f"Step {s['index'] + 1}: {label(s['node_id'])} is corrected" + (f" ({tail})" if tail else "") +
                    f"; the total moves {_signed(_d(s['delta_net']))}.")
        narrative.append(line)
        for a in s["affects"]:
            what = ({"stale": "was applied before it, so it does not include this value and differs by",
                     "pending": "is applied later and will absorb a change of",
                     "not_in_change": "is not part of this swap and stays out of date by"} if is_swap else
                    {"stale": "was already corrected, so its corrected amount is now out of date by",
                     "pending": "is corrected later and will absorb a change of",
                     "not_in_change": "is not part of this change and stays out of date by"})[a["relation"]]
            narrative.append(f"    ↳ {label(a['node_id'])} {what} {_signed(_d(a['gap']))} ({a['field']}).")
    for i in influence:
        if _d(i["delta"]) != 0 and is_swap:
            narrative.append(f"Order effect: {label(i['to'])} reads {i['from']}, so it is {fmt(i['after_upstream'])} when applied "
                             f"after {i['from']} and {fmt(i['alone'])} when applied before it.")
        elif _d(i["delta"]) != 0:
            narrative.append(f"Order effect: {label(i['to'])} ends {_signed(_d(i['delta']))} different when {i['from']} is corrected "
                             f"before it (it re-derives its {i['field']} from the corrected {i['from']}).")
    for it in interactions:
        if it["kind"] in ("synergy", "overlap"):
            narrative.append(
                f"Interaction: {it['a']} and {it['b']} together avoid {fmt(it['v_ab'])}, but alone they avoid {fmt(it['v_a'])} and "
                f"{fmt(it['v_b'])}; the difference of {_signed(_d(it['synergy']))} is an interaction, not a sum.")

    return {
        "order": list(order), "steps": steps, "influence": influence, "interactions": interactions,
        "nodes": ledger, "narrative": narrative, "hop_levels": levels,
        "flow_edges": [{"step": s["index"], "from": s["node_id"], "to": a["node_id"], "gap": a["gap"], "relation": a["relation"]}
                       for s in steps for a in s["affects"]],
    }


def _is_num(x: Any) -> bool:
    try:
        Decimal(str(x))
        return not isinstance(x, bool)
    except Exception:  # noqa: BLE001
        return False
