"""
run_case.py
-----------
Member 1 -- end-to-end runner for ONE benchmark case.

    public/<case>.jsonocel -> graph -> candidates -> constraints -> CaseModel
        -> ReplayOperator -> ConfluenceChecker -> CaseVerdict -> prediction dict

    PowerShell:  $env:PYTHONPATH="src"; python -m replay_core.run_case --case RSC-2026-00121

The prediction dict is exactly what `policy_engine.benchmark.evaluate.score_case`
expects. SEALED TRUTH: this module never opens `hidden/`.

Shapley is NOT computed by the replay core. It is a pluggable callable
`shapley_fn(players, values) -> {event_id: Decimal|Fraction}` supplied by the
attribution layer (Member 3). `provisional_shapley` below is an exact stand-in
so the pipeline can run end to end; replace it with Member 3's implementation.
Shapley is only ever requested when `attribution_allowed` (never for BLOCKED).
"""

from __future__ import annotations

import argparse
import json
import time
from dataclasses import dataclass
from decimal import Decimal
from fractions import Fraction
from itertools import combinations
from math import factorial
from pathlib import Path
from typing import Callable, Mapping, Sequence

from replay_core.benchmark_io import LoadedCase, load_benchmark_case, load_benchmark_index
from replay_core.confluence import CaseVerdict, ConfluenceChecker
from replay_core.replay import subset_key

ShapleyFn = Callable[[Sequence[str], Mapping[str, Decimal]], Mapping[str, "Decimal | Fraction"]]

_Q = Decimal("0.000001")


def provisional_shapley(players: Sequence[str], values: Mapping[str, Decimal]) -> dict[str, Decimal]:
    """Exact Shapley over the coalition table (keys = subset_key). PROVISIONAL stand-in for
    Member 3's attribution layer. Exact in Fraction, rounded to 6 dp at the end."""
    n = len(players)
    v = {frozenset(k.split(",")) if k else frozenset(): Fraction(x) for k, x in values.items() if x is not None}
    phi: dict[str, Decimal] = {}
    for i in players:
        rest = [p for p in players if p != i]
        tot = Fraction(0)
        for r in range(len(rest) + 1):
            w = Fraction(factorial(r) * factorial(n - r - 1), factorial(n))
            for s in combinations(rest, r):
                fs = frozenset(s)
                tot += w * (v[fs | {i}] - v[fs])
        phi[i] = (Decimal(tot.numerator) / Decimal(tot.denominator)).quantize(_Q)
    return phi


@dataclass(frozen=True)
class CaseRun:
    case_id: str
    loaded: LoadedCase
    verdict: CaseVerdict
    shapley: Mapping[str, Decimal] | None
    seconds: float

    @property
    def prediction(self) -> dict:
        return self.verdict.prediction(self.shapley)

    def summary(self) -> dict:
        v = self.verdict
        return {
            "case_id": self.case_id, "classification": v.classification,
            "attribution_allowed": v.attribution_allowed, "players": list(v.players),
            "counts": v.to_dict(include_subsets=False)["counts"],
            "shapley": None if self.shapley is None else {k: str(x) for k, x in self.shapley.items()},
            "seconds": round(self.seconds, 3),
        }


def run_case(root: str | Path, case_id: str, shapley_fn: ShapleyFn | None = provisional_shapley,
             max_events: int = 8) -> CaseRun:
    t0 = time.perf_counter()
    loaded = load_benchmark_case(root, case_id, max_events=max_events)
    verdict = ConfluenceChecker.from_loaded(loaded).check_case()
    shapley = None
    if verdict.attribution_allowed and shapley_fn is not None:  # the validity gate
        shapley = dict(shapley_fn(verdict.players, verdict.coalition_values()))
    return CaseRun(case_id, loaded, verdict, shapley, time.perf_counter() - t0)


def run_all(root: str | Path, shapley_fn: ShapleyFn | None = provisional_shapley,
            max_events: int = 8) -> list[CaseRun]:
    return [run_case(root, cid, shapley_fn, max_events) for cid in sorted(load_benchmark_index(root))]


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Run one benchmark case through the full replay pipeline.")
    ap.add_argument("--root", default="data/benchmark")
    ap.add_argument("--case", required=True)
    ap.add_argument("--json", action="store_true", help="print the full prediction dict")
    a = ap.parse_args(argv)
    run = run_case(a.root, a.case)
    if a.json:
        print(json.dumps(run.prediction, indent=2))
    else:
        s = run.summary()
        print(f"{s['case_id']}: {s['classification']}  (attribution {'allowed' if s['attribution_allowed'] else 'WITHHELD'})")
        print(f"  players {s['players']}  subsets {s['counts']}  {s['seconds']}s")
        print(f"  shapley {s['shapley']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
