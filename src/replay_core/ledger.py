"""
ledger.py
---------
Member 1 -- the CORRECTED-LEDGER view of a case (benchmark v2 analysis).

Idea
----
In the frozen domain a loss can only come from two places:

  * a wrong INPUT (unit price, quantity, FX rate, a manual adjustment) -- fixed by EDITING that value,
    after which a cascade recomputes everything downstream;
  * a stale POSTED AMOUNT (the stored result on a discount, tax or rounding document) -- fixed by
    re-deriving that amount, and when two such documents interact the ORDER of re-deriving matters.

So every node is shown with its CORRECTED INPUT; discount / tax / rounding nodes additionally show the
amount that was originally POSTED (now stale) next to what it should be. The corrected ledger C is the
observed case with every non-exempt input restored and every posted amount left as posted.

What this module computes (no Shapley: attribution stays a separate stage)
-------------------------------------------------------------------------
  analyse(lc)            nodes, loss split (stale amounts vs inputs), policy summary over the posted-amount
                         nodes, the swappable order-sensitive pairs, the resolution class and a description
  run_pair(lc, a, b)     both orders as real swaps (replay_core/swap.py), step by step: stored amount vs what its
                         formula gives now per dependent, authoritative order
  run_change(lc, ...)    several input edits (one cascade) combined with a chosen swap order, in a CHOSEN
                         sequence (swap first / edit first) -- do the two sequences agree?

Swappable pair = both nodes carry a posted amount, the log does not lock them (closed transitively over ALL
reachable events), and re-deriving them in the two orders gives different totals.

SEALED TRUTH: never read here. benchmark v2's oracle (reference_sim.ledger_truth) is an independent
re-implementation; tests/test_ledger.py checks the two agree on every case.
"""

from __future__ import annotations

from dataclasses import replace
from decimal import Decimal
from typing import Any, Mapping, Sequence

from policy_engine import CaseState, compute_net, loss, resolve_order
from policy_engine.corrections import CORRECTIONS_BY_ID, is_exempt
from policy_engine.domain import (
    ADJUSTMENT, CONTEXT, CURRENCY, DISCOUNT, GROSS_PRICE, GROSS_QTY, NET, ROUNDING, TAX,
    _gather_inputs, transfer_function,
)
from policy_engine.ordering import BLOCKED, PASS, POLICY_ORDERED

from replay_core.benchmark_io import LoadedCase
from replay_core.confluence import ConfluenceChecker
from replay_core.propagation import EDITABLE_FIELDS, propagate_multi
from replay_core.replay import ReplayOperator, _values_equal, state_to_json
from replay_core.swap import SwapOperator, swap_state

POSTED_TYPES = (DISCOUNT, TAX, ROUNDING)
INPUT_TYPES = (GROSS_PRICE, GROSS_QTY, CURRENCY, ADJUSTMENT)
AMOUNT_FIELD = {DISCOUNT: "amount", TAX: "amount", ROUNDING: "adj"}
CLASS_LABEL = {
    "SWAP_ONLY": "Swap only", "MULTI_EDIT_ONLY": "Multi-edit only", "BOTH": "Swap and edit", "DIRECT_FIX": "Direct fix",
}


class LedgerError(ValueError):
    """The requested pair / change is not valid for this case."""


def _spec_by_type():
    return {s.node_type: s for s in CORRECTIONS_BY_ID.values()}


def _money(x) -> str:
    return f"{Decimal(str(x)):,.2f}"


def _fine(x) -> str:
    """Show enough decimals that a sub-cent difference is visible instead of rounding to zero."""
    d = Decimal(str(x))
    return f"{d:,.4f}" if abs(d) < 1 and d != 0 else f"{d:,.2f}"


class _Ctx:
    """Everything derived once per loaded case."""

    def __init__(self, lc: LoadedCase):
        self.lc = lc
        self.model = lc.model
        self.ctx = lc.model.ctx
        self.op = ReplayOperator(lc.model)
        self.observed: CaseState = self.op.observed
        specs = _spec_by_type()
        nodes = {k: dict(v) for k, v in self.observed.nodes.items()}
        self.corrected_inputs: dict[str, dict[str, Any]] = {}
        for n in self.ctx.active_nodes():
            if is_exempt(n, self.ctx):
                continue
            fields = specs[self.ctx.type_of(n)].compliant_fields(n, self.ctx)
            self.corrected_inputs[n] = fields
            nodes[n].update(fields)
        self.C = CaseState(nodes)
        self.posted = [n for n in self.ctx.active_nodes()
                       if self.ctx.type_of(n) in POSTED_TYPES and not is_exempt(n, self.ctx)]
        self.input_nodes = [n for n in self.ctx.active_nodes()
                            if self.ctx.type_of(n) in INPUT_TYPES and not is_exempt(n, self.ctx)]
        self.deviating_inputs = [n for n in self.input_nodes if not all(
            _values_equal(self.observed.nodes[n].get(f), v) for f, v in self.corrected_inputs[n].items())]
        self.op_c = ReplayOperator(replace(self.model, observed=self.C))
        self.swap_op = SwapOperator(self.model)
        self.checker = ConfluenceChecker(self.op_c, lc.policy, structural_pairs=lc.structural_pairs)
        self.checker.players = tuple(self.posted)
        self.locks = self.checker.locks

    def should_be(self, state: CaseState, node: str) -> Decimal:
        """What the node's posted amount would be if re-derived now from the CURRENT state."""
        t = self.ctx.type_of(node)
        out = transfer_function(node, _gather_inputs(state.nodes, node, self.ctx), self.ctx)
        return Decimal(str(out[AMOUNT_FIELD[t]]))

    def activity(self, node: str) -> str:
        return next((e.activity for e in self.lc.extraction.candidate_events if e.event_id == node), node)

    def locked(self, a: str, b: str) -> bool:
        return (a, b) in self.locks or (b, a) in self.locks


def _swappable_pairs(c: _Ctx) -> list[dict[str, Any]]:
    out = []
    for i, a in enumerate(c.posted):
        for b in c.posted[i + 1:]:
            if c.locked(a, b):
                continue
            r_ab, r_ba = c.op_c.replay([a, b], [a, b]), c.op_c.replay([a, b], [b, a])
            if r_ab.net == r_ba.net:
                continue
            res = resolve_order(c.lc.policy, [a, b], c.model.correction_ids, [tuple(sorted((a, b)))],
                                structural_pairs=c.locks, slots=c.ctx.slots)
            r_ab, r_ba = c.swap_op.replay([a, b], [a, b]), c.swap_op.replay([a, b], [b, a])  # what is shown: real swaps
            blocked = res.classification == BLOCKED
            out.append({
                "pair": [a, b], "blocked": blocked,
                "authoritative_order": None if blocked else list(res.sequence),
                "rules": [] if blocked else list(res.applied_rules),
                "reason": res.reason_code if blocked else None,
                "orders": [
                    {"order": [a, b], "net": str(r_ab.net), "loss": str(r_ab.loss)},
                    {"order": [b, a], "net": str(r_ba.net), "loss": str(r_ba.loss)},
                ],
                "difference": str(abs(r_ab.net - r_ba.net)),
            })
    return out


def ledger_view(lc: LoadedCase):
    """(lc_c, cv_c): the case as the corrected ledger C -- every non-exempt input at its authorised value, every posted
    amount as posted -- and the confluence verdict over the posted-amount nodes only. The Replay Console and the
    Corrected Scenario page run on this, so swapping a pair only RE-DERIVES amounts: no input value is changed behind the
    reader's back (changing a value is the Edit button's job)."""
    c = _Ctx(lc)
    return replace(lc, model=replace(lc.model, observed=c.C)), c.checker.check_case()


def classify(has_swap: bool, has_input: bool, n_posted: int) -> str:
    if has_swap and has_input:
        return "BOTH"
    if has_swap:
        return "SWAP_ONLY"
    if not has_input and n_posted:
        return "DIRECT_FIX"
    return "MULTI_EDIT_ONLY"


def _node_rows(c: _Ctx) -> list[dict[str, Any]]:
    rows = []
    hops = c.lc.extraction.event_hops
    comp = c.op.compliant_state
    for n in c.ctx.stage_sorted(c.ctx.node_types):
        t = c.ctx.type_of(n)
        if t == NET:
            continue
        row: dict[str, Any] = {
            "node_id": n, "node_type": t, "activity": c.activity(n), "hop": hops.get(n),
            "exempt": is_exempt(n, c.ctx), "correction_id": c.model.correction_ids.get(n),
            "role": "context" if t == CONTEXT else "exempt" if is_exempt(n, c.ctx)
            else "posted" if t in POSTED_TYPES else "input",
            "inputs": {k: str(v) for k, v in c.corrected_inputs.get(n, {}).items()},
            "was": {k: str(c.observed.nodes[n].get(k)) for k in c.corrected_inputs.get(n, {})},
            "editable_fields": list(EDITABLE_FIELDS.get(t, ())) if t not in (CONTEXT, NET) else [],
        }
        row["deviates"] = n in c.deviating_inputs or (
            t in POSTED_TYPES and not all(_values_equal(c.observed.nodes[n].get(f), v)
                                          for f, v in c.corrected_inputs.get(n, {}).items()))
        if t in POSTED_TYPES and not row["exempt"]:
            f = AMOUNT_FIELD[t]
            posted = Decimal(str(c.observed.nodes[n][f]))
            final = Decimal(str(comp.nodes[n][f]))
            row["posted"] = {"field": f, "value": str(posted), "should_be": str(final), "gap": str(final - posted),
                             "stale": final != posted}
        rows.append(row)
    return rows


def _describe(a: dict[str, Any]) -> dict[str, Any]:
    t, cls = a["totals"], a["resolution_class"]
    pairs, nodes = a["pairs"], {n["node_id"]: n for n in a["nodes"]}
    stale_nodes = [n["node_id"] for n in a["nodes"] if n.get("posted", {}).get("stale")]
    bad_inputs = [n["node_id"] for n in a["nodes"] if n["role"] == "input" and n["deviates"]]
    lines: list[str] = []
    if cls == "DIRECT_FIX":
        n = nodes[a["posted_nodes"][0]]
        lines.append(f"One posted amount is wrong: {n['node_id']} ({n['activity']}) was posted as "
                     f"{_money(n['posted']['value'])} and should be {_money(n['posted']['should_be'])}. "
                     f"Editing it to the authorised value removes the whole loss of {_money(t['realised_loss'])}; "
                     "there is no order to choose.")
    elif cls == "MULTI_EDIT_ONLY":
        why = ("the posted amounts cannot be swapped (the log fixes their order)" if a["posted_nodes"]
               else "there is no posted amount whose order could matter")
        lines.append(f"The loss of {_money(t['realised_loss'])} comes from wrong inputs "
                     f"({', '.join(bad_inputs) or 'none'}), and {why}. "
                     "Edit the inputs together and one cascade recomputes every dependent amount.")
    elif cls == "SWAP_ONLY":
        lines.append(f"All of the loss ({_money(t['realised_loss'])}) comes from posted amounts that differ from the compliant "
                     f"values ({', '.join(stale_nodes)}). {len(pairs)} order-sensitive pair(s) exist. Swap them to see what "
                     "the order does, and use Edit to change any value yourself.")
    else:
        lines.append(f"The loss of {_money(t['realised_loss'])} has two parts: {_money(t['loss_from_inputs'])} from wrong "
                     f"inputs ({', '.join(bad_inputs)}) and {_money(t['loss_from_stale_amounts'])} from stale posted amounts "
                     f"({', '.join(stale_nodes)}). {len(pairs)} order-sensitive pair(s) exist. Swap them to see what the order "
                     "does, and use Edit to change any value yourself; the change panel compares swapping first with editing first.")
    for p in pairs:
        a_, b_ = p["pair"]
        no_effect = Decimal(p["difference"]) == 0
        if p["blocked"] and no_effect:
            lines.append(f"Pair {a_}/{b_}: swapping them changes no value, and the policy cannot order them for the verdict.")
        elif no_effect:
            first, second = p["authoritative_order"]
            lines.append(f"Pair {a_}/{b_}: swapping them changes no value (total {_fine(p['orders'][0]['net'])}). "
                         f"The verdict's corrections check still has the policy fix {first} before {second} ({', '.join(p['rules'])}).")
        elif p["blocked"]:
            lines.append(f"Pair {a_}/{b_}: the two orders end {_fine(p['difference'])} apart and the policy cannot order "
                         "them, so swapping cannot settle it -- both outcomes are exploratory and no number is defended.")
        else:
            first, second = p["authoritative_order"]
            auth = next(o for o in p["orders"] if o["order"] == [first, second])
            other = next(o for o in p["orders"] if o["order"] != [first, second])
            lines.append(f"Pair {a_}/{b_}: the policy fixes {first} before {second} ({', '.join(p['rules'])}); that order "
                         f"gives a total of {_fine(auth['net'])} while the other gives {_fine(other['net'])} "
                         f"(difference {_fine(p['difference'])}).")
    if a["blocked"] and not pairs:
        lines.append("Some subsets of the posted amounts cannot be ordered by the policy.")
    head = "What the loss is made of" + (" -- the policy cannot order every pair" if a["blocked"] else "")
    if not a["complete"]:
        lines.append("PARTIAL: " + "; ".join(a["limits"]["partial_reasons"]) + ". Raise the limit to see the full picture.")
    return {"class": cls, "headline": head, "text": lines}


def analyse(lc: LoadedCase) -> dict[str, Any]:
    c = _Ctx(lc)
    base: dict[str, Any] = {
        "case_id": lc.case_id, "policy_version": lc.entry["policy_version"],
        "target_event_id": lc.entry["target_event_id"], "limits": lc.limits, "complete": lc.limits["complete"],
    }
    if not c.op.is_replayable:
        return {**base, "replayable": False, "description": {
            "class": None, "headline": "Not replayable",
            "text": ["No candidate carries a correctable field (no price, discount, tax, FX or rounding), so there is "
                     "nothing to replay. Stages 1 to 2b only."]}}
    n_obs, n_star = c.op.observed_net, c.op.compliant_net
    n_c = compute_net(c.C, c.ctx)
    l_obs = c.op.observed_loss
    l_c = loss(c.C, c.observed, c.ctx)
    cv = c.checker.check_case()
    pairs = _swappable_pairs(c)
    cls = classify(bool(pairs), bool(c.deviating_inputs), len(c.posted))
    blocked = any(p["blocked"] for p in pairs) or cv.classification == BLOCKED
    out_nodes = _node_rows(c)
    out = {
        **base, "replayable": True, "nodes": out_nodes, "posted_nodes": list(c.posted),
        "input_nodes": list(c.input_nodes),
        "totals": {
            "posted_total": str(n_obs), "compliant_total": str(n_star), "corrected_inputs_total": str(n_c),
            "realised_loss": str(l_obs), "loss_from_stale_amounts": str(l_c), "loss_from_inputs": str(l_obs - l_c),
            "stated_loss": lc.entry.get("realized_loss"),
        },
        "policy_summary": {
            "classification": cv.classification, "counts": cv.to_dict(include_subsets=False)["counts"],
            "subsets": len(cv.subsets), "players": list(cv.players),
            "text": f"Over all {len(cv.subsets)} subsets of the posted-amount nodes: " + ", ".join(
                f"{k.replace('_', '-')} {v}" for k, v in cv.to_dict(include_subsets=False)["counts"].items()),
        },
        "pairs": pairs,
        "locked_pairs": [[a, b] for i, a in enumerate(c.posted) for b in c.posted[i + 1:] if c.locked(a, b)],
        "resolution_class": cls, "blocked": blocked,
        "swap_default": list((c.checker.check_subset(c.posted).order_used or ())) if c.posted else [],
        "edit_defaults": {},  # nothing is pre-edited: the user chooses every change
        "editable": {n["node_id"]: {f: str(c.observed.nodes[n["node_id"]].get(f)) for f in n["editable_fields"]}
                     for n in out_nodes if n["editable_fields"]},
    }
    out["description"] = _describe(out)
    return out


# --------------------------------------------------------------------------------------------- pair run
def run_pair(lc: LoadedCase, a: str, b: str) -> dict[str, Any]:
    c = _Ctx(lc)
    if a == b or a not in c.posted or b not in c.posted:
        raise LedgerError(f"{a!r} and {b!r} must be two different posted-amount nodes "
                          f"(discount / tax / rounding); this case has {c.posted}")
    info = next((p for p in _swappable_pairs(c) if set(p["pair"]) == {a, b}), None)
    if info is None:
        why = "the log fixes their order" if c.locked(a, b) else "swapping them does not change the total"
        raise LedgerError(f"{a} and {b} are not a swappable pair: {why}")
    n_star = c.op.compliant_net
    runs = []
    for order in ([a, b], [b, a]):
        res = c.swap_op.replay(order, order)
        steps, done, prev_net = [], [], c.op.observed_net
        for st in res.trace:
            node = st.node_id
            t = c.ctx.type_of(node)
            before = Decimal(str(c.observed.nodes[node][AMOUNT_FIELD[t]])) if not done else Decimal(
                str(res.trace[st.index - 1].state_after.nodes[node][AMOUNT_FIELD[t]]))
            after = Decimal(str(st.state_after.nodes[node][AMOUNT_FIELD[t]]))
            done.append(node)
            deps = []
            for d in c.posted:
                if d == node:
                    continue
                posted = Decimal(str(st.state_after.nodes[d][AMOUNT_FIELD[c.ctx.type_of(d)]]))
                sb = c.should_be(st.state_after, d)
                deps.append({"node_id": d, "activity": c.activity(d), "corrected": d in done, "posted": str(posted),
                             "should_be": str(sb), "gap": str(sb - posted), "stale": sb != posted,
                             "reads_corrected": d in c.ctx.downstream_closure([node])})
            steps.append({"index": st.index, "node_id": node, "activity": c.activity(node), "field": AMOUNT_FIELD[t],
                          "posted_before": str(before), "new_value": str(after), "net_after": str(st.net_after),
                          "delta_net": str(st.net_after - prev_net),
                          "loss_after": str(loss(st.state_after, c.observed, c.ctx)), "dependents": deps})
            prev_net = st.net_after
        authoritative = (not info["blocked"]) and order == info["authoritative_order"]
        runs.append({"order": order, "authoritative": authoritative, "exploratory": info["blocked"], "steps": steps,
                     "final_net": str(res.net), "final_loss": str(res.loss),
                     "matches_compliant_total": res.net == n_star})
    return {"case_id": lc.case_id, "pair": [a, b], "blocked": info["blocked"],
            "authoritative_order": info["authoritative_order"], "rules": info["rules"], "reason": info["reason"],
            "start_total": str(c.op.observed_net), "compliant_total": str(n_star),
            "difference": info["difference"], "orders": runs,
            "summary": (f"Swapping {a} and {b} changes no value: both orders give the original graph." if Decimal(info["difference"]) == 0 else
                        f"The policy cannot order {a} and {b}; both outcomes are exploratory, none is authoritative."
                        if info["blocked"] else
                        f"{' then '.join(info['authoritative_order'])} is authoritative ({', '.join(info['rules'])}); "
                        f"the other order ends {_fine(info['difference'])} away.")}


# ------------------------------------------------------------------------------------- multi-edit change
def run_change(lc: LoadedCase, edits: Mapping[str, Mapping[str, Any]] | None = None,
               swap: Sequence[str] | None = None, sequence: str = "both") -> dict[str, Any]:
    """Apply `edits` (node -> {input field: value}, ONE cascade) and run the posted nodes in `swap` in that order with
    their recorded inputs (replay_core/swap.py), starting from the books as posted: no value changes unless an edit or the
    order changes it. sequence: 'swap_first' | 'edit_first' | 'both' (compares them)."""
    c = _Ctx(lc)
    swap = list(swap or [])
    edits = {k: dict(v) for k, v in (edits or {}).items()}
    for n in swap:
        if n not in c.posted:
            raise LedgerError(f"{n!r} is not a posted-amount node of this case (posted: {c.posted})")
    if len(set(swap)) != len(swap):
        raise LedgerError("a node can be re-derived once per change")
    if not swap and not edits:
        raise LedgerError("nothing to run: choose at least one edit or one node to re-derive")
    if sequence not in ("swap_first", "edit_first", "both"):
        raise LedgerError("sequence must be swap_first, edit_first or both")
    try:
        from replay_core.propagation import PropagationError
        propagate_multi(c.model, edits) if edits else None
    except PropagationError as exc:
        raise LedgerError(str(exc)) from None
    runs = []
    for seq in (["swap_first", "edit_first"] if sequence == "both" else [sequence]):
        state, steps = c.observed, []
        for kind in (["swap", "edit"] if seq == "swap_first" else ["edit", "swap"]):
            if kind == "swap" and swap:
                state = swap_state(state, swap, c.ctx)
                steps.append({"kind": "swap", "nodes": swap, "net_after": str(compute_net(state, c.ctx)),
                              "loss_after": str(loss(state, c.observed, c.ctx))})
            if kind == "edit" and edits:
                pr = propagate_multi(c.model, edits, base=state)
                state = pr.state
                steps.append({"kind": "edit", "nodes": sorted(edits), "recomputed": list(pr.recomputed),
                              "net_after": str(pr.net_after), "loss_after": str(pr.loss_after)})
        net = compute_net(state, c.ctx)
        runs.append({"sequence": seq, "steps": steps, "final_net": str(net),
                     "final_loss": str(loss(state, c.observed, c.ctx)),
                     "matches_compliant_total": net == c.op.compliant_net, "state": state_to_json(state)})
    agree = len({r["final_net"] for r in runs}) == 1
    diff = abs(Decimal(runs[0]["final_net"]) - Decimal(runs[-1]["final_net"]))
    return {"case_id": lc.case_id, "edits": {k: {f: str(v) for f, v in d.items()} for k, d in edits.items()},
            "swap": swap, "start_total": str(c.op.observed_net), "compliant_total": str(c.op.compliant_net),
            "runs": runs, "sequences_agree": agree, "difference": str(diff),
            "summary": ("Both sequences end at the same total." if agree or len(runs) == 1 else
                        f"The two sequences end {_fine(diff)} apart: the order of editing and swapping matters here.")}
