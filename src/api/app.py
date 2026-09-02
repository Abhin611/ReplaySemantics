"""
api/app.py
----------
The bridge between your Figma design and the actual Month 1-2 Python
pipeline.

Why this exists: a Figma Sites link (fresco-finite-...figma.site) is a
static, click-through prototype -- it cannot import replay_core or run
Python. To make "Run Replay" do something real, you need a backend that
runs the pipeline and a frontend that calls it. This file is that backend.
webapp/index.html (served at "/") is a minimal coded frontend, styled
after your Figma screens, that calls it.

What's real vs. stubbed:
    Stage 1 (Extraction) and Stage 2 (Candidate Identification) run your
    actual Month 1 ingestion + Month 2 graph/candidate-extraction code
    against the real VBFA-derived OCEL 2.0 log.
    Stage 3 (Confluence Checks), Stage 4 (Policy Resolution), Stage 5
    (Verdict) are NOT built yet (Month 4 for you, Month 2-4 for Member 2 /
    Member 3) -- the API returns an honest "not_implemented" status for
    them rather than faking output.

Run it:
    pip install fastapi uvicorn
    cd ReplaySemantics
    PYTHONPATH=src uvicorn api.app:app --reload --port 8000

Then open http://localhost:8000 in a browser.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from replay_core.candidate_extraction import CandidateExtractionResult, extract_candidate_events
from replay_core.graph import ObjectCentricGraph
from replay_core.ingestion import load_ocel

REPO_ROOT = Path(__file__).parent.parent.parent
OCEL_PATH = REPO_ROOT / "data" / "raw" / "vbfa_o2c_2019_2021_eur.jsonocel"
WEBAPP_DIR = REPO_ROOT / "webapp"

app = FastAPI(title="ReplaySemantics API", version="0.1.0 (Month 1-2)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def build_case_graph(graph: ObjectCentricGraph, target, result: CandidateExtractionResult) -> dict:
    """
    Shapes the real candidate set into a node-link graph for the Replay
    Graph screen: one node per event (target + candidates), one edge per
    actual backward-traversal discovery link (which event's object led to
    which other event, per `result.discovered_via`) -- this is the real
    causal-ish parent/child structure of the traversal, not a generic
    "these two happen to share an object" pairing.

    Verdict coloring (PASS/POLICY-ORDERED/BLOCKED) is intentionally absent
    here -- that's Month 4 (confluence checker) output, which doesn't
    exist yet. Every node ships as "idle" so the frontend renders it
    exactly like the ungraded state in your Figma design.

    Note: because the candidate set is bounded to max_events by recency,
    a kept event's discovering (parent) event can itself have been pruned.
    Such nodes are marked "connected_to_target": false rather than being
    silently wired to the target with a fabricated edge -- see
    result.warnings for when this happens.
    """
    all_events = {e.event_id: e for e in result.candidate_events}
    all_events[target.event_id] = target

    nodes = []
    for eid, e in sorted(all_events.items(), key=lambda kv: kv[1].timestamp):
        parent_id = result.discovered_via.get(eid, (None, None))[0]
        connected = (eid == target.event_id) or (parent_id in all_events)
        nodes.append(
            {
                "id": e.event_id,
                "activity": e.activity,
                "timestamp": e.timestamp.isoformat(),
                "value_eur": e.attributes.get("value"),
                "hop": result.event_hops.get(e.event_id),  # None for the target
                "is_target": e.event_id == target.event_id,
                "connected_to_target": connected,
                "status": "idle",  # verdict coloring arrives with the Month 4 confluence checker
            }
        )

    edges = [
        {"source": parent_id, "target": eid, "shared_objects": [shared_obj]}
        for eid, (parent_id, shared_obj) in result.discovered_via.items()
        if parent_id in all_events
    ]

    return {"nodes": nodes, "edges": edges}


@lru_cache(maxsize=1)
def get_graph() -> ObjectCentricGraph:
    """Load + build the graph once per process, reused across requests."""
    log = load_ocel(OCEL_PATH, strict=True, log_validation_report=False)
    return ObjectCentricGraph(log)


@lru_cache(maxsize=1)
def get_case_list() -> list[dict]:
    """
    Curated 'cases' for the demo, from the actual ingested log. In the
    finished system, 'case' will mean something Member 2/3-defined (a
    validated, attributed realized loss) -- for now it's simply "an event
    you can run the Month 1-2 pipeline against."

    Mixed by two criteria, since they pull in opposite directions in this
    dataset: the highest-value invoice lines turn out to be structurally
    the simplest (few/no prior events), while the richest multi-hop
    traversal examples (like e977) are comparatively low-value. Showing
    only top-by-value would hide every interesting graph.
    """
    graph = get_graph()
    log = graph.log
    invoices = [
        e for e in log.events
        if e.activity.startswith("Create Invoice") and (e.attributes.get("value") or 0) > 0
    ]

    def to_case(e, note, max_candidates):
        return {
            "case_id": e.event_id,
            "activity": e.activity,
            "timestamp": e.timestamp.isoformat(),
            "value_eur": e.attributes.get("value"),
            "value_inr_cr": round((e.attributes.get("value") or 0) * 92 / 1e7, 3),
            "objects": sorted(e.object_ids()),
            "note": note,
            "max_candidates_at_default_hops": max_candidates,
        }

    # total_discovered (not the truncated candidate count) is the true
    # ceiling: how many candidates exist for this case at max_hops=3,
    # before any max_events cap trims them.
    discovered_counts: dict[str, int] = {}
    for e in invoices:
        r = extract_candidate_events(graph, e.event_id, max_events=1, min_events=3, max_hops=3)
        discovered_counts[e.event_id] = r.total_discovered

    by_value = sorted(invoices, key=lambda e: e.attributes.get("value", 0), reverse=True)
    top_value_cases = [
        to_case(e, "top value", discovered_counts[e.event_id]) for e in by_value[:15]
    ]

    richness = [(e, discovered_counts[e.event_id]) for e in invoices]
    richness.sort(key=lambda pair: pair[1], reverse=True)

    seen_ids = {c["case_id"] for c in top_value_cases}
    rich_cases = []
    for e, n in richness:
        if e.event_id in seen_ids:
            continue
        rich_cases.append(to_case(e, f"rich traversal ({n} candidates)", n))
        seen_ids.add(e.event_id)
        if len(rich_cases) >= 10:
            break

    return top_value_cases + rich_cases


@app.get("/api/health")
def health():
    graph = get_graph()
    return {"status": "ok", **graph.summary()}


@app.get("/api/dashboard")
def dashboard():
    """Real aggregate stats for the Dashboard screen, computed from the
    actual ingested dataset (replaces the mock '1,284 / 47 / 12 / $6.4M'
    numbers in the Figma design)."""
    graph = get_graph()
    log = graph.log
    cases = get_case_list()
    total_value_eur = sum(c["value_eur"] for c in cases)
    return {
        "total_events_in_log": len(log.events),
        "total_objects_in_log": len(log.objects),
        "available_cases": len(cases),
        "total_case_value_eur": round(total_value_eur, 2),
        "total_case_value_inr_cr": round(total_value_eur * 92 / 1e7, 2),
        "pipeline_stages_implemented": ["Extraction", "Candidate Identification"],
        "pipeline_stages_pending": ["Confluence Checks", "Policy Resolution", "Verdict"],
    }


@app.get("/api/cases")
def list_cases():
    return {"cases": get_case_list()}


@app.get("/api/cases/{case_id}/replay")
def run_replay(case_id: str, max_events: int = 8, min_events: int = 3, max_hops: int = 3):
    """
    Runs the real Month 1-2 pipeline for one case:
        Stage 1 (Extraction)             -- the target event + graph context
        Stage 2 (Candidate Identification) -- extract_candidate_events()
        Stage 3-5                        -- honestly reported as not implemented
    This is what your Figma Replay Console's "Run Replay" button should call.
    """
    graph = get_graph()
    try:
        target = graph.get_event(case_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown case/event id: {case_id}")

    result = extract_candidate_events(
        graph, case_id, max_events=max_events, min_events=min_events, max_hops=max_hops
    )

    def event_payload(e, stage_found_at=None):
        return {
            "event_id": e.event_id,
            "activity": e.activity,
            "timestamp": e.timestamp.isoformat(),
            "value_eur": e.attributes.get("value"),
            "objects": sorted(e.object_ids()),
        }

    graph_view = build_case_graph(graph, target, result)

    return {
        "case_id": case_id,
        "stage_1_extraction": {
            "status": "complete",
            "target_event": event_payload(target),
            "graph_context": graph.summary(),
        },
        "stage_2_candidate_identification": {
            "status": "complete",
            "num_candidates": len(result.candidate_events),
            "total_discovered": result.total_discovered,
            "hops_used": result.hops_used,
            "touched_objects": sorted(result.touched_objects),
            "candidates": [event_payload(e) for e in result.candidate_events],
            "warnings": result.warnings,
        },
        "replay_graph": graph_view,
        "stage_3_confluence_checks": {
            "status": "not_implemented",
            "message": "Scheduled for Month 4 (Member 1). PASS / POLICY-ORDERED / "
                       "BLOCKED classification requires the replay operator (Month 3) first.",
        },
        "stage_4_policy_resolution": {
            "status": "not_implemented",
            "message": "Depends on Member 2's correction functions, not yet built.",
        },
        "stage_5_verdict": {
            "status": "not_implemented",
            "message": "Depends on stages 3 and 4.",
        },
    }


# Serve the coded demo frontend at "/"
if WEBAPP_DIR.exists():
    app.mount("/", StaticFiles(directory=str(WEBAPP_DIR), html=True), name="webapp")
