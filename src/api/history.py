"""
api/history.py
--------------
What one user action produced, in one common shape, and the comparison report over any number of actions.
A snapshot stores the numbers as they were when the action ran, so the history still reads the same later on.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

ACTION_KINDS = {"run_case": "Ran a case", "swap": "Ran a swap", "pair": "Ran a pair", "change": "Ran a change"}


def _num(x: Any) -> Decimal | None:
    try:
        return None if x is None else Decimal(str(x))
    except InvalidOperation:
        return None


def _money(x: Any) -> str:
    d = _num(x)
    return "n/a" if d is None else f"{d:,.2f}"


def _signed(x: Decimal) -> str:
    return f"{'+' if x > 0 else '-' if x < 0 else ''}{abs(x):,.2f}"


def snapshot_run_case(d: dict) -> dict:
    v = d.get("stage_5_verdict", {})
    replay = v.get("replay_of_all_corrections") or {}
    return {
        "title": f"Ran case {d.get('case_id')}", "source": d.get("source"),
        "candidates": d.get("stage_2_candidate_identification", {}).get("num_candidates"),
        "verdict": v.get("classification"), "start_total": replay.get("observed_net"), "total": replay.get("net"),
        "start_loss": v.get("realized_loss"), "loss": v.get("realized_loss"), "compliant_total": replay.get("compliant_net"),
        "order": replay.get("order"), "changes": [],
        "note": None if v.get("status") == "complete" else v.get("message"),
    }


def snapshot_swap(s: dict) -> dict:
    sel = s["selected"]
    changes = [{"node": n, "field": c["field"], "before": c["before"], "after": c["after"]}
               for n, e in sorted(sel["node_effects"].items()) for c in e["changes"]]
    return {
        "title": f"Swapped {' → '.join(s['selected_order'])} in {s['case_id']}", "source": s.get("source"),
        "verdict": s.get("subset_verdict"), "start_total": s["baseline"]["net"], "total": sel["net"],
        "start_loss": s["baseline"]["loss"], "loss": sel["loss"], "compliant_total": s["baseline"]["compliant_net"],
        "order": s["selected_order"], "changes": changes, "note": s.get("note"),
    }


def snapshot_pair(r: dict) -> dict:
    orders = r["orders"]
    main = next((o for o in orders if o.get("authoritative")), orders[0])
    outcomes = [{"label": " → ".join(o["order"]), "total": o["final_net"], "loss": o["final_loss"]} for o in orders]
    return {
        "title": f"Ran pair {' / '.join(r['pair'])} in {r['case_id']}", "source": r.get("source"),
        "verdict": "BLOCKED" if r.get("blocked") else "POLICY_ORDERED", "start_total": r["start_total"], "total": main["final_net"],
        "start_loss": None, "loss": main["final_loss"], "compliant_total": r["compliant_total"], "order": main["order"],
        "changes": [], "outcomes": outcomes, "note": r.get("summary"),
    }


def snapshot_change(r: dict) -> dict:
    runs = r["runs"]
    labels = {"swap_first": "Swap first, then edit", "edit_first": "Edit first, then swap"}
    outcomes = [{"label": labels.get(x["sequence"], x["sequence"]), "total": x["final_net"], "loss": x["final_loss"]} for x in runs]
    edits = [{"node": n, "field": f, "before": None, "after": v} for n, d in sorted(r["edits"].items()) for f, v in sorted(d.items())]
    what = [f"edited {', '.join(sorted(r['edits']))}" if r["edits"] else None,
            f"applied {' → '.join(r['swap'])}" if r["swap"] else None]
    return {
        "title": f"Change in {r['case_id']}: {' and '.join(x for x in what if x)}", "source": r.get("source"), "verdict": None,
        "start_total": r["start_total"], "total": runs[0]["final_net"], "start_loss": None, "loss": runs[0]["final_loss"],
        "compliant_total": r["compliant_total"], "order": r["swap"], "changes": edits, "outcomes": outcomes, "note": r.get("summary"),
    }


def compare(actions: list[dict]) -> dict:
    """A side-by-side report over the given actions (oldest first). The first one is what the others are measured against."""
    base = actions[0]["snapshot"]
    base_total, base_loss = _num(base.get("total")), _num(base.get("loss"))
    columns = []
    for a in actions:
        s = a["snapshot"]
        total, loss, start = _num(s.get("total")), _num(s.get("loss")), _num(s.get("start_total"))
        columns.append({
            "id": a["id"], "seq": a["seq"], "kind": a["kind"], "kind_label": ACTION_KINDS.get(a["kind"], a["kind"]), "title": s.get("title"),
            "case_id": a["case_id"], "log_label": a["log_label"], "created_at": a["created_at"], "verdict": s.get("verdict"),
            "order": s.get("order") or [], "start_total": s.get("start_total"), "total": s.get("total"), "loss": s.get("loss"),
            "compliant_total": s.get("compliant_total"), "outcomes": s.get("outcomes") or [], "note": s.get("note"),
            "moved": None if total is None or start is None else str(total - start),
            "total_vs_first": None if total is None or base_total is None else str(total - base_total),
            "loss_vs_first": None if loss is None or base_loss is None else str(loss - base_loss),
        })

    # every node value any of the actions changed: one row per (node, field), one cell per action
    seen: dict[tuple[str, str], dict] = {}
    for a in actions:
        for c in a["snapshot"].get("changes") or []:
            row = seen.setdefault((c["node"], c["field"]), {"node": c["node"], "field": c["field"], "values": {}})
            row["values"][str(a["seq"])] = {"before": c["before"], "after": c["after"]}
    node_rows = [seen[k] for k in sorted(seen)]

    return {"columns": columns, "node_rows": node_rows, "findings": _findings(actions, columns, node_rows)}


def _findings(actions: list[dict], columns: list[dict], node_rows: list[dict]) -> list[str]:
    out = []
    logs, cases = {c["log_label"] for c in columns}, {c["case_id"] for c in columns}
    if len(logs) > 1:
        out.append(f"These actions come from {len(logs)} different event logs ({', '.join(sorted(str(x) for x in logs))}), so their totals describe different data.")
    elif len(cases) > 1:
        out.append(f"These actions cover {len(cases)} different cases ({', '.join(sorted(str(x) for x in cases))}), so their totals describe different invoices.")
    else:
        out.append(f"{'Both' if len(columns) == 2 else f'All {len(columns)}'} actions are on the same case ({next(iter(cases))}).")

    def spread(key: str, name: str, high: str, low: str) -> None:
        vals = [(c, _num(c[key])) for c in columns if _num(c[key]) is not None]
        if len(vals) < 2:
            return
        hi, lo = max(vals, key=lambda x: x[1]), min(vals, key=lambda x: x[1])
        if hi[1] == lo[1]:
            out.append(f"Every action with a {name} gives the same {name}: {_money(hi[1])}.")
        else:
            out.append(f"{high} {name}: Action {hi[0]['seq']} ({_money(hi[1])}). {low} {name}: Action {lo[0]['seq']} ({_money(lo[1])}). "
                       f"They are {_money(hi[1] - lo[1])} apart.")

    spread("total", "total", "Highest", "Lowest")
    spread("loss", "loss", "Highest", "Lowest")

    for c in columns:
        moved = _num(c["moved"])
        if moved is not None:
            out.append(f"Action {c['seq']} ({c['title']}) moved the total by {_signed(moved)} from where it started."
                       if moved != 0 else f"Action {c['seq']} ({c['title']}) left the total where it started.")
    verdicts = {c["verdict"] for c in columns if c["verdict"]}
    if len(verdicts) > 1:
        out.append("The verdicts differ: " + "; ".join(f"Action {c['seq']} is {c['verdict']}" for c in columns if c["verdict"]) + ".")
    for r in node_rows:
        parts = []
        for c in columns:
            v = r["values"].get(str(c["seq"]))
            parts.append(f"Action {c['seq']}: {_money(v['before'])} → {_money(v['after'])}" if v and v["before"] is not None
                         else f"Action {c['seq']}: set to {v['after']}" if v else f"Action {c['seq']}: unchanged")
        out.append(f"{r['node']} {r['field']}. " + "; ".join(parts) + ".")
    missing = [c["seq"] for c in columns if _num(c["total"]) is None]
    if missing:
        out.append(f"Action{'s' if len(missing) > 1 else ''} {', '.join(map(str, missing))} produced no total: "
                   "this log's events have no financial fields, so the run stopped at the order constraints.")
    return out
