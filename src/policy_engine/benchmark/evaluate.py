"""
evaluate.py
-----------
Member 2 -> Member 3 interface to the SEALED benchmark truth.

Only this module (and Member 3's evaluation harness through it) should open
`hidden/truth.json`. The system under test reads `public/` only.

    truth  = load_truth("data/benchmark")            # verifies the seal
    result = score_case(truth["RSC-2026-00051"], prediction)

`prediction` is whatever the pipeline produced for that case:

    {"classification": "PASS" | "POLICY_ORDERED" | "BLOCKED",
     "coalition_values": {"e1,e2": "123.45", ...},     # key = sorted event ids joined by ","; "" = empty set
     "shapley": {"e1": "61.72", ...} | None}           # None = attribution withheld

These are CONVENIENCE metrics for integration (roadmap M5); Member 3's harness
owns the headline numbers (valid-case acceptance, invalid-case rejection,
false-attribution rate) and may aggregate differently.
"""

from __future__ import annotations

import hashlib
import json
from decimal import Decimal
from pathlib import Path

TOL = Decimal("0.001")  # truth is stored at 6 dp


class SealError(RuntimeError):
    """hidden/truth.json does not match the hash committed in manifest.json."""


def verify_seal(root: str | Path) -> dict:
    root = Path(root)
    manifest = json.loads((root / "manifest.json").read_text())
    actual = hashlib.sha256((root / "hidden" / "truth.json").read_bytes()).hexdigest()
    if actual != manifest["hidden_truth_sha256"]:
        raise SealError(f"hidden truth hash mismatch: manifest {manifest['hidden_truth_sha256'][:12]}..., file {actual[:12]}...")
    return manifest


def load_truth(root: str | Path) -> dict[str, dict]:
    root = Path(root)
    verify_seal(root)
    return {t["case_id"]: t for t in json.loads((root / "hidden" / "truth.json").read_text())["truth"]}


def score_case(truth: dict, prediction: dict) -> dict:
    """Per-case comparison of a prediction against hidden truth."""
    out: dict = {"case_id": truth["case_id"], "family": truth["family"], "truth_classification": truth["classification"]}
    out["classification_correct"] = prediction.get("classification") == truth["classification"]

    t_phi = truth["shapley"]
    p_phi = prediction.get("shapley")
    out["attribution_withheld_correctly"] = (t_phi is None) == (p_phi is None)
    # false attribution = a number was issued where none is defensible (BLOCKED),
    # or a non-zero share went to a player whose true share is zero.
    false_attr = t_phi is None and p_phi is not None
    if t_phi is not None and p_phi is not None:
        false_attr = any(Decimal(p_phi.get(i, "0")) != 0 and abs(Decimal(t_phi[i])) <= TOL
                         and abs(Decimal(p_phi.get(i, "0"))) > TOL for i in t_phi)
        out["max_abs_shapley_error"] = str(max((abs(Decimal(p_phi.get(i, "0")) - Decimal(t_phi[i])) for i in t_phi), default=Decimal(0)))
    out["false_attribution"] = bool(false_attr)

    p_v = prediction.get("coalition_values")
    if p_v is not None:
        errs = [abs(Decimal(p_v[k]) - Decimal(tv)) for k, tv in truth["coalition_values"].items()
                if tv is not None and k in p_v and p_v[k] is not None]
        out["max_abs_coalition_error"] = str(max(errs, default=Decimal(0)))
    return out
