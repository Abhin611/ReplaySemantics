"""
models.py
---------
Internal, framework-agnostic representation of an object-centric event log.

Why this exists:
    pm4py's OCEL object is a fine *loader* but we don't want the rest of
    ReplaySemantics (graph construction, replay operator, confluence checker)
    coupled directly to pm4py's internal column-naming conventions
    (`ocel:eid`, `ocel:oid`, ...). Everything downstream of ingestion should
    depend only on the plain dataclasses defined here.

    This module is intentionally dependency-light (stdlib only) so it can be
    imported by any teammate's module without pulling in pm4py.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional


@dataclass(frozen=True)
class OCELObject:
    """A single object instance in the log (e.g. one Purchase Order)."""
    object_id: str
    object_type: str
    attributes: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class E2ORelation:
    """An event-to-object relationship, with its OCEL2 qualifier."""
    event_id: str
    object_id: str
    qualifier: str


@dataclass(frozen=True)
class OCELEvent:
    """
    A single event, plus the objects it touches.

    `related_objects` is populated from the relations table at load time so
    that each event is self-contained -- this is the shape the candidate-event
    extraction step (Month 2, backward traversal) will consume directly.
    """
    event_id: str
    activity: str
    timestamp: datetime
    attributes: dict[str, Any] = field(default_factory=dict)
    related_objects: tuple[E2ORelation, ...] = field(default_factory=tuple)

    def object_ids(self) -> set[str]:
        return {r.object_id for r in self.related_objects}


@dataclass
class ObjectCentricLog:
    """
    The clean, validated, in-memory representation of one OCEL 2.0 case/log.

    This is the single object handed off from Month 1 (ingestion) to
    Month 2 (object-centric graph construction / candidate-event extraction).
    """
    source_path: str
    object_types: list[str]
    event_types: list[str]
    events: list[OCELEvent]
    objects: dict[str, OCELObject]  # keyed by object_id

    def summary(self) -> dict[str, Any]:
        activity_counts: dict[str, int] = {}
        for e in self.events:
            activity_counts[e.activity] = activity_counts.get(e.activity, 0) + 1

        type_counts: dict[str, int] = {}
        for o in self.objects.values():
            type_counts[o.object_type] = type_counts.get(o.object_type, 0) + 1

        timestamps = [e.timestamp for e in self.events]

        return {
            "source_path": self.source_path,
            "num_events": len(self.events),
            "num_objects": len(self.objects),
            "object_types": self.object_types,
            "event_types": self.event_types,
            "activity_counts": activity_counts,
            "object_type_counts": type_counts,
            "time_span": {
                "start": min(timestamps).isoformat() if timestamps else None,
                "end": max(timestamps).isoformat() if timestamps else None,
            },
        }

    def get_object(self, object_id: str) -> Optional[OCELObject]:
        return self.objects.get(object_id)

    def events_for_object(self, object_id: str) -> list[OCELEvent]:
        """All events touching a given object, sorted by time. Used heavily
        by the Month-2 backward-traversal candidate-event extractor."""
        return sorted(
            (e for e in self.events if object_id in e.object_ids()),
            key=lambda e: e.timestamp,
        )
