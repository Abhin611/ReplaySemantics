"""
api/account.py
--------------
Everything that belongs to the signed-in user: the profile, the event logs they have loaded, their history of actions and
the comparison report. app.py's scope_request has already checked the sign-in and put the user on request.state.
"""

from __future__ import annotations

import hashlib
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from api import history, log_source, store

router = APIRouter(prefix="/api")

PLATFORMS = [
    {"id": "ocel2", "label": "OCEL 2.0 event log", "formats": [".jsonocel", ".xmlocel", ".sqlite", ".csv"], "available": True},
]
SAMPLES = {
    "benchmark": {"label": "ReplaySemantics benchmark (synthetic)", "kind": "benchmark",
                  "description": "Ready-made synthetic cases with prices, discounts, tax and rounding. Every stage runs: verdicts, swaps and Analysis."},
    "vbfa": {"label": "SAP order-to-cash (VBFA)", "kind": "file",
             "description": "A real SAP document flow. No financial fields, so a run stops at the order constraints."},
}


def current_user(request: Request) -> dict:
    return request.state.user


def _core():
    from api import app as core  # imported here because app.py includes this router
    return core


def _profile(user: dict) -> dict:
    return {k: user.get(k) for k in ("uid", "email", "name", "photo_url", "provider", "created_at", "last_login_at")}


class NameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)


@router.get("/me")
def get_me(user: dict = Depends(current_user)):
    active = store.active_log(user["uid"])
    return {"user": _profile(user), "active_log": store.public_log(active) if active else None}


@router.patch("/me")
def patch_me(body: NameRequest, user: dict = Depends(current_user)):
    return {"user": _profile(store.set_name(user["uid"], body.name.strip()))}


# ------------------------------------------------------------------------------------------ event logs
@router.get("/logs")
def get_logs(user: dict = Depends(current_user)):
    active = store.active_log(user["uid"])
    return {"logs": store.list_logs(user["uid"]), "active_log_id": active["id"] if active else None, "platforms": PLATFORMS,
            "samples": _samples()}


def _samples() -> list[dict]:
    """What can be opened without a link. The benchmark says how many cases it has, and is left out if none was generated."""
    core = _core()
    try:
        benchmark_cases = len(core.load_benchmark_index(core.BENCHMARK_DIR))
    except core.BenchmarkNotFound:
        benchmark_cases = 0
    return [{"id": k, "label": v["label"], "description": v["description"], "cases": benchmark_cases if k == "benchmark" else None}
            for k, v in SAMPLES.items() if k != "benchmark" or benchmark_cases]


def _check_platform(platform: str) -> None:
    if not any(p["id"] == platform and p["available"] for p in PLATFORMS):
        raise HTTPException(status_code=422, detail=f"The platform '{platform}' is not supported yet.")


def _adopt_file(user: dict, platform: str, source: str, source_ref: str, label: str, path) -> dict:
    """Read the file with the real ingestion code: a log that fails here is never saved."""
    core = _core()
    try:
        graph = core.graph_for(path)
    except Exception as exc:  # noqa: BLE001  (pm4py and the validator raise many types for a bad file)
        path.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=f"That file could not be read as an OCEL 2.0 log: {exc}") from exc
    return store.save_log(user["uid"], platform, "file", source, source_ref, label, str(path), len(graph.log.events), len(graph.log.objects))


class SampleRequest(BaseModel):
    sample: str


@router.post("/logs/sample")
def load_sample(body: SampleRequest, user: dict = Depends(current_user)):
    sample = SAMPLES.get(body.sample)
    if sample is None:
        raise HTTPException(status_code=404, detail="Unknown sample.")
    core = _core()
    if sample["kind"] == "benchmark":
        return {"log": store.save_log(user["uid"], "ocel2", "benchmark", "sample", body.sample, sample["label"], None, None, None)}
    graph = core.graph_for(core.OCEL_PATH)
    return {"log": store.save_log(user["uid"], "ocel2", "file", "sample", body.sample, sample["label"], str(core.OCEL_PATH),
                                  len(graph.log.events), len(graph.log.objects))}


class UrlRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2000)
    platform: str = "ocel2"


@router.post("/logs/url")
def load_from_url(body: UrlRequest, user: dict = Depends(current_user)):
    _check_platform(body.platform)
    url = body.url.strip()
    try:
        path, name = log_source.download(url, store.upload_dir(user["uid"]) / uuid.uuid4().hex)
    except log_source.LogSourceError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"log": _adopt_file(user, body.platform, "url", url, log_source.clean_label(name), path)}


@router.post("/logs/upload")
async def load_from_upload(request: Request, filename: str, platform: str = "ocel2", user: dict = Depends(current_user)):
    """The file is the raw request body."""
    _check_platform(platform)
    try:
        ext = log_source.extension_of(filename)
    except log_source.LogSourceError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    digest, size = hashlib.sha256(), 0
    path = store.upload_dir(user["uid"]) / f"{uuid.uuid4().hex}{ext}"
    with path.open("wb") as out:
        async for chunk in request.stream():
            size += len(chunk)
            if size > log_source.MAX_BYTES:
                out.close()
                path.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail=f"That log is larger than the {log_source.MAX_BYTES // (1024 * 1024)} MB limit.")
            digest.update(chunk)
            out.write(chunk)
    if not size:
        path.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail="That file is empty.")
    log = await run_in_threadpool(_adopt_file, user, platform, "upload", digest.hexdigest(), log_source.clean_label(filename), path)
    return {"log": log}


@router.post("/logs/{log_id}/open")
def open_log(log_id: int, user: dict = Depends(current_user)):
    log = store.open_log(user["uid"], log_id)
    if log is None:
        raise HTTPException(status_code=404, detail="Unknown event log.")
    return {"log": log}


# --------------------------------------------------------------------------------------------- history
class LimitsBody(BaseModel):
    max_events: int | None = None
    min_events: int = 3
    max_hops: int = 3


class ActionRequest(BaseModel):
    kind: str
    case_id: str
    limits: LimitsBody = LimitsBody()
    subset: list[str] = []
    order: list[str] = []
    a: str | None = None
    b: str | None = None
    edits: dict[str, dict[str, Any]] = {}
    swap: list[str] = []
    sequence: str = "both"


def _snapshot(body: ActionRequest) -> dict:
    """Run the action through the same functions the page used, so the record and the screen cannot disagree."""
    core = _core()
    lim = body.limits.model_dump()
    if body.kind == "run_case":
        return history.snapshot_run_case(core.run_replay(body.case_id, **lim))
    if body.kind == "swap":
        return history.snapshot_swap(core.get_scenario(body.case_id, ",".join(body.subset), ",".join(body.order) or None, **lim))
    if body.kind == "pair":
        return history.snapshot_pair(core.get_pair_run(body.case_id, body.a or "", body.b or "", **lim))
    if body.kind == "change":
        return history.snapshot_change(core.post_change(
            body.case_id, core.ChangeRequest(edits=body.edits, swap=body.swap, sequence=body.sequence), **lim))
    raise HTTPException(status_code=422, detail=f"Unknown action kind '{body.kind}'.")


@router.post("/history")
def record_action(body: ActionRequest, user: dict = Depends(current_user)):
    active = store.active_log(user["uid"])
    params = body.model_dump()
    latest = store.latest_action(user["uid"])
    # opening the same swap page again is not a new action
    if body.kind == "swap" and latest and latest["params"] == params and latest["log_id"] == (active and active["id"]):
        return {"action": latest, "recorded": False}
    action = store.add_action(user["uid"], active and active["id"], active and active["label"], body.kind, body.case_id, params, _snapshot(body))
    return {"action": action, "recorded": True}


@router.get("/history")
def get_history(user: dict = Depends(current_user)):
    return {"actions": store.list_actions(user["uid"]), "kinds": history.ACTION_KINDS}


class CompareRequest(BaseModel):
    ids: list[int]


@router.post("/history/compare")
def compare_actions(body: CompareRequest, user: dict = Depends(current_user)):
    ids = sorted(set(body.ids))
    if len(ids) < 2:
        raise HTTPException(status_code=422, detail="Choose at least two actions to compare.")
    actions = store.get_actions(user["uid"], ids)
    if len(actions) != len(ids):
        raise HTTPException(status_code=404, detail="One of those actions is not in your history.")
    return history.compare(actions)
