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

import json
import os
import threading
from itertools import combinations
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from replay_core.candidate_extraction import CandidateExtractionResult, extract_candidate_events
from replay_core.constraint_extraction import extract_constraints
from replay_core.graph import ObjectCentricGraph
from replay_core.benchmark_io import BenchmarkNotFound, LoadedCase, load_benchmark_case, load_benchmark_index
from policy_engine.schema import POLICY_DIR, list_policies
from replay_core.confluence import CaseVerdict, ConfluenceChecker, transitive_closure
from replay_core.ingestion import load_ocel
from replay_core.propagation import EDITABLE_FIELDS, PropagationError, propagate_multi
from replay_core.replay import ReplayOperator, state_to_json

REPO_ROOT = Path(__file__).parent.parent.parent
OCEL_PATH = REPO_ROOT / "data" / "raw" / "vbfa_o2c_2019_2021_eur.jsonocel"
WEBAPP_DIR = REPO_ROOT / "webapp"
# Synthetic benchmark (generate with policy_engine.benchmark.generator). Override with REPLAY_BENCHMARK_DIR.
BENCHMARK_DIR = Path(os.environ.get("REPLAY_BENCHMARK_DIR", REPO_ROOT / "data" / "benchmark"))

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
        "pipeline_stages_implemented": [
            "Extraction", "Candidate Identification", "Order Constraints",
            "Confluence Checks (benchmark cases)", "Policy Resolution (benchmark cases)", "Verdict (benchmark cases)",
        ],
        "pipeline_stages_pending": ["Shapley Attribution", "Evidence Artifact"],
    }


@app.get("/api/cases")
def list_cases():
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
    }


@app.get("/api/cases/{case_id}/replay")
def run_replay(case_id: str, max_events: int = 8, min_events: int = 3, max_hops: int = 3):
    """
    Runs the pipeline for one case.

    * Real VBFA events: stages 1, 2, 2b are real. Stages 3-5 are NOT APPLICABLE: the events carry
      no price / discount / tax / FX fields, so there is nothing to replay (see
      docs/real_data_scope_decision.md).
    * Benchmark cases (RSC-...): all five stages run, on synthetic data labelled as such.
      (max_events / min_events / max_hops apply to VBFA cases only.)
    """
    if _is_benchmark_id(case_id):
        return _benchmark_replay_response(case_id)

    graph = get_graph()
    try:
        target = graph.get_event(case_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown case/event id: {case_id}")

    result = extract_candidate_events(
        graph, case_id, max_events=max_events, min_events=min_events, max_hops=max_hops
    )
    constraint_result = extract_constraints(result)
    na = ("Not applicable to real VBFA events: they carry no unit price / discount / tax / FX "
          "fields, so there is nothing to replay. Stages 3-5 run on the synthetic benchmark cases (RSC-...).")
    return {
        "case_id": case_id,
        "source": "real VBFA (SAP document flow)",
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


def _benchmark_case(case_id: str) -> LoadedCase:
    """Load a benchmark case, or raise the right HTTP error."""
    try:
        index = load_benchmark_index(BENCHMARK_DIR)
    except BenchmarkNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    if case_id not in index:
        try:
            is_vbfa = get_graph().get_event(case_id) is not None
        except KeyError:
            is_vbfa = False
        if is_vbfa:
            raise HTTPException(
                status_code=422,
                detail=f"{case_id} is a real VBFA event. Its events carry no price/discount/tax/FX fields, "
                       "so replay and editing are only available for benchmark cases (RSC-...).",
            )
        raise HTTPException(status_code=404, detail=f"Unknown case id: {case_id}")
    return _load_benchmark_case_cached(str(BENCHMARK_DIR), case_id)


# maxsize must exceed the number of benchmark cases (140 by default): a smaller LRU would evict
# and recompute the whole benchmark on every /api/benchmark/verdicts call.
@lru_cache(maxsize=1024)
def _load_benchmark_case_cached(root: str, case_id: str) -> LoadedCase:
    return load_benchmark_case(root, case_id)


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
             "source": BENCHMARK_SOURCE}
            for c in index.values()
        ],
    }


@app.get("/api/benchmark/verdicts")
def benchmark_verdicts():
    """Real verdict per benchmark case (runs + caches the confluence checker). Used by the Cases page."""
    try:
        index = load_benchmark_index(BENCHMARK_DIR)
    except BenchmarkNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    out = {}
    for cid in index:
        lc, cv = _checked_case_cached(str(BENCHMARK_DIR), cid)
        counts = cv.to_dict(include_subsets=False)["counts"]
        out[cid] = {
            "classification": cv.classification, "attribution_allowed": cv.attribution_allowed,
            "counts": counts, "num_players": len(cv.players),
            "num_candidates": len(lc.extraction.candidate_events), "policy_version": lc.entry["policy_version"],
        }
    return {"source": BENCHMARK_SOURCE, "verdicts": out}


@app.get("/api/cases/{case_id}/state")
def get_case_state(case_id: str):
    """Observed state of a benchmark case, the editable fields of each node, and the
    net/loss -- what a node-edit UI needs to render its form."""
    return _state_payload(case_id, _benchmark_case(case_id))


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
def edit_case(case_id: str, body: EditRequest):
    """Multi-node edit with a single cascade (propagate_multi): edit several nodes,
    send them all at once, get every recomputed downstream value back."""
    lc = _benchmark_case(case_id)
    try:
        result = propagate_multi(lc.model, body.edits)
    except PropagationError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return {"case_id": case_id, "source": BENCHMARK_SOURCE, **result.to_dict()}


def _is_benchmark_id(case_id: str) -> bool:
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
        })
    return rows


@lru_cache(maxsize=1024)
def _checked_case_cached(root: str, case_id: str) -> tuple[LoadedCase, CaseVerdict]:
    lc = _load_benchmark_case_cached(root, case_id)
    return lc, ConfluenceChecker.from_loaded(lc).check_case()


def _benchmark_replay_response(case_id: str) -> dict:
    lc, cv = _checked_case_cached(str(BENCHMARK_DIR), case_id)
    ex, cons = lc.extraction, lc.constraints
    op = lc.operator()
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
    trace_order = full.order_used if order_is_authoritative else op.canonical_order(cv.players)
    replay_all = op.replay(cv.players, trace_order)

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
        })

    from itertools import combinations
    eff_sorted = sorted(effective)
    distinct_unlocked = sum(1 for x, y in combinations(eff_sorted, 2)
                            if cv.subsets[",".join(sorted((x, y)))].unlocked_pairs == 1)
    distinct_locked = len(eff_sorted) * (len(eff_sorted) - 1) // 2 - distinct_unlocked

    blocked_note = (f"{len(blocked)} of {len(cv.subsets)} subsets are BLOCKED: the correction orders "
                    "disagree and the policy does not fix an order. No defensible number exists; attribution is withheld.")
    return {
        "case_id": case_id,
        "source": BENCHMARK_SOURCE,
        "policy_version": lc.entry["policy_version"],
        **_stages_1_to_2b(lc.graph, ex.target_event, ex, cons),
        "node_status": [
            {"event_id": n, "role": ("effective" if n in effective else "exempt"),
             "correction_id": lc.model.correction_ids.get(n),
             "order_sensitive_with": sorted(sensitive.get(n, ()))}
            for n in cv.players
        ] + [
            {"event_id": n, "role": "context", "correction_id": None, "order_sensitive_with": []}
            for n in sorted(op.ctx.node_types)
            if op.ctx.type_of(n) == "context"
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
            "realized_loss": str(op.observed_loss),
            "replay_of_all_corrections": {
                "order_is_authoritative": order_is_authoritative,
                "note": None if order_is_authoritative else
                        "Illustrative canonical order only: the full set is BLOCKED, so this is NOT an authoritative outcome.",
                **replay_all.to_dict(include_trace=True),
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
            _checked_case_cached(str(BENCHMARK_DIR), cid)
    except Exception:  # noqa: BLE001
        pass


@app.on_event("startup")
def _start_benchmark_warmup() -> None:
    threading.Thread(target=_warm_benchmark_cache, daemon=True).start()


# Serve the coded demo frontend at "/"
if WEBAPP_DIR.exists():
    app.mount("/", StaticFiles(directory=str(WEBAPP_DIR), html=True), name="webapp")
