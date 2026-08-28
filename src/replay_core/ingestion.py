"""
ingestion.py
------------
Member 1 (Graph & Replay Core) -- Month 1 deliverable.

Responsibilities of this module, per the project proposal's Phase 1
("Access & Ingestion"):
    1. Load an OCEL 2.0 log from any of the standard serializations
       (.jsonocel, .xmlocel, .sqlite, .csv).
    2. Validate it structurally (required columns present, no dangling
       event-to-object relations, timestamps parseable, etc.) and report
       problems instead of failing silently.
    3. Convert it into the framework-agnostic `ObjectCentricLog` defined in
       models.py, which is what every downstream stage (graph construction,
       candidate-event extraction, replay operator, confluence checker)
       consumes.

Usage:
    from replay_core.ingestion import load_ocel

    log = load_ocel("data/raw/ocel20_example.jsonocel")
    print(log.summary())
"""

from __future__ import annotations

import logging
from pathlib import Path

import pandas as pd
import pm4py
from pm4py.objects.ocel.obj import OCEL

from replay_core.models import E2ORelation, OCELEvent, OCELObject, ObjectCentricLog

logger = logging.getLogger("replay_core.ingestion")

SUPPORTED_EXTENSIONS = {".jsonocel", ".xmlocel", ".sqlite", ".csv"}


class OCELValidationError(Exception):
    """Raised when a loaded OCEL log fails structural validation."""


class OCELValidationReport:
    """Collects non-fatal warnings and fatal errors found during validation."""

    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def error(self, msg: str) -> None:
        self.errors.append(msg)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)

    @property
    def is_valid(self) -> bool:
        return len(self.errors) == 0

    def raise_if_invalid(self) -> None:
        if not self.is_valid:
            raise OCELValidationError(
                f"OCEL validation failed with {len(self.errors)} error(s):\n"
                + "\n".join(f"  - {e}" for e in self.errors)
            )

    def __str__(self) -> str:
        lines = [f"Validation: {'PASS' if self.is_valid else 'FAIL'}"]
        if self.errors:
            lines.append(f"  Errors ({len(self.errors)}):")
            lines += [f"    - {e}" for e in self.errors]
        if self.warnings:
            lines.append(f"  Warnings ({len(self.warnings)}):")
            lines += [f"    - {w}" for w in self.warnings]
        return "\n".join(lines)


def _read_raw_ocel(path: Path) -> OCEL:
    """Dispatch to the correct pm4py reader based on file extension."""
    ext = path.suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(
            f"Unsupported OCEL file extension '{ext}'. "
            f"Supported: {sorted(SUPPORTED_EXTENSIONS)}"
        )

    readers = {
        ".jsonocel": pm4py.read_ocel2_json,
        ".xmlocel": pm4py.read_ocel2_xml,
        ".sqlite": pm4py.read_ocel2_sqlite,
        ".csv": pm4py.read_ocel2_csv,
    }
    logger.info("Reading OCEL 2.0 log from %s (format=%s)", path, ext)
    return readers[ext](str(path))


def validate_ocel(ocel: OCEL) -> OCELValidationReport:
    """
    Structural validation pass over a raw pm4py OCEL object, before we
    convert it to our internal representation.

    This is deliberately conservative: anything that would silently corrupt
    downstream replay logic (missing ids, unparsable timestamps, relations
    pointing at objects that don't exist) is an ERROR. Things that are
    suspicious but survivable (duplicate event ids, empty attribute sets)
    are WARNINGS.
    """
    report = OCELValidationReport()

    events_df = ocel.events
    objects_df = ocel.objects
    relations_df = ocel.relations

    eid_col = ocel.event_id_column
    oid_col = ocel.object_id_column
    otype_col = ocel.object_type_column
    ts_col = ocel.event_timestamp

    # --- required columns present ---
    for col, df, name in [
        (eid_col, events_df, "events"),
        (ts_col, events_df, "events"),
        (oid_col, objects_df, "objects"),
        (otype_col, objects_df, "objects"),
    ]:
        if col not in df.columns:
            report.error(f"Required column '{col}' missing from {name} table")

    if not report.is_valid:
        return report  # can't safely check further without base columns

    # --- no null event/object ids ---
    if events_df[eid_col].isna().any():
        report.error("One or more events have a null event id")
    if objects_df[oid_col].isna().any():
        report.error("One or more objects have a null object id")

    # --- duplicate ids ---
    dup_events = events_df[eid_col].duplicated().sum()
    if dup_events:
        report.warn(f"{dup_events} duplicate event id(s) found")
    dup_objects = objects_df[oid_col].duplicated().sum()
    if dup_objects:
        report.warn(f"{dup_objects} duplicate object id(s) found")

    # --- timestamps parseable / not null ---
    if events_df[ts_col].isna().any():
        report.error("One or more events have a null/unparsable timestamp")

    # --- relations point at real events and real objects (no dangling refs) ---
    known_event_ids = set(events_df[eid_col])
    known_object_ids = set(objects_df[oid_col])

    if not relations_df.empty:
        dangling_events = set(relations_df[eid_col]) - known_event_ids
        if dangling_events:
            report.error(
                f"{len(dangling_events)} relation(s) reference event id(s) "
                f"not present in the events table, e.g. {list(dangling_events)[:5]}"
            )
        dangling_objects = set(relations_df[oid_col]) - known_object_ids
        if dangling_objects:
            report.error(
                f"{len(dangling_objects)} relation(s) reference object id(s) "
                f"not present in the objects table, e.g. {list(dangling_objects)[:5]}"
            )

    # --- objects with an unknown / empty type ---
    if objects_df[otype_col].isna().any():
        report.warn("One or more objects have a missing object type")

    # --- events with no related objects at all (orphan events) ---
    if not relations_df.empty:
        events_with_relations = set(relations_df[eid_col])
        orphan_events = known_event_ids - events_with_relations
        if orphan_events:
            report.warn(
                f"{len(orphan_events)} event(s) have no related objects at all "
                f"(they will be unreachable by object-centric traversal), "
                f"e.g. {list(orphan_events)[:5]}"
            )
    else:
        report.warn("Relations table is empty -- no event-to-object links at all")

    return report


def _to_internal_representation(ocel: OCEL, source_path: str) -> ObjectCentricLog:
    """Convert a validated pm4py OCEL object into our framework-agnostic model."""
    eid_col = ocel.event_id_column
    oid_col = ocel.object_id_column
    otype_col = ocel.object_type_column
    ts_col = ocel.event_timestamp
    act_col = ocel.event_activity
    qual_col = ocel.qualifier

    # Pre-index columns that are "system" columns vs. free attribute columns
    event_system_cols = {eid_col, ts_col, act_col}
    object_system_cols = {oid_col, otype_col}

    # --- objects ---
    objects: dict[str, OCELObject] = {}
    for _, row in ocel.objects.iterrows():
        oid = row[oid_col]
        attrs = {
            c: row[c]
            for c in ocel.objects.columns
            if c not in object_system_cols and pd.notna(row[c])
        }
        objects[oid] = OCELObject(object_id=oid, object_type=row[otype_col], attributes=attrs)

    # --- relations, grouped by event id ---
    relations_by_event: dict[str, list[E2ORelation]] = {}
    if not ocel.relations.empty:
        for _, row in ocel.relations.iterrows():
            rel = E2ORelation(
                event_id=row[eid_col],
                object_id=row[oid_col],
                qualifier=row[qual_col] if qual_col in row and pd.notna(row[qual_col]) else "",
            )
            relations_by_event.setdefault(rel.event_id, []).append(rel)

    # --- events ---
    events: list[OCELEvent] = []
    for _, row in ocel.events.iterrows():
        eid = row[eid_col]
        attrs = {
            c: row[c]
            for c in ocel.events.columns
            if c not in event_system_cols and pd.notna(row[c])
        }
        ts = row[ts_col]
        ts = ts.to_pydatetime() if hasattr(ts, "to_pydatetime") else ts
        events.append(
            OCELEvent(
                event_id=eid,
                activity=row[act_col],
                timestamp=ts,
                attributes=attrs,
                related_objects=tuple(relations_by_event.get(eid, [])),
            )
        )
    events.sort(key=lambda e: e.timestamp)

    object_types = sorted({o.object_type for o in objects.values()})
    event_types = sorted({e.activity for e in events})

    return ObjectCentricLog(
        source_path=source_path,
        object_types=object_types,
        event_types=event_types,
        events=events,
        objects=objects,
    )


def load_ocel(
    path: str | Path,
    strict: bool = True,
    log_validation_report: bool = True,
) -> ObjectCentricLog:
    """
    Load, validate, and convert an OCEL 2.0 file into an ObjectCentricLog.

    Args:
        path: path to a .jsonocel / .xmlocel / .sqlite / .csv OCEL 2.0 file.
        strict: if True (default), raise OCELValidationError on any
            validation error. If False, log the errors as warnings and
            proceed anyway (only use this for exploratory work).
        log_validation_report: if True, print the validation report.

    Returns:
        ObjectCentricLog ready for Month-2 graph construction /
        candidate-event extraction.
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"OCEL file not found: {path}")

    raw = _read_raw_ocel(path)
    report = validate_ocel(raw)

    if log_validation_report:
        logger.info("\n%s", report)

    if strict:
        report.raise_if_invalid()

    return _to_internal_representation(raw, source_path=str(path))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    import argparse
    import json

    parser = argparse.ArgumentParser(description="Ingest and summarize an OCEL 2.0 log.")
    parser.add_argument("path", help="Path to a .jsonocel/.xmlocel/.sqlite/.csv OCEL 2.0 file")
    parser.add_argument(
        "--no-strict", action="store_true", help="Don't fail on validation errors"
    )
    args = parser.parse_args()

    ocel_log = load_ocel(args.path, strict=not args.no_strict)
    print(json.dumps(ocel_log.summary(), indent=2, default=str))
