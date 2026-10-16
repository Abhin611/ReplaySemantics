"""
benchmark_run.py
----------------
Member 1 -- run ALL benchmark cases through ReplaySemantics and the two naive baselines
and score them against the sealed truth via Ashwathy's `evaluate.py` (the only reader of
`hidden/`).

    PowerShell:  $env:PYTHONPATH="src"; python -m replay_core.benchmark_run --root data/benchmark --out data/benchmark_results.json

Headline metrics (convenience versions; Member 3's harness owns the final numbers):
  classification_accuracy   predicted verdict == truth verdict
  valid_acceptance          truth not BLOCKED  -> predicted not BLOCKED and numbers match
  invalid_rejection         truth BLOCKED      -> predicted BLOCKED and attribution withheld
  false_attribution_rate    share of cases where a number was issued that is indefensible
                            (any attribution for a truth-BLOCKED case, or a non-zero share
                            for a zero-share player)
  wrong_number_rate         share of non-BLOCKED cases whose Shapley differs from truth > tol
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from decimal import Decimal
from pathlib import Path
from typing import Sequence

from policy_engine.benchmark.evaluate import TOL, load_truth, score_case
from replay_core.baselines import naive_sequential, naive_split
from replay_core.run_case import run_case
from replay_core.benchmark_io import load_benchmark_index

SYSTEMS = ("replaysemantics", "naive_sequential", "naive_split")


def _predict(root, case_id) -> dict[str, dict]:
    run = run_case(root, case_id)
    op = run.loaded.operator()
    return {
        "replaysemantics": run.prediction,
        "naive_sequential": naive_sequential(op),
        "naive_split": naive_split(op),
    }


def _wrong_number(res: dict) -> bool:
    """A Shapley value was issued for a non-BLOCKED case and it is off by more than the tolerance.
    (`max_abs_shapley_error` exists only when both truth and prediction carry a Shapley.)"""
    return Decimal(res.get("max_abs_shapley_error", "0")) > TOL


def run_benchmark(root: str | Path) -> dict:
    truth = load_truth(root)  # verifies the seal
    ids = sorted(load_benchmark_index(root))
    rows: dict[str, list[dict]] = {s: [] for s in SYSTEMS}
    for cid in ids:
        t = truth[cid]
        for system, pred in _predict(root, cid).items():
            res = score_case(t, pred)
            res["system"] = system
            res["predicted_classification"] = pred["classification"]
            rows[system].append(res)
    return {"n_cases": len(ids), "metrics": {s: _aggregate(rows[s]) for s in SYSTEMS}, "rows": rows}


def _rate(num: int, den: int) -> float | None:
    return None if den == 0 else round(num / den, 4)


def _aggregate(rows: list[dict]) -> dict:
    valid = [r for r in rows if r["truth_classification"] != "BLOCKED"]
    invalid = [r for r in rows if r["truth_classification"] == "BLOCKED"]
    coal_ok = lambda r: Decimal(r.get("max_abs_coalition_error", "0")) <= TOL
    by_family: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_family[r["family"]].append(r)
    return {
        "cases": len(rows),
        "classification_accuracy": _rate(sum(r["classification_correct"] for r in rows), len(rows)),
        "valid_cases": len(valid), "invalid_cases": len(invalid),
        "valid_acceptance": _rate(sum(1 for r in valid if r["predicted_classification"] != "BLOCKED"
                                      and r["classification_correct"] and not _wrong_number(r) and coal_ok(r)
                                      and not r["false_attribution"]), len(valid)),
        "invalid_rejection": _rate(sum(1 for r in invalid if r["predicted_classification"] == "BLOCKED"
                                       and r["attribution_withheld_correctly"]), len(invalid)),
        "false_attribution_rate": _rate(sum(r["false_attribution"] for r in rows), len(rows)),
        "false_attribution_on_blocked": _rate(sum(r["false_attribution"] for r in invalid), len(invalid)),
        "false_attribution_on_valid": _rate(sum(r["false_attribution"] for r in valid), len(valid)),
        "max_abs_shapley_error": str(max((Decimal(r["max_abs_shapley_error"]) for r in rows
                                          if "max_abs_shapley_error" in r), default=Decimal(0))),
        "max_abs_coalition_error": str(max((Decimal(r["max_abs_coalition_error"]) for r in rows
                                            if "max_abs_coalition_error" in r), default=Decimal(0))),
        "by_family": {f: {"n": len(rs), "classification_correct": sum(r["classification_correct"] for r in rs),
                          "false_attribution": sum(r["false_attribution"] for r in rs)}
                      for f, rs in sorted(by_family.items())},
    }


def _print(report: dict) -> None:
    print(f"{report['n_cases']} cases scored against the sealed truth\n")
    cols = ["classification_accuracy", "valid_acceptance", "invalid_rejection",
            "false_attribution_rate", "false_attribution_on_blocked", "false_attribution_on_valid",
            "max_abs_shapley_error", "max_abs_coalition_error"]
    print(f"{'metric':32}" + "".join(f"{s:>20}" for s in SYSTEMS))
    for c in cols:
        print(f"{c:32}" + "".join(f"{str(report['metrics'][s][c]):>20}" for s in SYSTEMS))
    print("\nper family (classification correct / n, false attributions):")
    fams = report["metrics"]["replaysemantics"]["by_family"]
    for f in fams:
        print(f"  {f:14}" + "".join(
            f"  {s[:14]:14} {report['metrics'][s]['by_family'][f]['classification_correct']:>2}/{fams[f]['n']:<2} fa={report['metrics'][s]['by_family'][f]['false_attribution']:<2}"
            for s in SYSTEMS))


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Score ReplaySemantics and naive baselines on the hidden benchmark.")
    ap.add_argument("--root", default="data/benchmark")
    ap.add_argument("--out", help="write the full report (incl. per-case rows) as JSON")
    a = ap.parse_args(argv)
    report = run_benchmark(a.root)
    _print(report)
    if a.out:
        Path(a.out).write_text(json.dumps(report, indent=2))
        print(f"\nfull report -> {a.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
