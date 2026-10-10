"""
benchmark_io.py
---------------
Member 1 -- load a benchmark case through the REAL pipeline and hand it to the
replay operator.

    public/<case>.jsonocel  --ingestion--> graph --candidate extraction-->
        constraint extraction --> CasePolicy (given_constraints merged)
    public/cases.json (reference data + policy version) --> CaseReference
    candidates + policy + reference --build_case--> CaseModel   (Member 2)

SEALED TRUTH: this module reads only `<root>/public/`. It never opens
`<root>/hidden/truth.json`; that file belongs to the evaluator
(`policy_engine.benchmark.evaluate`). If the system could read the truth it
would no longer be an evaluation.

Real VBFA cases cannot be loaded here: their events carry no unit price /
discount rate / tax rate / FX rate, so `build_case` has nothing to build from
(see docs/real_data_scope_decision.md).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from policy_engine import CaseModel, CaseReference, CasePolicy, build_case, load_policy

from replay_core.candidate_extraction import CandidateExtractionResult, extract_candidate_events
from replay_core.constraint_extraction import ConstraintExtractionResult, extract_constraints
from replay_core.graph import ObjectCentricGraph
from replay_core.ingestion import load_ocel
from replay_core.replay import ReplayOperator


class BenchmarkNotFound(FileNotFoundError):
    """The benchmark directory or case does not exist."""


@dataclass(frozen=True)
class LoadedCase:
    case_id: str
    entry: dict[str, Any]  # the public cases.json entry (reference data, policy version, ...)
    extraction: CandidateExtractionResult
    constraints: ConstraintExtractionResult
    policy: CasePolicy  # the policy with this case's structural locks merged in
    model: CaseModel
    graph: ObjectCentricGraph

    def operator(self) -> ReplayOperator:
        return ReplayOperator(self.model)

    @property
    def structural_pairs(self) -> list[tuple[str, str]]:
        """(before, after) hard order locks between candidate events (target excluded)."""
        return [p for p in self.policy.structural_pairs() if self.extraction.target_event.event_id not in p]


def _public_dir(root: str | Path) -> Path:
    pub = Path(root) / "public"
    if not (pub / "cases.json").is_file():
        raise BenchmarkNotFound(
            f"no benchmark at {Path(root)} -- generate it with:\n"
            "  PYTHONPATH=src python -m policy_engine.benchmark.generator --out data/benchmark --seed 7 --per-family 20\n"
            '  (PowerShell:  $env:PYTHONPATH="src"; python -m policy_engine.benchmark.generator --out data/benchmark --seed 7 --per-family 20)'
        )
    return pub


def load_benchmark_index(root: str | Path) -> dict[str, dict[str, Any]]:
    """case_id -> public entry. Public data only (no family label, no truth)."""
    pub = _public_dir(root)
    return {c["case_id"]: c for c in json.loads((pub / "cases.json").read_text())["cases"]}


def load_benchmark_case(root: str | Path, case_id: str, max_events: int = 8) -> LoadedCase:
    index = load_benchmark_index(root)
    if case_id not in index:
        raise BenchmarkNotFound(f"benchmark case {case_id!r} not found")
    entry = index[case_id]
    log = load_ocel(Path(root) / "public" / entry["ocel_file"], strict=True, log_validation_report=False)
    graph = ObjectCentricGraph(log)
    extraction = extract_candidate_events(graph, entry["target_event_id"], max_events=max_events)
    constraints = extract_constraints(extraction)
    policy = load_policy(entry["policy_version"]).with_given_constraints(
        entry["target_event_id"], [c.to_policy_dict() for c in constraints.constraints]
    )
    model = build_case(
        extraction.candidate_events, policy.policy, CaseReference.from_dict(entry["reference"]),
        extraction.target_event,
    )
    return LoadedCase(case_id, entry, extraction, constraints, policy, model, graph)
