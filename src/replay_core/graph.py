"""
graph.py
--------
Member 1 (Graph & Replay Core) -- Month 2 deliverable, part 1.

Builds the object-centric graph that sits between ingestion (Month 1) and
candidate-event extraction (Month 2, part 2) / the replay operator
(Month 3). Per the proposal's Phase 1 ("Access & Ingestion"): OCEL 2.0 Log
-> Object-Centric Graph -> (Policy P, Candidate Set E).

Representation:
    A bipartite graph with two node kinds:
        ("event", event_id)   -- one per OCELEvent
        ("object", object_id) -- one per OCELObject
    and an edge for every event-to-object (E2O) relation, carrying the
    OCEL2 qualifier and the event's timestamp as edge attributes.

    This is deliberately the *simplest* faithful graph representation of an
    OCEL 2.0 log (no object-object edges are synthesized) so that later
    stages can derive whatever secondary structure they need (e.g.
    object-object co-occurrence, directly-follows per object) from this
    single source of truth rather than from re-parsing the raw log.

Why bipartite instead of "events point to next event":
    OCEL logs don't have a native single case notion, so there is no one
    canonical directly-follows relation. Two events are only related
    through the object(s) they share. Keeping objects as first-class graph
    nodes (rather than collapsing them into event-event edges) preserves
    that object-centric structure, which is exactly what backward
    traversal in candidate_extraction.py relies on.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import networkx as nx

from replay_core.models import ObjectCentricLog


@dataclass(frozen=True)
class EventNode:
    event_id: str


@dataclass(frozen=True)
class ObjectNode:
    object_id: str


class ObjectCentricGraph:
    """Bipartite event<->object graph built from an ObjectCentricLog."""

    def __init__(self, log: ObjectCentricLog) -> None:
        self.log = log
        self._graph = nx.Graph()
        self._event_by_id = {e.event_id: e for e in log.events}
        self._build()

    def _build(self) -> None:
        g = self._graph
        for event in self.log.events:
            eid_node = ("event", event.event_id)
            g.add_node(eid_node, kind="event", activity=event.activity, timestamp=event.timestamp)
            for rel in event.related_objects:
                oid_node = ("object", rel.object_id)
                obj = self.log.get_object(rel.object_id)
                if oid_node not in g:
                    g.add_node(
                        oid_node,
                        kind="object",
                        object_type=obj.object_type if obj else None,
                    )
                g.add_edge(
                    eid_node,
                    oid_node,
                    qualifier=rel.qualifier,
                    timestamp=event.timestamp,
                )

    # ---- basic accessors ----

    def to_networkx(self) -> nx.Graph:
        """Escape hatch for visualization or algorithms not covered below."""
        return self._graph

    def num_event_nodes(self) -> int:
        return sum(1 for _, d in self._graph.nodes(data=True) if d.get("kind") == "event")

    def num_object_nodes(self) -> int:
        return sum(1 for _, d in self._graph.nodes(data=True) if d.get("kind") == "object")

    def objects_of_event(self, event_id: str) -> list[str]:
        """Objects touched by a given event (unordered)."""
        node = ("event", event_id)
        if node not in self._graph:
            raise KeyError(f"Unknown event id: {event_id}")
        return [oid for (_, oid) in self._graph.neighbors(node)]

    def events_of_object(self, object_id: str) -> list[str]:
        """All events touching a given object, chronologically ordered."""
        node = ("object", object_id)
        if node not in self._graph:
            raise KeyError(f"Unknown object id: {object_id}")
        neighbor_eids = [eid for (_, eid) in self._graph.neighbors(node)]
        return sorted(neighbor_eids, key=lambda eid: self._event_by_id[eid].timestamp)

    def events_before(self, object_id: str, before_ts: datetime, strict: bool = True) -> list[str]:
        """Events touching `object_id` strictly before `before_ts` (or <=
        if strict=False), chronologically ordered. This is the core
        primitive for backward traversal."""
        result = []
        for eid in self.events_of_object(object_id):
            ts = self._event_by_id[eid].timestamp
            if (ts < before_ts) if strict else (ts <= before_ts):
                result.append(eid)
        return result

    def object_type_of(self, object_id: str) -> str | None:
        obj = self.log.get_object(object_id)
        return obj.object_type if obj else None

    def get_event(self, event_id: str):
        return self._event_by_id[event_id]

    def object_cooccurrence_degree(self, object_id: str) -> int:
        """Number of distinct events touching this object -- a cheap proxy
        for how 'central' an object is in the graph."""
        return len(self.events_of_object(object_id))

    def summary(self) -> dict:
        return {
            "num_event_nodes": self.num_event_nodes(),
            "num_object_nodes": self.num_object_nodes(),
            "num_edges": self._graph.number_of_edges(),
        }
