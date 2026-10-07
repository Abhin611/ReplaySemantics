"""
schema.py
---------
Member 2 -- policy schema (Month 1), with `remediation_cost` reserved from the
start (roadmap M1) and populated per correction (M3), `given_constraints`
merge (Month-3 handoff, section 1), and policy-defined canonical orderings
(Month 4).

A policy is a VERSIONED, immutable document:

    {
      "schema_version": "1.0",
      "policy_version": "P-2026-Q3-001",       # P-{year}-Q{quarter}-{seq}
      "effective_from": "2026-07-01",
      "description": "...",
      "stacking": {"mode": "multiplicative", "max_total_discount": "0.25"},
      "rounding": {"decimals": 2, "mode": "ROUND_HALF_UP"},
      "corrections": [
         {"correction_id": "discount_correction", "activity": "Apply Discount",
          "node_type": "discount", "remediation_cost": 1, "description": "..."}, ...],
      "canonical_orderings": [
         {"rule_id": "CO-01", "before": "discount_correction", "after": "tax_correction",
          "rationale": "..."},
         {"rule_id": "CO-07", "within": "discount_correction", "by": "slot_ascending",
          "rationale": "..."}]
    }

Two kinds of ordering authority exist and must never be confused:

  * STRUCTURAL (given_constraints): the log itself fixes the order (shared
    object + different timestamp, or "candidate precedes target"). Produced by
    Member 1's constraint_extraction.py. Hard rules; never overridden by a
    policy rule; per-case, so they live in a `CasePolicy` overlay and do NOT
    bump the policy version or change the policy fingerprint.
  * POLICY-AUTHORED (canonical_orderings): the enterprise says which order is
    authoritative for correction types known to interact. Versioned. Only
    these can turn an order disagreement into POLICY-ORDERED.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Mapping

from policy_engine.domain import (
    ACTIVE_TYPES,
    ROUNDING_MODES,
    STACKING_MODES,
    D,
)

SCHEMA_VERSION = "1.0"
POLICY_VERSION_RE = re.compile(r"^P-\d{4}-Q[1-4]-\d{3}$")
POLICY_DIR = Path(__file__).parent / "policies"


class PolicyValidationError(ValueError):
    """The policy document violates the schema."""


@dataclass(frozen=True)
class CorrectionRule:
    correction_id: str
    activity: str
    node_type: str
    remediation_cost: int = 1
    description: str = ""


@dataclass(frozen=True)
class OrderingRule:
    """Either a pairwise rule (`before`/`after`, both correction ids) or a
    within-type tie-break (`within` = correction id, `by` = "slot_ascending")."""

    rule_id: str
    before: str | None = None
    after: str | None = None
    within: str | None = None
    by: str | None = None
    rationale: str = ""

    @property
    def kind(self) -> str:
        return "pairwise" if self.before else "within"


@dataclass(frozen=True)
class Policy:
    policy_version: str
    effective_from: str
    description: str
    stacking_mode: str
    max_total_discount: Any  # Decimal
    rounding_decimals: int
    rounding_mode: str
    corrections: tuple[CorrectionRule, ...]
    ordering_rules: tuple[OrderingRule, ...]
    schema_version: str = SCHEMA_VERSION
    warnings: tuple[str, ...] = field(default=(), compare=False)

    # ---- lookup -------------------------------------------------------------
    def correction(self, correction_id: str) -> CorrectionRule:
        for c in self.corrections:
            if c.correction_id == correction_id:
                return c
        raise KeyError(correction_id)

    def correction_for_activity(self, activity: str) -> CorrectionRule | None:
        from policy_engine.corrections import ACTIVITY_ALIASES

        activity = ACTIVITY_ALIASES.get(activity, activity)
        return next((c for c in self.corrections if c.activity == activity), None)

    def remediation_cost(self, correction_id: str) -> int:
        return self.correction(correction_id).remediation_cost

    # ---- ordering relation over correction ids --------------------------------
    def _edges(self) -> set[tuple[str, str]]:
        return {(r.before, r.after) for r in self.ordering_rules if r.kind == "pairwise"}

    def precedes(self, a: str, b: str) -> bool:
        """True iff the policy (transitively, over correction TYPES -- so a
        rule chain still orders two corrections whose intermediate type is
        absent from this subset) says correction type `a` is applied before
        `b`."""
        edges = self._edges()
        frontier, seen = {a}, set()
        while frontier:
            cur = frontier.pop()
            seen.add(cur)
            for (x, y) in edges:
                if x == cur:
                    if y == b:
                        return True
                    if y not in seen:
                        frontier.add(y)
        return False

    def within_type_rule(self, correction_id: str) -> OrderingRule | None:
        return next((r for r in self.ordering_rules if r.kind == "within" and r.within == correction_id), None)

    # ---- serialization -----------------------------------------------------
    def to_dict(self) -> dict:
        return {
            "schema_version": self.schema_version,
            "policy_version": self.policy_version,
            "effective_from": self.effective_from,
            "description": self.description,
            "stacking": {"mode": self.stacking_mode, "max_total_discount": str(self.max_total_discount)},
            "rounding": {"decimals": self.rounding_decimals, "mode": self.rounding_mode},
            "corrections": [
                {"correction_id": c.correction_id, "activity": c.activity, "node_type": c.node_type,
                 "remediation_cost": c.remediation_cost, "description": c.description}
                for c in self.corrections
            ],
            "canonical_orderings": [
                {k: v for k, v in {
                    "rule_id": r.rule_id, "before": r.before, "after": r.after,
                    "within": r.within, "by": r.by, "rationale": r.rationale}.items() if v is not None}
                for r in self.ordering_rules
            ],
        }

    def fingerprint(self) -> str:
        """SHA-256 over the canonical JSON of the policy. Goes into the
        evidence packet's provenance block (Member 3)."""
        blob = json.dumps(self.to_dict(), sort_keys=True, separators=(",", ":")).encode()
        return hashlib.sha256(blob).hexdigest()

    def with_given_constraints(self, target_event_id: str, given_constraints: Iterable[Mapping[str, Any]]) -> "CasePolicy":
        return CasePolicy(self, target_event_id, tuple(dict(c) for c in given_constraints))

    # ---- construction ----------------------------------------------------------
    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> "Policy":
        warnings: list[str] = []

        def need(obj: Mapping[str, Any], key: str, where: str) -> Any:
            if key not in obj:
                raise PolicyValidationError(f"{where}: missing required field '{key}'")
            return obj[key]

        if d.get("schema_version") != SCHEMA_VERSION:
            raise PolicyValidationError(f"unsupported schema_version {d.get('schema_version')!r} (expected {SCHEMA_VERSION})")
        version = need(d, "policy_version", "policy")
        if not POLICY_VERSION_RE.match(version):
            raise PolicyValidationError(f"policy_version {version!r} must match P-{{year}}-Q{{1-4}}-{{seq:03d}}")

        stacking = need(d, "stacking", "policy")
        if need(stacking, "mode", "stacking") not in STACKING_MODES:
            raise PolicyValidationError(f"stacking.mode must be one of {STACKING_MODES}")
        cap = D(need(stacking, "max_total_discount", "stacking"))
        if not (0 < cap <= 1):
            raise PolicyValidationError("stacking.max_total_discount must be in (0, 1]")

        rounding = need(d, "rounding", "policy")
        dec = need(rounding, "decimals", "rounding")
        if not isinstance(dec, int) or not (0 <= dec <= 6):
            raise PolicyValidationError("rounding.decimals must be an integer in 0..6")
        if need(rounding, "mode", "rounding") not in ROUNDING_MODES:
            raise PolicyValidationError(f"rounding.mode must be one of {sorted(ROUNDING_MODES)}")

        corrections: list[CorrectionRule] = []
        seen_ids: set[str] = set()
        seen_acts: set[str] = set()
        for i, c in enumerate(need(d, "corrections", "policy")):
            w = f"corrections[{i}]"
            cid = need(c, "correction_id", w)
            act = need(c, "activity", w)
            ntype = need(c, "node_type", w)
            if cid in seen_ids:
                raise PolicyValidationError(f"{w}: duplicate correction_id {cid!r}")
            if act in seen_acts:
                raise PolicyValidationError(f"{w}: duplicate activity {act!r}")
            if ntype not in ACTIVE_TYPES:
                raise PolicyValidationError(f"{w}: node_type {ntype!r} is not a replayable frozen-domain type")
            if "remediation_cost" not in c:
                cost = 1
                warnings.append(f"{w} ({cid}): remediation_cost missing, defaulting to 1")
            else:
                cost = c["remediation_cost"]
                if isinstance(cost, bool) or not isinstance(cost, int) or cost < 0:
                    raise PolicyValidationError(f"{w}: remediation_cost must be a non-negative integer")
            seen_ids.add(cid)
            seen_acts.add(act)
            corrections.append(CorrectionRule(cid, act, ntype, cost, c.get("description", "")))

        rules: list[OrderingRule] = []
        rule_ids: set[str] = set()
        for i, r in enumerate(d.get("canonical_orderings", [])):
            w = f"canonical_orderings[{i}]"
            rid = need(r, "rule_id", w)
            if rid in rule_ids:
                raise PolicyValidationError(f"{w}: duplicate rule_id {rid!r}")
            rule_ids.add(rid)
            if "before" in r or "after" in r:
                b, a = need(r, "before", w), need(r, "after", w)
                for cid in (b, a):
                    if cid not in seen_ids:
                        raise PolicyValidationError(f"{w}: unknown correction_id {cid!r}")
                if b == a:
                    raise PolicyValidationError(f"{w}: a rule cannot order a correction against itself; use 'within'")
                rules.append(OrderingRule(rid, before=b, after=a, rationale=r.get("rationale", "")))
            else:
                within, by = need(r, "within", w), need(r, "by", w)
                if within not in seen_ids:
                    raise PolicyValidationError(f"{w}: unknown correction_id {within!r}")
                if by != "slot_ascending":
                    raise PolicyValidationError(f"{w}: only by='slot_ascending' is supported")
                rules.append(OrderingRule(rid, within=within, by=by, rationale=r.get("rationale", "")))

        policy = cls(
            policy_version=version,
            effective_from=need(d, "effective_from", "policy"),
            description=d.get("description", ""),
            stacking_mode=stacking["mode"],
            max_total_discount=cap,
            rounding_decimals=dec,
            rounding_mode=rounding["mode"],
            corrections=tuple(corrections),
            ordering_rules=tuple(rules),
            warnings=tuple(warnings),
        )
        policy._check_acyclic()
        return policy

    def _check_acyclic(self) -> None:
        edges = self._edges()
        nodes = {n for e in edges for n in e}
        for n in nodes:
            if self.precedes(n, n):
                raise PolicyValidationError(f"canonical_orderings contain a cycle through {n!r}")

    @classmethod
    def load(cls, path: str | Path) -> "Policy":
        return cls.from_dict(json.loads(Path(path).read_text()))


@dataclass(frozen=True)
class CasePolicy:
    """Policy + the case's structural `given_constraints` overlay.

    Mirrors Member 1's handoff: structural constraints are appended per target
    event, are hard, take precedence over any policy rule, and do not change
    `policy.policy_version` or `policy.fingerprint()`. `fingerprint()` here
    covers both, for the evidence packet's provenance."""

    policy: Policy
    target_event_id: str
    given_constraints: tuple[dict, ...]

    def structural_pairs(self) -> list[tuple[str, str]]:
        return [(c["before"], c["after"]) for c in self.given_constraints]

    def to_dict(self) -> dict:
        d = self.policy.to_dict()
        d["given_constraints"] = {"target_event_id": self.target_event_id, "constraints": list(self.given_constraints)}
        return d

    def fingerprint(self) -> str:
        blob = json.dumps(self.to_dict(), sort_keys=True, separators=(",", ":")).encode()
        return hashlib.sha256(blob).hexdigest()


def list_policies() -> list[str]:
    return sorted(p.stem for p in POLICY_DIR.glob("P-*.json"))


def load_policy(policy_version: str) -> Policy:
    path = POLICY_DIR / f"{policy_version}.json"
    if not path.exists():
        raise FileNotFoundError(f"no policy {policy_version!r}; available: {list_policies()}")
    return Policy.load(path)
