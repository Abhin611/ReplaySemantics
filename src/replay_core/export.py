"""
export.py
---------
Writes the ingested log out as flat, dependency-free CSV artifacts under
data/processed/. This is the hand-off point to teammates:

    - Member 2 (Policy, Correction Functions) needs `objects.csv` to see the
      real object types + attributes to design correction functions against.
    - Member 3 (Attribution, Evidence, Interface) needs `events.csv` and
      `relations.csv` to shape the evidence-artifact schema early, without
      waiting on the graph/replay code.

Nobody downstream needs pm4py installed to read these -- just pandas/csv.
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from replay_core.models import ObjectCentricLog


def export_processed(log: ObjectCentricLog, out_dir: str | Path) -> dict[str, Path]:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    events_rows = [
        {
            "event_id": e.event_id,
            "activity": e.activity,
            "timestamp": e.timestamp.isoformat(),
            "object_ids": ";".join(sorted(e.object_ids())),
            **{f"attr__{k}": v for k, v in e.attributes.items()},
        }
        for e in log.events
    ]
    objects_rows = [
        {
            "object_id": o.object_id,
            "object_type": o.object_type,
            **{f"attr__{k}": v for k, v in o.attributes.items()},
        }
        for o in log.objects.values()
    ]
    relations_rows = [
        {"event_id": r.event_id, "object_id": r.object_id, "qualifier": r.qualifier}
        for e in log.events
        for r in e.related_objects
    ]

    events_path = out_dir / "events.csv"
    objects_path = out_dir / "objects.csv"
    relations_path = out_dir / "relations.csv"
    summary_path = out_dir / "summary.json"

    pd.DataFrame(events_rows).to_csv(events_path, index=False)
    pd.DataFrame(objects_rows).to_csv(objects_path, index=False)
    pd.DataFrame(relations_rows).to_csv(relations_path, index=False)
    summary_path.write_text(json.dumps(log.summary(), indent=2, default=str))

    return {
        "events": events_path,
        "objects": objects_path,
        "relations": relations_path,
        "summary": summary_path,
    }


if __name__ == "__main__":
    import argparse

    from replay_core.ingestion import load_ocel

    parser = argparse.ArgumentParser(description="Ingest an OCEL log and export processed CSVs.")
    parser.add_argument("path", help="Path to a raw OCEL 2.0 file")
    parser.add_argument("--out", default="data/processed", help="Output directory")
    args = parser.parse_args()

    ocel_log = load_ocel(args.path)
    paths = export_processed(ocel_log, args.out)
    for name, p in paths.items():
        print(f"{name}: {p}")
