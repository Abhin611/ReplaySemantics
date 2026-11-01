"""
explain.py
----------
Plain-language, exact-number explanations of a replay state, for the Replay Console.

Two things are produced, both from the SAME domain arithmetic the replay uses (never
re-implemented in the UI, so the numbers on screen cannot drift from the engine):

  * total_calculation(op, state)  -- the case total laid out as the sum it really is:
        gross - discounts + tax  ->  x fx rate  ->  + adjustments  ->  + rounding  =  net
    One row per step, each with its own numbers. Used for Stage 0 (observed) and, with
    the state after each correction, for Stage 1..n of the step-through.

  * describe_events(op, activities) -- one card per event (e1, e2, ...): what the event
    stands for, every value stored in it, and how that event's own total is worked out.

All numbers are exact Decimals. `text` fields are display strings (thousands grouping,
at least 2 and at most 8 decimals, trailing zeros trimmed); `value` fields are the raw
exact strings so the UI can compare stages without parsing display text.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Mapping

from policy_engine.domain import (
    ADJUSTMENT, CONTEXT, CURRENCY, DISCOUNT, GROSS_PRICE, GROSS_QTY, NET, ROUNDING, TAX, ONE, ZERO,
    D, CaseState, DomainContext, discount_total, gross_amount, net_components, pre_rounding, quantize,
)

_MAX_DP = 8
REF_ID = "REF"  # the start node: the case reference (contract terms, tax table, FX table, authorised rates)


# ---- number formatting (display only) ------------------------------------------------
def fmt(x: Any) -> str:
    """1393.52400000 -> '1,393.524'; 0 -> '0.00'; -0.0260625 -> '-0.0260625'."""
    d = D(x)
    s = format(d.normalize(), "f")
    neg = s.startswith("-")
    s = s.lstrip("-")
    whole, _, frac = s.partition(".")
    frac = frac[:_MAX_DP].rstrip("0").ljust(2, "0")
    out = f"{int(whole):,}.{frac}"
    if neg and any(ch not in "0.," for ch in out):
        out = "-" + out
    return out


def fmt_plain(x: Any) -> str:
    """Like fmt but without forced decimals: 1000 -> '1,000'; 17.41905 -> '17.41905'."""
    d = D(x)
    s = format(d.normalize(), "f")
    neg = s.startswith("-")
    s = s.lstrip("-")
    whole, _, frac = s.partition(".")
    frac = frac[:_MAX_DP].rstrip("0")
    out = f"{int(whole):,}" + (f".{frac}" if frac else "")
    return ("-" if neg and out != "0" else "") + out


def pct(x: Any) -> str:
    return fmt_plain(D(x) * 100) + "%"


def _row(key: str, label: str, op: str, value: Decimal, expr: str = "", note: str = "") -> dict[str, Any]:
    return {"key": key, "label": label, "op": op, "value": str(value), "text": fmt(value), "expr": expr, "note": note}


def _gross_expr(ctx: DomainContext, nodes: Mapping[str, Mapping[str, Any]]) -> str:
    p_ids, q_ids = ctx.nodes_of(GROSS_PRICE), ctx.nodes_of(GROSS_QTY)
    price = D(nodes[p_ids[0]]["unit_price"]) if p_ids else ctx.reference.contract_price
    qty = D(nodes[q_ids[0]]["quantity"]) if q_ids else ctx.reference.ordered_quantity
    return (f"unit price {fmt_plain(price)} (from {p_ids[0] if p_ids else REF_ID}) × "
            f"quantity {fmt_plain(qty)} (from {q_ids[0] if q_ids else REF_ID})")


# ---- the total, step by step ----------------------------------------------------------
def total_calculation(op, state: CaseState) -> dict[str, Any]:
    """The case total for `state`, written as the sum it is.

    net = (gross - discounts + tax) x fx_rate + adjustments + rounding_adj
    """
    ctx: DomainContext = op.ctx
    nodes = state.nodes
    comp = net_components(nodes, ctx)

    # gross: price x quantity (from the order's events when present, else the contract terms)
    p_ids, q_ids = ctx.nodes_of(GROSS_PRICE), ctx.nodes_of(GROSS_QTY)
    price = D(nodes[p_ids[0]]["unit_price"]) if p_ids else ctx.reference.contract_price
    qty = D(nodes[q_ids[0]]["quantity"]) if q_ids else ctx.reference.ordered_quantity
    src = "order event" if (p_ids and q_ids) else "contract terms"
    rows: list[dict[str, Any]] = [
        _row("gross", "Gross value", "", comp["gross"],
             _gross_expr(ctx, nodes), f"from {src}" + ("" if (p_ids and q_ids) else f" ({REF_ID})")),
    ]

    d_ids = ctx.nodes_of(DISCOUNT)
    if d_ids:
        parts = " + ".join(f"{n} {fmt(nodes[n]['amount'])}" for n in d_ids)
        rows.append(_row("discount", "Discounts", "−", comp["discount"], parts if len(d_ids) > 1 else f"event {d_ids[0]}"))
    if ctx.nodes_of(TAX):
        t = ctx.nodes_of(TAX)[0]
        rows.append(_row("tax", "Tax", "+", comp["tax"], f"event {t} (rate {pct(nodes[t]['rate'])})"))
    else:
        rows.append(_row("tax", "Tax", "+", comp["tax"],
                         f"rate {pct(ctx.reference.tax_rate)} (from {REF_ID}) × (gross − discounts)",
                         f"no tax event: the contractual tax rate comes from {REF_ID}"))

    subtotal = comp["gross"] - comp["discount"] + comp["tax"]
    rows.append(_row("subtotal", "Subtotal", "=", subtotal,
                     f"{fmt(comp['gross'])} − {fmt(comp['discount'])} + {fmt(comp['tax'])}"))

    fx = comp["fx_rate"]
    converted = subtotal * fx
    if fx != ONE or ctx.nodes_of(CURRENCY):
        rows.append(_row("fx", "FX rate", "×", fx, f"currency event {ctx.nodes_of(CURRENCY)[0]}" if ctx.nodes_of(CURRENCY)
                         else f"reference rate (from {REF_ID})"))
        rows.append(_row("converted", "Converted amount", "=", converted, f"{fmt(subtotal)} × {fmt_plain(fx)}"))

    adj_ids = ctx.nodes_of(ADJUSTMENT)
    if adj_ids or comp["adjustment"] != ZERO:
        rows.append(_row("adjustment", "Adjustments", "+", comp["adjustment"],
                         " + ".join(f"{n} {fmt(nodes[n]['amount'])}" for n in adj_ids)))

    pre = converted + comp["adjustment"]
    r_ids = ctx.nodes_of(ROUNDING)
    if r_ids:
        r = nodes[r_ids[0]]
        r_note = f"event {r_ids[0]}: {r['decimals']} decimal{'s' if int(r['decimals']) != 1 else ''}, {r['mode']}"
    else:
        r_note = f"derived: {ctx.rounding_decimals} decimals, {ctx.rounding_mode}"
    rows.append(_row("rounding", "Rounding difference", "+", comp["rounding_adj"], r_note, "as posted"))
    rows.append(_row("net", "Net total", "=", comp["net"], f"{fmt(pre)} {'−' if comp['rounding_adj'] < 0 else '+'} {fmt(abs(comp['rounding_adj']))}"))
    return {"rows": rows, "net": str(comp["net"]), "net_text": fmt(comp["net"])}


# ---- what each event is -----------------------------------------------------------------
_TITLES = {
    GROSS_PRICE: ("Unit price", "The agreed price per unit on the order."),
    GROSS_QTY: ("Quantity", "The number of units on the order."),
    DISCOUNT: ("Discount", "A price reduction posted on the order. It is a percentage of its base amount."),
    TAX: ("Tax", "Tax charged on the order, a percentage of what is left after discounts."),
    CURRENCY: ("Currency conversion", "The exchange rate used to convert the order into the posting currency."),
    ADJUSTMENT: ("Adjustment", "A fixed amount posted on top of the order total."),
    ROUNDING: ("Rounding", "Rounds the total to a set number of decimals and posts the small difference."),
    NET: ("Net total (invoice posting)", "The final posted invoice total: every earlier event combined into one number."),
    CONTEXT: ("Context event", "Related to the case, but it has no financial effect: it never changes the total."),
}
_DEFAULT_ACTIVITY = {
    DISCOUNT: "Apply Discount", TAX: "Apply Tax Code", ROUNDING: "Apply Rounding", NET: "Post Invoice",
    GROSS_PRICE: "Set Price", GROSS_QTY: "Set Quantity", CURRENCY: "Convert Currency", ADJUSTMENT: "Post Adjustment",
}


def _line(label: str, value: Any, kind: str, expr: str = "", text: str | None = None) -> dict[str, Any]:
    return {"label": label, "value": None if value is None else str(value),
            "text": text if text is not None else (fmt(value) if value is not None else ""), "kind": kind, "expr": expr}


def describe_events(op, activities: Mapping[str, str] | None = None, facts: Mapping[str, Mapping[str, Any]] | None = None,
                    recorded: CaseState | None = None) -> list[dict[str, Any]]:
    """One description per event of the case, in pipeline order, from the op's starting state.

    facts:    event id -> what the OCEL log recorded for it (time, related objects, attributes). EVERY event gets it,
              including context events: even when a value does not change the total the reader can still see it.
    recorded: the books as originally posted. When the op starts from the corrected ledger, an input whose value
              differs from what was booked says so ("booked as 13%"), so nothing changes silently.
    """
    ctx: DomainContext = op.ctx
    nodes = op.observed.nodes
    activities = activities or {}
    out: list[dict[str, Any]] = []
    for n in ctx.stage_sorted(ctx.node_types):
        t = ctx.type_of(n)
        a = nodes[n]
        title, meaning = _TITLES[t]
        lines: list[dict[str, Any]] = []
        total: dict[str, Any] | None = None
        note = ""

        if t == GROSS_PRICE:
            lines.append(_line("Unit price", a["unit_price"], "input"))
            total = _line("Event total (unit price)", a["unit_price"], "total")
        elif t == GROSS_QTY:
            lines.append(_line("Quantity", a["quantity"], "input", text=fmt_plain(a["quantity"])))
            total = _line("Event total (quantity)", a["quantity"], "total", text=fmt_plain(a["quantity"]))
        elif t == DISCOUNT:
            gross = gross_amount(nodes, ctx)
            base = gross
            lines.append(_line("Discount rate", a["rate"], "input", text=f"{fmt_plain(a['rate'])}  ({pct(a['rate'])})"))
            lines.append(_line("Stacking slot", ctx.slots.get(n, 0), "input", text=str(ctx.slots.get(n, 0))))
            lines.append(_line("Gross value", gross, "step", _gross_expr(ctx, nodes)))
            if ctx.stacking_mode == "multiplicative":
                prior = [m for m in ctx.nodes_of(DISCOUNT) if ctx.slots.get(m, 0) < ctx.slots.get(n, 0)]
                for m in prior:
                    base -= D(nodes[m]["amount"])
                    lines.append(_line(f"less earlier discount {m}", nodes[m]["amount"], "step"))
                base_expr = "gross − earlier discounts" if prior else "gross (first discount)"
            else:
                base_expr = "gross (additive stacking)"
            lines.append(_line("Base amount", base, "step", base_expr))
            calc = D(a["rate"]) * base
            lines.append(_line("Rate × base", calc, "step", f"{fmt_plain(a['rate'])} × {fmt(base)}"))
            total = _line("Event total (discount amount)", a["amount"], "total")
            if D(a["amount"]) != calc:
                note = f"Posted amount differs from rate × base ({fmt(calc)}): the stored amount is what flows into the net."
        elif t == TAX:
            gross, disc = gross_amount(nodes, ctx), discount_total(nodes, ctx)
            base = gross - disc
            lines.append(_line("Tax rate", a["rate"], "input", text=f"{fmt_plain(a['rate'])}  ({pct(a['rate'])})"))
            lines.append(_line("Gross value", gross, "step", _gross_expr(ctx, nodes)))
            if ctx.nodes_of(DISCOUNT):
                lines.append(_line("less discounts", disc, "step"))
            lines.append(_line("Taxable base", base, "step", f"{fmt(gross)} − {fmt(disc)}"))
            calc = D(a["rate"]) * base
            lines.append(_line("Rate × base", calc, "step", f"{fmt_plain(a['rate'])} × {fmt(base)}"))
            total = _line("Event total (tax amount)", a["amount"], "total")
            if D(a["amount"]) != calc:
                note = f"Posted amount differs from rate × base ({fmt(calc)}): the stored amount is what flows into the net."
        elif t == CURRENCY:
            lines.append(_line("FX rate", a["fx_rate"], "input", text=fmt_plain(a["fx_rate"])))
            total = _line("Event total (fx rate)", a["fx_rate"], "total", text=fmt_plain(a["fx_rate"]))
        elif t == ADJUSTMENT:
            lines.append(_line("Fixed amount", a["amount"], "input"))
            total = _line("Event total (adjustment)", a["amount"], "total")
        elif t == ROUNDING:
            pre = pre_rounding(nodes, ctx)
            dec, mode = int(a["decimals"]), a["mode"]
            rounded = quantize(pre, dec, mode)
            lines.append(_line("Decimals kept", dec, "input", text=str(dec)))
            lines.append(_line("Rounding mode", mode, "input", text=mode))
            lines.append(_line("Amount before rounding", pre, "step", "(gross − discounts + tax) × fx + adjustments"))
            lines.append(_line(f"Rounded to {dec} dp", rounded, "step", mode))
            lines.append(_line("Rounded − before", rounded - pre, "step", f"{fmt(rounded)} − {fmt(pre)}"))
            total = _line("Event total (rounding difference)", a["adj"], "total")
            if D(a["adj"]) != rounded - pre:
                note = f"Posted difference is not {fmt(rounded - pre)}: the stored value is what flows into the net."
        elif t == NET:
            calc = total_calculation(op, op.observed)
            lines = [
                _line(r["label"], r["value"], "step", f"{r['op']} {r['expr']}".strip(" ") if r["expr"] else r["op"], text=r["text"])
                for r in calc["rows"] if r["key"] != "net"
            ]
            total = _line("Event total (net)", a["net"], "total")
        else:  # CONTEXT
            note = "No stored values affect the total."

        if recorded is not None:  # tell the reader where a shown input differs from what was booked
            for ln in lines:
                if ln["kind"] != "input":
                    continue
                key = {"Unit price": "unit_price", "Quantity": "quantity", "Discount rate": "rate", "Tax rate": "rate",
                       "FX rate": "fx_rate", "Fixed amount": "amount", "Decimals kept": "decimals",
                       "Rounding mode": "mode"}.get(ln["label"])
                booked = recorded.nodes.get(n, {}).get(key) if key else None
                if booked is not None and str(booked) != str(a.get(key)):
                    shown = pct(booked) if key == "rate" else fmt_plain(booked) if key != "mode" else str(booked)
                    ln["expr"] = (ln["expr"] + "  " if ln["expr"] else "") + f"(booked as {shown}; authorised value comes from {REF_ID})"
        sources: list[dict[str, str]] = []
        if t == NET:
            p_ids, q_ids = ctx.nodes_of(GROSS_PRICE), ctx.nodes_of(GROSS_QTY)
            tx, fx_ids, r_ids = ctx.nodes_of(TAX), ctx.nodes_of(CURRENCY), ctx.nodes_of(ROUNDING)
            price = D(nodes[p_ids[0]]["unit_price"]) if p_ids else ctx.reference.contract_price
            qty = D(nodes[q_ids[0]]["quantity"]) if q_ids else ctx.reference.ordered_quantity
            rate = D(nodes[tx[0]]["rate"]) if tx else ctx.reference.tax_rate
            fxr = D(nodes[fx_ids[0]]["fx_rate"]) if fx_ids else ctx.reference.fx_rate
            sources = [
                {"label": "Unit price", "text": fmt_plain(price),
                 "source": f"event {p_ids[0]}" if p_ids else f"{REF_ID}: the contract price"},
                {"label": "Quantity", "text": fmt_plain(qty),
                 "source": f"event {q_ids[0]}" if q_ids else f"{REF_ID}: the ordered quantity"},
                {"label": "Tax rate", "text": pct(rate),
                 "source": f"event {tx[0]}" if tx else f"{REF_ID}: the contractual tax rate (tax table lookup)"},
                {"label": "FX rate", "text": fmt_plain(fxr),
                 "source": f"event {fx_ids[0]}" if fx_ids else f"{REF_ID}: the FX table rate"},
                {"label": "Rounding", "text": (f"{nodes[r_ids[0]]['decimals']} dp, {nodes[r_ids[0]]['mode']}" if r_ids
                                                else f"{ctx.rounding_decimals} dp, {ctx.rounding_mode}"),
                 "source": f"event {r_ids[0]}" if r_ids else f"the policy {ctx.policy_version or ''}".strip()},
            ]
        out.append({
            "recorded": _recorded_lines(n, facts), "sources": sources,
            "node_id": n, "node_type": t, "title": title, "activity": activities.get(n) or _DEFAULT_ACTIVITY.get(t, ""),
            "meaning": meaning, "lines": lines, "total": total, "note": note,
            "exempt": op.noop_reason(n) == "exempt",
        })
    return out


def _recorded_lines(node_id: str, facts: Mapping[str, Mapping[str, Any]] | None) -> list[dict[str, str]]:
    """What the OCEL log itself holds for the event (shown for every node, financial or not)."""
    f = (facts or {}).get(node_id)
    if not f:
        return []
    rows = [{"label": "Time", "text": str(f.get("timestamp", ""))}]
    objs = f.get("objects") or []
    if objs:
        rows.append({"label": "Related objects", "text": ", ".join(f"{o['type']} {o['id']}" for o in objs)})
    for k, v in sorted((f.get("attributes") or {}).items()):
        rows.append({"label": k, "text": str(v)})
    return rows


def describe_reference(ctx: DomainContext, facts_policy: str = "") -> dict[str, Any]:
    """The START node REF: the fixed values every other node starts from, and where each one comes from."""
    r = ctx.reference
    lines = [
        _line("Contract unit price", r.contract_price, "input", text=fmt_plain(r.contract_price)),
        _line("Ordered quantity", r.ordered_quantity, "input", text=fmt_plain(r.ordered_quantity)),
        _line("Tax rate", r.tax_rate, "input", text=f"{fmt_plain(r.tax_rate)}  ({pct(r.tax_rate)})"),
        _line("FX rate", r.fx_rate, "input", text=fmt_plain(r.fx_rate)),
    ]
    for slot, rate in sorted(r.authorized_discount_rates.items()):
        lines.append(_line(f"Authorised discount rate (slot {slot})", rate, "input", text=f"{fmt_plain(rate)}  ({pct(rate)})"))
    for nid, amt in sorted(r.authorized_adjustments.items()):
        lines.append(_line(f"Authorised adjustment {nid}", amt, "input"))
    lines.append(_line("Rounding rule (policy)", f"{ctx.rounding_decimals} dp {ctx.rounding_mode}", "input",
                       text=f"{ctx.rounding_decimals} dp, {ctx.rounding_mode}"))
    for nid, ref in sorted(r.exceptions.items()):
        lines.append(_line(f"Approved exception on {nid}", ref, "input", text=str(ref)))
    return {
        "node_id": REF_ID, "node_type": "reference", "title": "Case reference (fixed values)",
        "activity": "Start node", "exempt": False, "lines": lines, "total": None, "recorded": [], "sources": [],
        "meaning": "The fixed starting values of this case: what a compliant posting would have used. The price, quantity, "
                   "tax rate, FX rate and authorised discount rates shown in the other events all come from here unless an "
                   "event of the graph carries its own value.",
        "note": "These are the contract terms and the tax / FX table lookups for this case (the case's public reference). "
                "They are never changed by a swap; change a value with Edit.",
    }
