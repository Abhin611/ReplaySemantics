"""
api/app.py
----------
The backend behind the React app in frontend/: it runs the replay pipeline on the event log the signed-in user has open.
Accounts, saved logs and history are in account.py.

What runs:
    Benchmark cases run every stage: extraction, candidates, order constraints, confluence checks, policy resolution and verdict.
    Other OCEL 2.0 logs have no pricing fields, so they stop at the order constraints (stage 2b) and report
    stages 3-5 as "not_applicable".
    Shapley attribution and the evidence artifact (Member 3) are not wired in yet.

Run it:
    pip install -r requirements.txt
    FIREBASE_PROJECT_ID=your-project-id PYTHONPATH=src uvicorn api.app:app --reload --port 8000

This serves the API only. For the site, run the frontend too:
    cd frontend
    npm run dev

Then open http://localhost:5173 in a browser.
"""

from __future__ import annotations

import json
import os
import threading
from contextvars import ContextVar
from dataclasses import dataclass
from itertools import combinations
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from replay_core.candidate_extraction import CandidateExtractionResult, extract_candidate_events
from replay_core.constraint_extraction import extract_constraints
from replay_core.graph import ObjectCentricGraph
from replay_core.benchmark_io import (
    BenchmarkNotFound, LoadedCase, load_benchmark_case, load_benchmark_index, suggested_max_hops,
)
from replay_core.ledger import LedgerError, analyse as ledger_analyse, ledger_view, run_change, run_pair
from replay_core.limits import hop_profile, limit_report
from policy_engine.schema import POLICY_DIR, list_policies
from replay_core.confluence import CaseVerdict, ConfluenceChecker, ConfluenceTooLarge, transitive_closure
from replay_core.ingestion import load_ocel
from replay_core.propagation import EDITABLE_FIELDS, PropagationError, propagate_multi
from replay_core.explain import describe_events, describe_reference, total_calculation
from replay_core.replay import ReplayOperator, state_to_json
from replay_core.scenario import ScenarioError, run_scenario
from replay_core.swap import SwapOperator

from api import account, auth, store

REPO_ROOT = Path(__file__).parent.parent.parent
OCEL_PATH = REPO_ROOT / "data" / "raw" / "vbfa_o2c_2019_2021_eur.jsonocel"
# Synthetic benchmark (generate with policy_engine.benchmark.generator). Override with REPLAY_BENCHMARK_DIR.
BENCHMARK_DIR = Path(os.environ.get("REPLAY_BENCHMARK_DIR", REPO_ROOT / "data" / "benchmark"))



@dataclass(frozen=True)
class ActiveLog:
    """The event log this request works on: the signed-in user's own choice."""

    id: int
    kind: str  # "benchmark" (the synthetic cases) or "file" (an OCEL 2.0 file)
    path: str | None
    label: str


# None = no signed-in request (tests and the warm-up thread): the original behaviour, VBFA plus the benchmark
_active: ContextVar[ActiveLog | None] = ContextVar("active_log", default=None)
_PUBLIC = {"/api/health"}
_NO_LOG_NEEDED = ("/api/me", "/api/logs", "/api/policies", "/api/history")


def _needs_log(request: Request) -> bool:
    path = request.url.path
    if path == "/api/history" and request.method == "POST":
        return True  # recording an action re-runs it on the active log
    return not any(path == p or path.startswith(p + "/") for p in _NO_LOG_NEEDED)


async def scope_request(request: Request) -> None:
    """Runs before every endpoint: check the Firebase sign-in, and point this request at the user's own event log.
    It is async so that what it sets on _active reaches the (threaded) endpoint."""
    path = request.url.path
    if not path.startswith("/api/") or path in _PUBLIC:
        return
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Please sign in.")
    try:
        claims = await run_in_threadpool(auth.verify_token, token)
    except auth.AuthError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    email = claims.get("email")
    request.state.user = store.upsert_user(
        claims["uid"], email, claims.get("name") or (email.split("@")[0] if email else None), claims.get("picture"),
        (claims.get("firebase") or {}).get("sign_in_provider"))
    if _needs_log(request):
        log = store.active_log(claims["uid"])
        if log is None:
            raise HTTPException(status_code=409, detail="Load an event log first.")
        _active.set(ActiveLog(log["id"], log["kind"], log["path"], log["label"]))


app = FastAPI(title="ReplaySemantics API", version="0.1.0", dependencies=[Depends(scope_request)])

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("REPLAY_CORS_ORIGINS", "http://localhost:5173").split(","),  # Vite dev server
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
    here: every node ships as "idle", and on benchmark cases the replay
    response's node_status carries the confluence checker's result.

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
                "status": "idle",  # verdict coloring comes from node_status, on benchmark cases
            }
        )

    edges = [
        {"source": parent_id, "target": eid, "shared_objects": [shared_obj]}
        for eid, (parent_id, shared_obj) in result.discovered_via.items()
        if parent_id in all_events
    ]

    return {"nodes": nodes, "edges": edges}


@lru_cache(maxsize=8)
def _graph_cached(path: str) -> ObjectCentricGraph:
    log = load_ocel(Path(path), strict=True, log_validation_report=False)
    return ObjectCentricGraph(log)


def graph_for(path) -> ObjectCentricGraph:
    """Load + build the graph of one log file once per process, reused across requests and users."""
    return _graph_cached(str(path))


def get_graph() -> ObjectCentricGraph:
    """The graph of the event log this request works on."""
    act = _active.get()
    return graph_for(act.path if act and act.path else OCEL_PATH)


def get_case_list() -> list[dict]:
    act = _active.get()
    return _case_list_cached(str(act.path if act and act.path else OCEL_PATH))


def _value(e) -> float:
    """An event's numeric `value` attribute, or 0: other logs may not have one, or may hold text in it."""
    v = e.attributes.get("value")
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else 0


# how many of the latest events are considered as cases in a log with no valued invoices
_MAX_FALLBACK_TARGETS = 300


@lru_cache(maxsize=8)
def _case_list_cached(path: str) -> list[dict]:
    """
    Curated 'cases' from an ingested log with no benchmark truth: here a
    case is simply an event you can run stages 1-2b against. Benchmark
    cases are listed separately.

    Mixed by two criteria, since they pull in opposite directions in this
    dataset: the highest-value invoice lines turn out to be structurally
    the simplest (few/no prior events), while the richest multi-hop
    traversal examples (like e977) are comparatively low-value. Showing
    only top-by-value would hide every interesting graph.
    """
    graph = graph_for(path)
    log = graph.log
    invoices = [e for e in log.events if e.activity.startswith("Create Invoice") and _value(e) > 0]
    # another company's log may have no such events: then the latest events are the cases
    targets = invoices or sorted(log.events, key=lambda e: e.timestamp)[-_MAX_FALLBACK_TARGETS:]

    def to_case(e, note, max_candidates):
        return {
            "case_id": e.event_id,
            "activity": e.activity,
            "timestamp": e.timestamp.isoformat(),
            "value_eur": _value(e) if invoices else None,
            "value_inr_cr": round(_value(e) * 92 / 1e7, 3) if invoices else None,
            "objects": sorted(e.object_ids()),
            "note": note,
            "max_candidates_at_default_hops": max_candidates,
        }

    # total_discovered (not the truncated candidate count) is the true
    # ceiling: how many candidates exist for this case at max_hops=3,
    # before any max_events cap trims them.
    discovered_counts: dict[str, int] = {}
    for e in targets:
        r = extract_candidate_events(graph, e.event_id, max_events=1, min_events=3, max_hops=3)
        discovered_counts[e.event_id] = r.total_discovered

    by_value = sorted(invoices, key=_value, reverse=True)
    top_value_cases = [
        to_case(e, "top value", discovered_counts[e.event_id]) for e in by_value[:15]
    ]

    richness = [(e, discovered_counts[e.event_id]) for e in targets]
    richness.sort(key=lambda pair: pair[1], reverse=True)

    seen_ids = {c["case_id"] for c in top_value_cases}
    rich_cases = []
    for e, n in richness:
        if e.event_id in seen_ids:
            continue
        rich_cases.append(to_case(e, f"rich traversal ({n} candidates)", n))
        seen_ids.add(e.event_id)
        if len(rich_cases) >= (10 if invoices else 25):
            break

    return top_value_cases + rich_cases


@app.get("/api/health")
def health():
    graph = get_graph()
    return {"status": "ok", **graph.summary()}


@app.get("/api/dashboard")
def dashboard():
    """Real aggregate stats for the Dashboard screen, computed from the
    event log the user has open."""
    act = _active.get()
    if act and act.kind == "benchmark":
        events, objects, cases, total_value_eur = None, None, _benchmark_case_rows(), 0
    else:
        graph = get_graph()
        cases = get_case_list()
        events, objects = len(graph.log.events), len(graph.log.objects)
        total_value_eur = sum(c["value_eur"] or 0 for c in cases)
    has_value = any(c["value_eur"] for c in cases)
    return {
        "log_label": act.label if act else None,
        "total_events_in_log": events,
        "total_objects_in_log": objects,
        "available_cases": len(cases),
        "total_case_value_eur": round(total_value_eur, 2) if has_value else None,
        "total_case_value_inr_cr": round(total_value_eur * 92 / 1e7, 2) if has_value else None,
        "pipeline_stages_implemented": [
            "Extraction", "Candidate Identification", "Order Constraints",
            "Confluence Checks (benchmark cases)", "Policy Resolution (benchmark cases)", "Verdict (benchmark cases)",
        ],
        "pipeline_stages_pending": ["Shapley Attribution", "Evidence Artifact"],
    }


@app.get("/api/cases")
def list_cases():
    act = _active.get()
    if act:  # a signed-in user sees the cases of their own log only
        return {"cases": _benchmark_case_rows() if act.kind == "benchmark" else get_case_list()}
    cases = get_case_list()
    try:  # synthetic benchmark cases (stages 1-5 run on these); absent benchmark => VBFA only
        cases = cases + _benchmark_case_rows()
    except BenchmarkNotFound:
        pass
    return {"cases": cases}


def _event_payload(e) -> dict:
    return {
        "event_id": e.event_id,
        "activity": e.activity,
        "timestamp": e.timestamp.isoformat(),
        "value_eur": e.attributes.get("value"),
        "objects": sorted(e.object_ids()),
    }


def _stages_1_to_2b(graph: ObjectCentricGraph, target, result, constraint_result) -> dict:
    """Stages 1, 2, 2b and the graph view: identical for real VBFA and benchmark cases."""
    return {
        "stage_1_extraction": {
            "status": "complete",
            "target_event": _event_payload(target),
            "graph_context": graph.summary(),
        },
        "stage_2_candidate_identification": {
            "status": "complete",
            "num_candidates": len(result.candidate_events),
            "total_discovered": result.total_discovered,
            "hops_used": result.hops_used,
            "touched_objects": sorted(result.touched_objects),
            "candidates": [_event_payload(e) for e in result.candidate_events],
            "warnings": result.warnings,
        },
        "stage_2b_constraint_extraction": {
            "status": "complete",
            "note": "Structural order-locks only (shared object + differing timestamp). "
                    "Does NOT resolve order-invariance -- that is what stage 3 tests, "
                    "on the permutable pairs only.",
            "num_constraints": len(constraint_result.constraints),
            "num_permutable_pairs": len(constraint_result.permutable_pairs),
            "given_constraints": [c.to_policy_dict() for c in constraint_result.constraints],
            "permutable_pairs": [
                {"a": p.event_id_a, "b": p.event_id_b}
                for p in constraint_result.permutable_pairs
            ],
        },
        "replay_graph": build_case_graph(graph, target, result),
        "event_facts": _event_facts(graph, target, result),
        "ocel_table": _ocel_table(graph, target, result),
    }


def _event_facts(graph: ObjectCentricGraph, target, result) -> dict:
    """What the OCEL log itself records for every event of the graph (time, related objects, attributes). Present for
    EVERY node, financial or not, so the graph never shows an empty event."""
    out = {}
    for e in [*result.candidate_events, target]:
        out[e.event_id] = {
            "activity": e.activity, "timestamp": e.timestamp.isoformat(),
            "objects": [{"id": r.object_id, "type": graph.log.get_object(r.object_id).object_type,
                         "qualifier": r.qualifier} for r in e.related_objects],
            "attributes": dict(e.attributes),
        }
    return out


def _ocel_table(graph: ObjectCentricGraph, target, result) -> dict:
    """The case as it sits in the OCEL 2.0 log: one row per event, oldest first. The Replay Console shows this table
    first and then turns each row into a graph node."""
    facts = _event_facts(graph, target, result)
    hops = result.event_hops
    rows = [{"id": k, "activity": v["activity"], "timestamp": v["timestamp"], "hop": hops.get(k),
             "is_target": k == target.event_id, "objects": [f"{o['type']} {o['id']}" for o in v["objects"]],
             "attributes": v["attributes"]} for k, v in facts.items()]
    rows.sort(key=lambda r: (r["timestamp"], r["id"]))
    return {"columns": ["Event", "Activity", "Time", "Related objects", "Attributes"], "rows": rows}


@app.get("/api/cases/{case_id}/replay")
def run_replay(case_id: str, max_events: int | None = None, min_events: int = 3, max_hops: int = 3):
    """
    Runs the pipeline for one case.

    * Real VBFA events: stages 1, 2, 2b are real. Stages 3-5 are NOT APPLICABLE: the events carry
      no price / discount / tax / FX fields, so there is nothing to replay (see
      docs/real_data_scope_decision.md).
    * Benchmark cases (RSC-...): all five stages run, on synthetic data labelled as such.
    The three limits (max_events: none by default, min_events, max_hops: 3 by default) apply to EVERY case alike;
    the response says whether the kept candidate set is complete or partial.
    """
    if _is_benchmark_id(case_id):
        try:
            return _benchmark_replay_response(case_id, (max_events, min_events, max_hops))
        except ConfluenceTooLarge as exc:
            raise HTTPException(status_code=422, detail=str(exc))

    graph = get_graph()
    try:
        target = graph.get_event(case_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown case/event id: {case_id}")

    result = extract_candidate_events(
        graph, case_id, max_events=max_events, min_events=min_events, max_hops=max_hops
    )
    constraint_result = extract_constraints(result)
    act = _active.get()
    name = act.label if act else "real VBFA events"
    na = (f"Not applicable to {name}: its events have no contract terms, unit price / discount / tax / FX "
          "fields to compare against, so there is nothing to replay. Stages 3-5 run on the synthetic benchmark cases (RSC-...).")
    return {
        "case_id": case_id,
        "source": act.label if act else "real VBFA (SAP document flow)",
        "limits": limit_report(graph, result, max_events=max_events, min_events=min_events, max_hops=max_hops),
        **_stages_1_to_2b(graph, target, result, constraint_result),
        "stage_3_confluence_checks": {"status": "not_applicable", "message": na},
        "stage_4_policy_resolution": {"status": "not_applicable", "message": na},
        "stage_5_verdict": {"status": "not_applicable", "message": na},
    }


# ---------------------------------------------------------------------------
# Benchmark cases: replay-core endpoints (Month 3)
#
# Real VBFA cases stop at stage 2b: their events carry no price / discount /
# tax / FX fields, so there is nothing to replay or edit (see
# docs/real_data_scope_decision.md). Everything below runs on the SYNTHETIC
# benchmark cases (ids like RSC-2026-00043) and says so in every response.
# ---------------------------------------------------------------------------
BENCHMARK_SOURCE = "benchmark (synthetic)"


class EditRequest(BaseModel):
    """edits: node id -> {input field: new value}, e.g. {"e1": {"rate": "0.05"}, "e2": {"rate": "0.18"}}"""

    edits: dict[str, dict[str, Any]]


DEFAULT_LIMITS = (None, 3, 3)  # (max_events, min_events, max_hops): no event cap, default 3 hops, for every case


def _benchmark_case(case_id: str, limits: tuple = DEFAULT_LIMITS) -> LoadedCase:
    """Load a benchmark case, or raise the right HTTP error."""
    act = _active.get()
    if act and act.kind != "benchmark":
        raise HTTPException(status_code=422, detail=f"Replay and editing need contract terms and financial fields, which "
                            f"{act.label} does not have. They are available on the benchmark sample log.")
    try:
        index = load_benchmark_index(BENCHMARK_DIR)
    except BenchmarkNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    if case_id not in index:
        try:
            is_vbfa = act is None and get_graph().get_event(case_id) is not None
        except KeyError:
            is_vbfa = False
        if is_vbfa:
            raise HTTPException(
                status_code=422,
                detail=f"{case_id} is a real VBFA event. Its events carry no price/discount/tax/FX fields, "
                       "so replay and editing are only available for benchmark cases (RSC-...).",
            )
        raise HTTPException(status_code=404, detail=f"Unknown case id: {case_id}")
    try:
        return _load_benchmark_case_cached(str(BENCHMARK_DIR), case_id, *limits)
    except ConfluenceTooLarge as exc:
        raise HTTPException(status_code=422, detail=str(exc))


# maxsize must exceed the number of benchmark cases (54 by default, times the limit settings in use): a smaller LRU would evict
# and recompute the whole benchmark on every /api/benchmark/verdicts call.
@lru_cache(maxsize=1024)
def _load_benchmark_case_cached(root: str, case_id: str, max_events=None, min_events=3, max_hops=3) -> LoadedCase:
    # the limits are part of the cache key: a different limit is a different candidate set
    return load_benchmark_case(root, case_id, max_events=max_events, min_events=min_events, max_hops=max_hops)


@app.get("/api/benchmark/cases")
def list_benchmark_cases():
    """Public benchmark index. Never includes the sealed ground truth or family labels."""
    try:
        index = load_benchmark_index(BENCHMARK_DIR)
    except BenchmarkNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {
        "source": BENCHMARK_SOURCE,
        "cases": [
            {"case_id": c["case_id"], "target_event_id": c["target_event_id"],
             "policy_version": c["policy_version"], "realized_loss": c["realized_loss"],
             "source": BENCHMARK_SOURCE, **_class_chip(c["case_id"])}
            for c in index.values()
        ],
    }


def _class_chip(case_id: str) -> dict:
    """What the system itself finds in the case (never the sealed truth): resolution class, blocked status and the
    depth of its deepest correctable event, read from the public log."""
    try:
        a = _analysis_cached(str(BENCHMARK_DIR), case_id, *_hint_limits(case_id))
        prof = hop_profile(_load_benchmark_case_cached(str(BENCHMARK_DIR), case_id, *_hint_limits(case_id)).graph,
                           load_benchmark_index(BENCHMARK_DIR)[case_id]["target_event_id"])
    except Exception:  # noqa: BLE001  (a list row must never fail the whole list)
        return {"resolution_class": None, "blocked": None, "hops": None, "suggested_max_hops": None}
    return {"resolution_class": a.get("resolution_class"), "blocked": a.get("blocked"),
            "hops": prof["deepest_active_hop"], "suggested_max_hops": _hint_limits(case_id)[2]}


@app.get("/api/benchmark/verdicts")
def benchmark_verdicts():
    """Real verdict per benchmark case (runs + caches the confluence checker). Used by the Cases page."""
    act = _active.get()
    if act and act.kind != "benchmark":
        return {"source": act.label, "verdicts": {}}
    try:
        index = load_benchmark_index(BENCHMARK_DIR)
    except BenchmarkNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    out = {}
    for cid in index:
        lc, cv = _checked_case_cached(str(BENCHMARK_DIR), cid, *_hint_limits(cid))
        counts = cv.to_dict(include_subsets=False)["counts"]
        out[cid] = {
            "classification": cv.classification, "attribution_allowed": cv.attribution_allowed,
            "counts": counts, "num_players": len(cv.players),
            "num_candidates": len(lc.extraction.candidate_events), "policy_version": lc.entry["policy_version"],
            "max_hops_used": lc.limits["limits"]["max_hops"],
        }
    return {"source": BENCHMARK_SOURCE, "verdicts": out}


@app.get("/api/cases/{case_id}/state")
def get_case_state(case_id: str, max_events: int | None = None, min_events: int = 3, max_hops: int = 3):
    """Observed state of a benchmark case, the editable fields of each node, and the
    net/loss -- what a node-edit UI needs to render its form."""
    return _state_payload(case_id, _benchmark_case(case_id, (max_events, min_events, max_hops)))


def _state_payload(case_id: str, lc: LoadedCase) -> dict:
    op = ReplayOperator(lc.model)
    ctx = lc.model.ctx
    return {
        "case_id": case_id, "source": BENCHMARK_SOURCE,
        "target_event_id": lc.entry["target_event_id"], "policy_version": lc.entry["policy_version"],
        "nodes": [
            {"node_id": n, "node_type": ctx.type_of(n), "editable_fields": list(EDITABLE_FIELDS.get(ctx.type_of(n), ())),
             "exempt": op.noop_reason(n) == "exempt", "attributes": state_to_json(op.observed)[n]}
            for n in ctx.stage_sorted(ctx.node_types)
        ],
        "observed_net": str(op.observed_net), "compliant_net": str(op.compliant_net),
        "realized_loss": str(op.observed_loss),
    }


@app.post("/api/cases/{case_id}/edit")
def edit_case(case_id: str, body: EditRequest, max_events: int | None = None, min_events: int = 3, max_hops: int = 3):
    """Multi-node edit with a single cascade (propagate_multi): edit several nodes,
    send them all at once, get every recomputed downstream value back."""
    lc = _benchmark_case(case_id, (max_events, min_events, max_hops))
    try:
        result = propagate_multi(lc.model, body.edits)
    except PropagationError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return {"case_id": case_id, "source": BENCHMARK_SOURCE, **result.to_dict()}


@app.get("/api/cases/{case_id}/scenario")
def get_scenario(case_id: str, subset: str, order: str | None = None, max_events: int | None = None,
                 min_events: int = 3, max_hops: int = 3):
    """Run a change: replay `subset` (comma-separated event ids, e.g. "e1,e2" -- usually one
    order-sensitive pair) and compare the corrected case with the previous one. `order` picks
    which legitimate order to headline (default: the policy's authoritative order). Pure and
    deterministic, so the UI keeps the whole scenario in the URL; nothing is stored."""
    lim = (max_events, min_events, max_hops)
    _benchmark_case(case_id, lim)  # right 404 / 422 for unknown or real-SAP ids
    try:
        # a swap replays the books as posted; the verdict of each subset still comes from the corrected-ledger check
        lc = _load_benchmark_case_cached(str(BENCHMARK_DIR), case_id, *lim)
        _, cv = _ledger_view_cached(str(BENCHMARK_DIR), case_id, *lim)
    except ConfluenceTooLarge as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    ids = [x for x in subset.split(",") if x]
    ord_ids = [x for x in order.split(",") if x] if order else None
    try:
        return {"source": BENCHMARK_SOURCE, **run_scenario(lc, cv, ids, ord_ids, op=SwapOperator(lc.model))}
    except ScenarioError as exc:
        raise HTTPException(status_code=422, detail=f"{exc}. Only posted-amount events (discount, tax, rounding) can be "
                            "swapped; if an event is missing here, raise max_hops / max_events so it is part of the case.")


@app.get("/api/cases/{case_id}/analysis")
def get_analysis(case_id: str, max_events: int | None = None, min_events: int = 3, max_hops: int = 3):
    """The corrected-ledger view: nodes with corrected inputs and posted amounts, the loss split, the policy summary
    over the posted-amount nodes, the swappable pairs, the resolution class and the description. The limits apply to
    every case; `complete` / `limits.partial_reasons` say when the kept candidate set is not the whole story."""
    lim = (max_events, min_events, max_hops)
    lc = _benchmark_case(case_id, lim)
    try:
        ex = lc.extraction
        return {"source": BENCHMARK_SOURCE, **_analysis_cached(str(BENCHMARK_DIR), case_id, *lim),
                "event_facts": _event_facts(lc.graph, ex.target_event, ex),
                "reference_node": describe_reference(lc.operator().ctx)}
    except ConfluenceTooLarge as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@app.get("/api/cases/{case_id}/pair")
def get_pair_run(case_id: str, a: str, b: str, max_events: int | None = None, min_events: int = 3, max_hops: int = 3):
    """Run one swappable pair: both orders step by step, posted vs should-be per dependent, authoritative order."""
    lc = _benchmark_case(case_id, (max_events, min_events, max_hops))
    try:
        return {"source": BENCHMARK_SOURCE, **run_pair(lc, a, b)}
    except LedgerError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


class ChangeRequest(BaseModel):
    """edits: node -> {input field: value} (one cascade); swap: posted-amount nodes to re-derive, in this order;
    sequence: swap_first | edit_first | both (compare the two)."""

    edits: dict[str, dict[str, Any]] = {}
    swap: list[str] = []
    sequence: str = "both"


@app.post("/api/cases/{case_id}/change")
def post_change(case_id: str, body: ChangeRequest, max_events: int | None = None, min_events: int = 3,
                max_hops: int = 3):
    lc = _benchmark_case(case_id, (max_events, min_events, max_hops))
    try:
        return {"source": BENCHMARK_SOURCE, **run_change(lc, body.edits, body.swap, body.sequence)}
    except LedgerError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


def _full_graph(prof: dict) -> dict:
    """The limits that show EVERY reachable event: the first run of a case draws the whole graph; the user narrows it
    afterwards. (min_events equals max_events so nothing is warned about or dropped.)"""
    deepest = max((r["hop"] for r in prof["rows"] if r["events"]), default=1)
    return {"max_hops": deepest, "max_events": prof["total_events"] + 1, "min_events": prof["total_events"] + 1}


@app.get("/api/cases/{case_id}/hops")
def get_hop_profile(case_id: str):
    """How many events (and how many correctable ones) are reachable at 1..6 hops, from the public log. Works for the
    real SAP events and the benchmark cases alike, and is what the limit controls are built on."""
    if _is_benchmark_id(case_id):
        lc = _benchmark_case(case_id)
        prof = hop_profile(lc.graph, lc.entry["target_event_id"], upto=10)
        return {"case_id": case_id, **prof, "suggested_max_hops": suggested_max_hops(lc.entry),
                "full_graph": _full_graph(prof)}
    act = _active.get()
    if act and act.kind == "benchmark":
        raise HTTPException(status_code=404, detail=f"Unknown case/event id: {case_id}")
    graph = get_graph()
    try:
        graph.get_event(case_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown case/event id: {case_id}")
    prof = hop_profile(graph, case_id, upto=10)
    return {"case_id": case_id, **prof, "suggested_max_hops": None, "full_graph": _full_graph(prof)}


def _is_benchmark_id(case_id: str) -> bool:
    act = _active.get()
    if act and act.kind != "benchmark":
        return False
    try:
        return case_id in load_benchmark_index(BENCHMARK_DIR)
    except BenchmarkNotFound:
        return False


def _benchmark_case_rows() -> list[dict]:
    """Benchmark cases in the same row shape as the VBFA case list (value_eur is None: the
    synthetic amounts are not EUR, so they are never shown as EUR)."""
    rows = []
    for c in load_benchmark_index(BENCHMARK_DIR).values():
        rows.append({
            "case_id": c["case_id"], "activity": "Post Invoice", "timestamp": None, "value_eur": None,
            "value_inr_cr": None, "objects": [], "max_candidates_at_default_hops": None,
            "note": f"benchmark (synthetic) · realized loss {float(c['realized_loss']):,.2f}",
            "source": BENCHMARK_SOURCE, "realized_loss": c["realized_loss"], "policy_version": c["policy_version"],
            **_class_chip(c["case_id"]),
        })
    return rows


@lru_cache(maxsize=1024)
def _checked_case_cached(root: str, case_id: str, max_events=None, min_events=3, max_hops=3) -> tuple[LoadedCase, CaseVerdict]:
    lc = _load_benchmark_case_cached(root, case_id, max_events, min_events, max_hops)
    return lc, ConfluenceChecker.from_loaded(lc).check_case()


@lru_cache(maxsize=1024)
def _ledger_view_cached(root: str, case_id: str, max_events=None, min_events=3, max_hops=3):
    """(lc_c, cv_c): the corrected-ledger view the Replay Console and the Corrected Scenario page run on."""
    return ledger_view(_load_benchmark_case_cached(root, case_id, max_events, min_events, max_hops))


@lru_cache(maxsize=1024)
def _analysis_cached(root: str, case_id: str, max_events=None, min_events=3, max_hops=3) -> dict:
    return ledger_analyse(_load_benchmark_case_cached(root, case_id, max_events, min_events, max_hops))


def _hint_limits(case_id: str) -> tuple:
    """Limits used for LIST rows (class / verdict chips): the depth the case's public log suggests, so a 5-hop case is
    summarised on its complete candidate set. Only list rows do this; the replay pages use the user's own limits."""
    return (None, 3, suggested_max_hops(load_benchmark_index(BENCHMARK_DIR)[case_id]))


def _with_calculations(op, replay) -> dict:
    """replay.to_dict() plus the written-out arithmetic of the observed total and of every step."""
    d = replay.to_dict(include_trace=True)
    d["observed_calculation"] = total_calculation(op, op.observed)
    for entry, step in zip(d["trace"], replay.trace):
        entry["calculation"] = total_calculation(op, step.state_after)
    return d


def _add_reference_node(stages: dict, ex) -> None:
    """The start node REF (fixed values), drawn left of the deepest event with an edge into the net total."""
    g = stages["replay_graph"]
    deepest = max((n["hop"] for n in g["nodes"] if isinstance(n.get("hop"), int)), default=0)
    target_id = ex.target_event.event_id
    g["nodes"].append({"id": "REF", "activity": "Case reference", "timestamp": None, "value_eur": None,
                       "hop": deepest + 1, "is_target": False, "is_reference": True, "connected_to_target": True,
                       "status": "idle"})
    g["edges"].append({"source": target_id, "target": "REF", "shared_objects": []})


def _benchmark_replay_response(case_id: str, limits: tuple = DEFAULT_LIMITS) -> dict:
    lc0 = _load_benchmark_case_cached(str(BENCHMARK_DIR), case_id, *limits)
    lc, cv = _ledger_view_cached(str(BENCHMARK_DIR), case_id, *limits)  # authorised inputs, posted amounts as posted
    ex, cons = lc.extraction, lc.constraints
    op = lc.operator()
    view = SwapOperator(lc0.model)  # what the console SHOWS: the original graph, every value as recorded
    effective = {n for n in cv.players if op.noop_reason(n) is None}

    sensitive: dict[str, set[str]] = {}
    for sv in cv.subsets.values():
        for a, b in sv.disagreeing_pairs:
            sensitive.setdefault(a, set()).add(b)
            sensitive.setdefault(b, set()).add(a)
    pair_list = sorted({tuple(p) for sv in cv.subsets.values() for p in sv.disagreeing_pairs})

    blocked = [sv for sv in cv.subsets.values() if sv.blocked]
    all_applied = sorted({r for sv in cv.subsets.values() if sv.resolution for r in sv.resolution.applied_rules})
    overridden = [o for sv in cv.subsets.values() if sv.resolution for o in sv.resolution.overridden_rules]
    counts = cv.to_dict(include_subsets=False)["counts"]

    full_key = ",".join(sorted(cv.players))
    full = cv.subsets[full_key]
    order_is_authoritative = full.order_used is not None
    replay_all = view.replay(cv.players, view.canonical_order(cv.players))  # the order that was posted: nothing moves

    unresolved = {tuple(sorted(p)) for sv in blocked if sv.resolution for p in sv.resolution.unresolved_pairs}
    pair_details = []
    for a, b in pair_list:
        two = cv.subsets.get(",".join(sorted((a, b))))
        reason = next((sv.resolution.reason_code for sv in blocked
                       if sv.resolution and (a, b) in {tuple(sorted(p)) for p in sv.resolution.unresolved_pairs}), None)
        pair_details.append({
            "a": a, "b": b,
            "status": "blocked" if (a, b) in unresolved else "policy_ordered",
            "policy_first": (two.order_used[0] if two is not None and two.verdict == "POLICY_ORDERED" else None),
            "reason_code": reason,
            "subsets_order_sensitive": sum(1 for sv in cv.subsets.values() if (a, b) in sv.disagreeing_pairs),
            "swap_difference": str(abs(view.replay((a, b), (a, b)).net - view.replay((a, b), (b, a)).net)),
        })

    from itertools import combinations
    eff_sorted = sorted(effective)
    distinct_unlocked = sum(1 for x, y in combinations(eff_sorted, 2)
                            if cv.subsets[",".join(sorted((x, y)))].unlocked_pairs == 1)
    distinct_locked = len(eff_sorted) * (len(eff_sorted) - 1) // 2 - distinct_unlocked

    blocked_note = (f"{len(blocked)} of {len(cv.subsets)} subsets are BLOCKED: the correction orders "
                    "disagree and the policy does not fix an order. No defensible number exists; attribution is withheld.")
    stages = _stages_1_to_2b(lc.graph, ex.target_event, ex, cons)
    _add_reference_node(stages, ex)
    activities = {n["id"]: n["activity"] for n in stages.get("replay_graph", {}).get("nodes", [])}
    return {
        "case_id": case_id, "limits": lc.limits,
        "source": BENCHMARK_SOURCE,
        "policy_version": lc.entry["policy_version"],
        **stages,
        "event_descriptions": [describe_reference(op.ctx), *describe_events(view, activities, stages["event_facts"])],
        "reference_node": describe_reference(op.ctx),
        "starts_from": "original graph: every value as recorded",
        "node_status": [
            {"event_id": n, "role": ("effective" if n in effective else "exempt"),
             "correction_id": lc.model.correction_ids.get(n),
             "order_sensitive_with": sorted(sensitive.get(n, ()))}
            for n in cv.players
        ] + [
            {"event_id": n, "role": "context", "correction_id": None, "order_sensitive_with": []}
            for n in sorted(op.ctx.node_types)
            if op.ctx.type_of(n) == "context"
        ] + [
            # input nodes (price, quantity, rates...) are not re-derived, so no order can matter for them: they are
            # order-independent and are changed with Edit
            {"event_id": n, "role": ("exempt" if op.noop_reason(n) == "exempt" else "effective"),
             "correction_id": lc.model.correction_ids.get(n), "order_sensitive_with": []}
            for n in sorted(op.ctx.node_types)
            if op.ctx.type_of(n) not in ("context", "net") and n not in cv.players
        ],
        "stage_3_confluence_checks": {
            "status": "complete",
            "message": f"{distinct_unlocked} of {distinct_unlocked + distinct_locked} pairs of correctable events have no "
                       f"fixed order in the log; each was tested in every subset it belongs to ({len(cv.subsets)} subsets). "
                       f"{len(pair_list)} of them really change the total when swapped.",
            "distinct_pairs_unlocked": distinct_unlocked,
            "distinct_pairs_locked": distinct_locked,
            "players": list(cv.players),
            "num_subsets": len(cv.subsets),
            "pairs_tested": cv.stats["pairs_tested"],
            "pairs_skipped_locked": cv.stats["pairs_skipped_locked"],
            "order_sensitive_pairs": [list(p) for p in pair_list],
            "counts": counts,
            "subsets": [
                {"key": sv.key, "subset": list(sv.subset), "agree": sv.agree, "verdict": sv.verdict,
                 "order_used": list(sv.order_used) if sv.order_used is not None else None,
                 "disagreeing_pairs": [list(p) for p in sv.disagreeing_pairs],
                 "distinct_nets": [str(x) for x in sv.distinct_nets]}
                for sv in cv.subsets.values()
            ],
        },
        "stage_4_policy_resolution": {
            "status": "complete",
            "message": (blocked_note if blocked else
                        ("The policy fixes an order for every disagreement." if counts["POLICY_ORDERED"] else
                         "No disagreement needed a policy order.")),
            "policy_version": lc.entry["policy_version"],
            "applied_rules": all_applied,
            "overridden_rules": overridden[:20],
            "pair_details": pair_details,
            "blocked_subsets": [
                {"key": sv.key, "reason_code": sv.resolution.reason_code,
                 "unresolved_pairs": [list(p) for p in sv.resolution.unresolved_pairs],
                 "unresolved_fields": list(sv.resolution.unresolved_fields)}
                for sv in blocked[:20]
            ],
        },
        "stage_5_verdict": {
            "status": "complete",
            "classification": cv.classification,
            "attribution_allowed": cv.attribution_allowed,
            "message": (f"{cv.classification}: " + (
                "attribution withheld - no single well-defined outcome." if not cv.attribution_allowed else
                "every subset has one well-defined outcome" +
                (" (policy-ordered where orders disagreed)." if cv.classification == "POLICY_ORDERED" else "."))),
            "counts": counts,
            "coalition_values": {k: (None if v is None else str(v)) for k, v in cv.coalition_values().items()},
            "shapley": None,
            "shapley_status": ("withheld: case is BLOCKED" if not cv.attribution_allowed
                               else "pending: attribution layer (Member 3) not yet wired"),
            "realized_loss": str(view.observed_loss),
            "replay_of_all_corrections": {
                "order_is_authoritative": order_is_authoritative,
                "note": None if order_is_authoritative else
                        "Illustrative canonical order only: the full set is BLOCKED, so this is NOT an authoritative outcome.",
                **_with_calculations(view, replay_all),
                "observed_breakdown": view.observed_breakdown(),
            },
        },
    }


# ---------------------------------------------------------------------------
# Policies: the real versioned policy files (policy_engine/policies/P-*.json)
# ---------------------------------------------------------------------------
def _policy_payload(version: str, used_by: int | None) -> dict:
    raw = json.loads((POLICY_DIR / f"{version}.json").read_text())
    ids = [c["correction_id"] for c in raw["corrections"]]
    rules = raw.get("canonical_orderings", [])
    # Which pairs of corrections does the policy order (directly or through a chain)? Every pair it
    # does NOT order is a pair the checker can never resolve if their order changes the total.
    closure = transitive_closure([(r["before"], r["after"]) for r in rules if "before" in r])
    pairs = list(combinations(sorted(ids), 2))
    unordered = [list(p) for p in pairs if p not in closure and (p[1], p[0]) not in closure]
    return {
        "policy_version": raw["policy_version"],
        "description": raw["description"],
        "effective_from": raw["effective_from"],
        "stacking": raw["stacking"],
        "rounding": raw["rounding"],
        "corrections": raw["corrections"],
        "canonical_orderings": rules,
        "coverage": {
            "total_pairs": len(pairs),
            "ordered_pairs": len(pairs) - len(unordered),
            "unordered_pairs": unordered,
        },
        "used_by_cases": used_by,  # benchmark cases referencing this version (None: no benchmark generated)
    }


@app.get("/api/policies")
def get_policies():
    """Every policy version in policy_engine/policies, with its ordering rules and how much of the
    correction-pair space those rules cover."""
    try:
        usage: dict | None = {}
        for c in load_benchmark_index(BENCHMARK_DIR).values():
            usage[c["policy_version"]] = usage.get(c["policy_version"], 0) + 1
    except BenchmarkNotFound:
        usage = None
    return {
        "policies": [_policy_payload(v, None if usage is None else usage.get(v, 0)) for v in list_policies()]
    }


def _warm_benchmark_cache() -> None:
    """Pre-compute every benchmark verdict in the background so the Cases page opens instantly.
    Best effort only: a missing/odd benchmark must never stop the server from starting."""
    try:
        for cid in load_benchmark_index(BENCHMARK_DIR):
            _checked_case_cached(str(BENCHMARK_DIR), cid, *_hint_limits(cid))
            _analysis_cached(str(BENCHMARK_DIR), cid, *_hint_limits(cid))
    except Exception:  # noqa: BLE001
        pass


@app.on_event("startup")
def _start_benchmark_warmup() -> None:
    threading.Thread(target=_warm_benchmark_cache, daemon=True).start()


app.include_router(account.router)
