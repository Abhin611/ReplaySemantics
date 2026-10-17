"""
scenario.py
-----------
Member 1 -- "run this change": replay a chosen set of corrections (typically one
order-sensitive pair such as e1 <-> e2) and report the corrected case against the
previous one.

    run_scenario(loaded_case, case_verdict, subset=["e1", "e2"], order=None)

What it returns (all amounts exact decimal strings):
  * baseline      -- the observed total, the realised loss and the compliant total BEFORE the change
  * orders        -- every legitimate order of the subset (those consistent with the log's
                     structural locks) is replayed, then GROUPED BY THE TOTAL IT PRODUCES: one
                     light entry per distinct outcome (total, realised loss, v(S), deltas, how
                     many orders give it, a few example orders). A pair has up to 2 groups; a
                     6-event change has up to 720 orders but usually only a handful of groups.
  * selected      -- the one order shown in full: per-step trace (total and loss after each
                     correction) and the change per node
  * selected_order / authoritative_order
                  -- the order shown as the headline, and the one the policy makes authoritative
                     (None when the subset is BLOCKED: no order is defensible)
  * shapley       -- exact Shapley WITHIN the change: players = the subset, v restricted to its
                     sub-coalitions. It sums to v(S), not to the case-level total. Withheld when
                     any sub-coalition is BLOCKED.

Nothing here is new maths: the totals come from ReplayOperator.replay, the verdicts and v(S)
from the ConfluenceChecker, the Shapley from the pluggable attribution function
(`run_case.provisional_shapley` until Member 3's layer replaces it). SEALED TRUTH: never reads
`hidden/`.
"""

from __future__ import annotations

from decimal import Decimal
from itertools import combinations, permutations
from typing import Any, Callable, Iterable, Sequence

from policy_engine.loss import loss as loss_of
from replay_core.benchmark_io import LoadedCase
from replay_core.confluence import CaseVerdict, transitive_closure
from replay_core.replay import ReplayResult, state_differences, state_to_json, subset_key
from replay_core.run_case import provisional_shapley

MAX_SCENARIO_EVENTS = 6  # 6! = 720 orders at most (each replay is milliseconds)
MAX_ORDER_GROUPS = 24  # distinct outcomes returned; the group holding the selected order is always kept


class ScenarioError(ValueError):
    """The requested change is not valid for this case."""


def _legit_orders(subset: Sequence[str], locks: set[tuple[str, str]]) -> list[tuple[str, ...]]:
    inside = [(a, b) for (a, b) in locks if a in subset and b in subset]
    out = []
    for perm in permutations(subset):
        pos = {n: i for i, n in enumerate(perm)}
        if all(pos[a] < pos[b] for a, b in inside):
            out.append(perm)
    return out


def _d(x: Decimal) -> str:
    return str(x)


def _order_entry(op, base_loss: Decimal, base_net: Decimal, compliant: Decimal,
                 result: ReplayResult, authoritative: bool) -> dict[str, Any]:
    ctx = op.ctx
    trace = []
    prev_net, prev_loss = result.observed_net, base_loss
    for st in result.trace:
        lo = loss_of(st.state_after, op.observed, ctx)
        trace.append({
            "index": st.index, "node_id": st.node_id, "correction_id": st.correction_id,
            "applied": st.applied, "noop_reason": st.noop_reason,
            "net_after": _d(st.net_after), "loss_after": _d(lo),
            "delta_net": _d(st.net_after - prev_net), "delta_loss": _d(lo - prev_loss),
            "changed": list(st.changed),
        })
        prev_net, prev_loss = st.net_after, lo

    diffs = state_differences(op.observed, result.state)
    by_node: dict[str, list[dict]] = {}
    for dd in diffs:
        by_node.setdefault(dd["node"], []).append({"field": dd["field"], "before": dd["before"], "after": dd["after"]})
    step_of = {nid: i + 1 for i, nid in enumerate(result.order)}
    effects = {}
    for n in ctx.node_types:
        if n in step_of:
            role = "corrected"
        elif n in by_node:
            role = "cascaded"  # changed although not itself corrected
        else:
            role = "unchanged"
        effects[n] = {"role": role, "step": step_of.get(n), "changes": by_node.get(n, [])}

    return {
        "order": list(result.order), "authoritative": authoritative,
        "net": _d(result.net), "loss": _d(result.loss), "value": _d(result.value),
        "delta_net": _d(result.net - base_net),
        "delta_loss": _d(result.loss - base_loss),
        "gap_to_compliant": _d(result.net - compliant),
        "reaches_compliant_net": result.reaches_compliant_net,
        # shaped like replay_of_all_corrections so the existing step-through card can render it
        "observed_net": _d(result.observed_net), "observed_loss": _d(base_loss),
        "compliant_net": _d(compliant), "order_is_authoritative": authoritative,
        "trace": trace, "node_effects": effects,
    }


def run_scenario(
    lc: LoadedCase,
    cv: CaseVerdict,
    subset: Iterable[str],
    order: Sequence[str] | None = None,
    shapley_fn: Callable = provisional_shapley,
) -> dict[str, Any]:
    ids = list(subset)
    if len(set(ids)) != len(ids):
        raise ScenarioError("a correction appears twice in the requested change")
    if not ids:
        raise ScenarioError("choose at least one event to correct")
    for n in ids:
        if n not in cv.players:
            raise ScenarioError(f"{n!r} is not a correctable event of this case (players: {list(cv.players)})")
    if len(ids) > MAX_SCENARIO_EVENTS:
        raise ScenarioError(f"a change may contain at most {MAX_SCENARIO_EVENTS} events")
    S = tuple(sorted(ids))
    key = subset_key(S)
    sv = cv.subsets[key]
    op = lc.operator()
    locks = transitive_closure(lc.policy.structural_pairs())
    legit = _legit_orders(S, locks)
    if not legit:
        raise ScenarioError("no order of these corrections is consistent with the log")

    if order is not None:
        order = tuple(order)
        if order not in legit:
            raise ScenarioError(
                f"order {list(order)} is not a legitimate order of {list(S)} (it contradicts an order fixed by the log)")

    base_net, base_loss, compliant = op.observed_net, op.observed_loss, op.compliant_net
    ref_net = op.replay(S, sv.order_used).net if sv.order_used is not None else None

    results = {o: op.replay(S, o) for o in legit}
    auth_order = tuple(sv.order_used) if sv.order_used is not None else None
    sel_order = tuple(order) if order is not None else (auth_order or legit[0])

    def is_auth(net: Decimal) -> bool:
        return ref_net is not None and net == ref_net

    # group the legitimate orders by the total they produce
    groups: dict[Decimal, list[tuple[str, ...]]] = {}
    for o in legit:
        groups.setdefault(results[o].net, []).append(o)

    light = []
    for net, members in groups.items():
        rep = auth_order if auth_order in members else (sel_order if sel_order in members else members[0])
        r = results[rep]
        light.append({
            "order": list(rep), "order_count": len(members),
            "example_orders": [list(m) for m in members[:3]],
            "authoritative": is_auth(net), "contains_selected": sel_order in members,
            "net": _d(r.net), "loss": _d(r.loss), "value": _d(r.value),
            "delta_net": _d(r.net - base_net), "delta_loss": _d(r.loss - base_loss),
        })
    light.sort(key=lambda g: (not g["authoritative"], -g["order_count"], g["net"]))
    truncated = len(light) > MAX_ORDER_GROUPS
    if truncated:
        keep = light[:MAX_ORDER_GROUPS]
        if not any(g["contains_selected"] for g in keep):
            keep[-1] = next(g for g in light if g["contains_selected"])
        light = keep

    sel_res = results[sel_order]
    sel = _order_entry(op, base_loss, base_net, compliant, sel_res, is_auth(sel_res.net))
    authoritative_order = list(auth_order) if auth_order is not None else None
    selected = list(sel_order)
    nets = list(groups)

    # ---- Shapley within the change ------------------------------------------------
    table = []
    for r in range(len(S) + 1):
        for sub in combinations(S, r):
            s2 = cv.subsets[subset_key(sub)]
            table.append({"key": s2.key, "subset": list(s2.subset), "verdict": s2.verdict,
                          "value": None if s2.value is None else _d(s2.value)})
    shap: dict[str, Any] = {
        "scope": "within_change", "source": "provisional (replay_core.run_case.provisional_shapley)",
        "coalition_table": table,
    }
    if any(t["value"] is None for t in table):
        shap.update(status="withheld", values=None,
                    reason="At least one sub-coalition of this change is BLOCKED (the orders disagree and the "
                           "policy does not fix one), so there is no defensible v(S) to split.")
    else:
        vals = {t["key"]: Decimal(t["value"]) for t in table}
        phi = shapley_fn(S, vals)
        total = sum(Decimal(str(x)) for x in phi.values())
        shap.update(status="ok", values={k: _d(Decimal(str(x))) for k, x in phi.items()},
                    total=_d(total), v_of_subset=_d(vals[key]),
                    efficient=abs(total - vals[key]) <= Decimal("0.0001") * max(1, len(S)))

    return {
        "case_id": lc.case_id, "policy_version": lc.entry["policy_version"],
        "subset": list(S), "key": key, "subset_verdict": sv.verdict,
        "exploratory": sv.verdict == "BLOCKED",
        "baseline": {"net": _d(base_net), "loss": _d(base_loss), "compliant_net": _d(compliant)},
        "orders": light, "orders_agree": len(nets) <= 1,
        "legit_order_count": len(legit), "order_groups_total": len(nets), "groups_truncated": truncated,
        "order_spread": _d(max(nets) - min(nets)),
        "selected_order": selected, "authoritative_order": authoritative_order,
        "selected": sel, "shapley": shap,
        "note": ("These corrections disagree by order and the policy does not fix one: every order below is "
                 "exploratory, none is an authoritative outcome, and attribution is withheld."
                 if sv.verdict == "BLOCKED" else None),
    }
