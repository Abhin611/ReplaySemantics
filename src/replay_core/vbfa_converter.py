"""
vbfa_converter.py
------------------
Converts a raw SAP VBFA export (Sales Document Flow table) into an OCEL 2.0
log, so that Member 1's ingestion pipeline can run against a real,
large-scale Order-to-Cash dataset instead of only the small canonical P2P
example.

Why VBFA:
    VBFA is the standard SAP table recording links between SD (Sales &
    Distribution) documents -- e.g. Order -> Delivery -> Invoice, or
    Order -> Credit Memo -- which is exactly the Order-to-Cash chain
    ReplaySemantics targets. Each row is a (preceding document,
    subsequent document) link, which maps naturally onto an OCEL 2.0 event
    relating two objects.

VBTYP (SD Document Category) code mapping:
    VBTYP is a fixed-value SAP domain (SE11 -> Domain VBTYP). The mapping
    below is the standard SAP value list; it is used to turn the raw
    single-letter/digit codes in VBTYP_V / VBTYP_N into human-readable
    object types and event activity names. A handful of rare/customer-
    specific codes are not in the standard domain list; those fall back to
    "Other Document ({code})" rather than a guessed label.

Row -> OCEL2 mapping:
    - Two objects per row: the preceding document (VBELV, typed via
      VBTYP_V) and the subsequent document (VBELN, typed via VBTYP_N).
      Objects are deduplicated across rows by (document number, type).
    - One event per row: "Create {subsequent type} (from {preceding type})",
      timestamped at ERDAT+ERZET, carrying RFMNG/MEINS/RFWRT/WAERS/MATNR/
      BWART/FKTYP as event attributes, related to both objects with
      qualifiers "subsequent document" / "preceding document".
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pm4py
from pm4py.objects.ocel.obj import OCEL

# Standard SAP VBTYP (SD document category) domain values.
VBTYP_LABELS: dict[str, str] = {
    "A": "Inquiry",
    "B": "Quotation",
    "C": "Order",
    "D": "Item Proposal",
    "E": "Scheduling Agreement",
    "F": "Scheduling Agreement (Ext. Service)",
    "G": "Contract",
    "H": "Returns",
    "I": "Order Without Charge",
    "J": "Delivery",
    "K": "Credit Memo Request",
    "L": "Debit Memo Request",
    "M": "Invoice",
    "N": "Invoice Cancellation",
    "O": "Credit Memo",
    "P": "Debit Memo",
    "Q": "WMS Transfer Order",
    "R": "Goods Movement",
    "S": "Credit Memo Cancellation",
    "T": "Returns Delivery For Order",
    "U": "Pro Forma Invoice",
    "V": "Purchase Order",
    "W": "Independent Requirements Plan",
    "X": "Handling Unit",
    "0": "Master Contract",
    "1": "Sales Activity",
    "2": "External Transaction",
    "3": "Invoice List",
    "4": "Credit Memo List",
    "5": "Intercompany Invoice",
    "6": "Intercompany Credit Memo",
    "7": "Delivery / Shipping Notification",
    "8": "Product Allocation",
}


def _label(code: str) -> str:
    code = (code or "").strip()
    if not code:
        return "Unknown Document"
    return VBTYP_LABELS.get(code, f"Other Document ({code})")


def load_vbfa_raw(csv_path: str | Path) -> pd.DataFrame:
    """Load the raw VBFA CSV export (note: despite the .zip extension in
    pm4py's test suite, the file is a plain CSV -- rename before loading)."""
    df = pd.read_csv(csv_path, dtype=str)
    df["RFWRT"] = pd.to_numeric(df["RFWRT"], errors="coerce")
    df["RFMNG"] = pd.to_numeric(df["RFMNG"], errors="coerce")
    df["timestamp"] = pd.to_datetime(
        df["ERDAT"].fillna("") + df["ERZET"].fillna("000000").str.zfill(6),
        format="%Y%m%d%H%M%S",
        errors="coerce",
    )
    return df


def filter_vbfa(
    df: pd.DataFrame,
    currency: str | None = "EUR",
    year_min: int | None = None,
    year_max: int | None = None,
) -> pd.DataFrame:
    """Slice the (large) raw VBFA table down to a tractable, coherent subset
    for graph construction / replay -- e.g. one currency, recent years."""
    out = df.copy()
    if currency is not None:
        out = out[out["WAERS"] == currency]
    if year_min is not None:
        out = out[out["timestamp"].dt.year >= year_min]
    if year_max is not None:
        out = out[out["timestamp"].dt.year <= year_max]
    out = out.dropna(subset=["timestamp", "VBELN", "VBELV"])
    return out.reset_index(drop=True)


def convert_vbfa_to_ocel(df: pd.DataFrame) -> OCEL:
    """Build a pm4py OCEL 2.0 object from a (filtered) VBFA dataframe."""

    # ---- objects: dedupe by (doc number, doc type) ----
    obj_records: dict[str, dict] = {}

    def register_object(doc_no: str, vbtyp_code: str) -> str:
        label = _label(vbtyp_code)
        oid = f"{doc_no}"
        if oid not in obj_records:
            obj_records[oid] = {
                "ocel:oid": oid,
                "ocel:type": label,
                "vbtyp_code": vbtyp_code,
            }
        return oid

    for _, row in df.iterrows():
        register_object(row["VBELV"], row["VBTYP_V"])
        register_object(row["VBELN"], row["VBTYP_N"])

    objects_df = pd.DataFrame(list(obj_records.values()))

    # ---- events: one per VBFA row ----
    event_rows = []
    relation_rows = []
    for i, row in df.iterrows():
        eid = f"e{i+1}"
        prec_label = _label(row["VBTYP_V"])
        subs_label = _label(row["VBTYP_N"])
        activity = f"Create {subs_label} (from {prec_label})"

        event_rows.append(
            {
                "ocel:eid": eid,
                "ocel:activity": activity,
                "ocel:timestamp": row["timestamp"],
                "quantity": row["RFMNG"],
                "unit": row["MEINS"],
                "value": row["RFWRT"],
                "currency": row["WAERS"],
                "material": row["MATNR"],
                "movement_type": row["BWART"],
                "billing_category": row["FKTYP"],
            }
        )
        relation_rows.append(
            {"ocel:eid": eid, "ocel:oid": row["VBELN"], "ocel:qualifier": "subsequent document"}
        )
        relation_rows.append(
            {"ocel:eid": eid, "ocel:oid": row["VBELV"], "ocel:qualifier": "preceding document"}
        )

    events_df = pd.DataFrame(event_rows)
    relations_df = pd.DataFrame(relation_rows)

    # attach ocel:type to relations, as pm4py's OCEL representation expects
    oid_to_type = dict(zip(objects_df["ocel:oid"], objects_df["ocel:type"]))
    relations_df["ocel:type"] = relations_df["ocel:oid"].map(oid_to_type)
    relations_df["ocel:activity"] = relations_df["ocel:eid"].map(
        dict(zip(events_df["ocel:eid"], events_df["ocel:activity"]))
    )
    relations_df["ocel:timestamp"] = relations_df["ocel:eid"].map(
        dict(zip(events_df["ocel:eid"], events_df["ocel:timestamp"]))
    )

    return OCEL(events=events_df, objects=objects_df, relations=relations_df)


def build_vbfa_ocel_file(
    raw_csv_path: str | Path,
    out_path: str | Path,
    currency: str = "EUR",
    year_min: int = 2019,
    year_max: int | None = None,
) -> dict:
    """End-to-end: load raw VBFA -> filter -> convert -> write OCEL2 JSON.
    Returns a small stats dict (rows used, value totals, object/event counts)."""
    raw = load_vbfa_raw(raw_csv_path)
    subset = filter_vbfa(raw, currency=currency, year_min=year_min, year_max=year_max)
    ocel = convert_vbfa_to_ocel(subset)

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    pm4py.write_ocel2_json(ocel, str(out_path))

    return {
        "rows_used": len(subset),
        "num_events": len(ocel.events),
        "num_objects": len(ocel.objects),
        "object_types": sorted(ocel.objects["ocel:type"].unique().tolist()),
        "currency": currency,
        "total_value": float(subset["RFWRT"].sum()),
        "date_range": [
            subset["timestamp"].min().isoformat(),
            subset["timestamp"].max().isoformat(),
        ],
        "out_path": str(out_path),
    }


if __name__ == "__main__":
    import argparse
    import json

    parser = argparse.ArgumentParser(description="Convert raw SAP VBFA CSV to OCEL 2.0 JSON.")
    parser.add_argument("raw_csv", help="Path to the raw VBFA CSV file")
    parser.add_argument("out_path", help="Output .jsonocel path")
    parser.add_argument("--currency", default="EUR")
    parser.add_argument("--year-min", type=int, default=2019)
    parser.add_argument("--year-max", type=int, default=None)
    args = parser.parse_args()

    stats = build_vbfa_ocel_file(
        args.raw_csv, args.out_path, currency=args.currency,
        year_min=args.year_min, year_max=args.year_max,
    )
    print(json.dumps(stats, indent=2, default=str))
