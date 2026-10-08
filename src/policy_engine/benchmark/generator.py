"""
generator.py
------------
Member 2 -- hidden-generative benchmark (Month 5; design started Month 2,
generator v1 Month 3).

Each case is built GENERATIVELY: a policy-compliant ledger is constructed
first, then a known set of deviation events is injected, so the true
counterfactual values are known by construction. Truth is computed by the
independent oracle in reference_sim.py and written to a SEALED file the
system never reads; only `evaluate.py` (and Member 3's harness) open it.

Families (the abstract's list and the roadmap's list, merged):

    single_event    one deviating event + null (context) events
    independent     several deviations with additive effects          -> additive game
    interaction     threshold loss; every cause individually breaches
                    the ceiling, so ALL corrections are needed        -> v(A)=v(B)=0, v(AB)=L
    redundancy      threshold loss; any single correction clears the
                    breach                                            -> v(A)=v(B)=v(AB)=L
    exception       an approved policy exemption: looks like a
                    deviation, is not; must receive zero attribution  -> phi(exempt)=0
    policy_ordered  interacting chain (discount/tax/rounding/...) whose
                    orders disagree but the policy fixes the order    -> POLICY_ORDERED
    non_confluent   same chain, but the policy does NOT cover the
                    disagreeing pair                                  -> BLOCKED, no attribution

"exception" is interpreted as an authorized policy exemption (the roadmap
does not define it further); say so in the write-up if you keep the name.

Outputs (never mixes the two directories):
    <out>/public/<case_id>.jsonocel   OCEL 2.0 log (no truth, no family label)
    <out>/public/cases.json           index: target, policy version, reference data, realized loss
    <out>/hidden/truth.json           SEALED ground truth
    <out>/manifest.json               seed, counts, sha256 of truth.json

Reproduce:
    PYTHONPATH=src python -m policy_engine.benchmark.generator --out data/benchmark --seed 7 --per-family 20
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

from policy_engine.benchmark import reference_sim as ref
from policy_engine.schema import POLICY_DIR, load_policy

GENERATOR_VERSION = "1.0.0"
FAMILIES = (
    "single_event", "independent", "interaction", "redundancy",
    "exception", "policy_ordered", "non_confluent",
)
TARGET_ACTIVITY = "Post Invoice"
CONTEXT_ACTIVITIES = ("Create Purchase Order", "Insert Invoice", "Set Payment Block", "Approve Order")
ACTIVITY = {
    "price": "Override Unit Price", "qty": "Adjust Quantity", "discount": "Apply Discount",
    "tax": "Apply Tax Code", "currency": "Convert Currency",
    "adjustment": "Post Manual Adjustment", "rounding": "Apply Rounding",
}
POLICY_FOR = {
    "policy_ordered": "P-2026-Q3-001",
    "non_confluent": ("P-2026-Q3-002", "P-2026-Q3-003"),
}
DEFAULT_POLICY = "P-2026-Q3-001"
T0 = datetime(2026, 8, 3, 9, 0, tzinfo=timezone.utc)


def _d(x) -> Decimal:
    return Decimal(str(x))


def _money(rng: random.Random, lo: int, hi: int) -> Decimal:
    return Decimal(rng.randint(lo * 100, hi * 100)) / 100


def _rate(rng: random.Random, lo: str, hi: str, places: int = 4) -> Decimal:
    lo_, hi_ = int(_d(lo) * 10**places), int(_d(hi) * 10**places)
    return Decimal(rng.randint(lo_, hi_)) / Decimal(10**places)


@dataclass
class Draft:
    """A case under construction."""

    family: str
    policy_version: str
    base: dict
    events: dict  # id -> {kind, observed, compliant, slot?, exempt?, ts_group}
    loss_spec: dict
    authorized_discounts: dict
    authorized_adjustments: dict
    exceptions: dict


# ---- builders ------------------------------------------------------------------
def _base(rng: random.Random, fx_options=("1", "83.1250", "90.2500")) -> dict:
    return {
        "price": _money(rng, 40, 400),
        "qty": Decimal(rng.randint(5, 60)),
        "tax_rate": rng.choice([_d("0.05"), _d("0.12"), _d("0.18"), _d("0.28")]),
        "fx": _d(rng.choice(fx_options)),
        "dp": 2,
        "mode": "ROUND_HALF_UP",
        "stacking": "multiplicative",
    }


class _Ids:
    def __init__(self) -> None:
        self.n = 0

    def next(self) -> str:
        self.n += 1
        return f"e{self.n}"


def _adjustment(rng, ids, events, auth_adj, d: Decimal, group="batch") -> str:
    eid = ids.next()
    authorized = _money(rng, 5_000, 120_000)
    events[eid] = {"kind": "adjustment", "observed": {"amount": authorized - d},
                   "compliant": {"amount": authorized}, "ts_group": group}
    auth_adj[eid] = authorized
    return eid


def _contexts(rng, ids, events, n: int) -> None:
    for _ in range(n):
        eid = ids.next()
        events[eid] = {"kind": "context", "activity": rng.choice(CONTEXT_ACTIVITIES),
                       "observed": {}, "compliant": {}, "ts_group": "ctx"}


def _chain_event(rng, ids, events, base, kind: str, auth_disc: dict, slot: int = 1) -> str:
    eid = ids.next()
    if kind == "price":
        events[eid] = {"kind": kind, "observed": {"unit_price": (base["price"] * _rate(rng, "0.70", "0.95", 2)).quantize(Decimal("0.01"))},
                       "compliant": {"unit_price": base["price"]}}
    elif kind == "qty":
        cut = max(1, int(base["qty"] * _d("0.3")))
        events[eid] = {"kind": kind, "observed": {"quantity": base["qty"] - rng.randint(1, cut)},
                       "compliant": {"quantity": base["qty"]}}
    elif kind == "discount":
        a = rng.choice([_d("0"), _d("0.03"), _d("0.05")]) if slot == 1 else rng.choice([_d("0"), _d("0.02")])
        extra = _rate(rng, "0.05", "0.15", 2) if slot == 1 else _rate(rng, "0.03", "0.10", 2)
        events[eid] = {"kind": kind, "slot": slot, "observed": {"rate": a + extra}, "compliant": {"rate": a}}
        auth_disc[slot] = a
    elif kind == "tax":
        wrong = rng.random() < 0.5
        obs = base["tax_rate"] - _rate(rng, "0.02", "0.04", 2) if wrong else base["tax_rate"]
        events[eid] = {"kind": kind, "observed": {"rate": obs}, "compliant": {"rate": base["tax_rate"]}}
    elif kind == "currency":
        events[eid] = {"kind": kind, "observed": {"fx_rate": (base["fx"] * _rate(rng, "0.950", "0.995", 3)).quantize(Decimal("0.0001"))},
                       "compliant": {"fx_rate": base["fx"]}}
    elif kind == "rounding":
        events[eid] = {"kind": kind, "observed": {"decimals": rng.choice([0, 1]), "mode": "ROUND_DOWN"},
                       "compliant": {"decimals": base["dp"], "mode": base["mode"]}}
    else:
        raise ValueError(kind)
    events[eid]["ts_group"] = "batch"
    return eid


CHAIN_COMBOS = (
    ("discount", "tax", "rounding"),
    ("price", "discount", "tax"),
    ("discount", "discount2", "tax"),
    ("tax", "currency", "rounding"),
    ("discount", "tax", "currency", "rounding"),
    ("qty", "discount", "tax", "rounding"),
    ("price", "qty", "discount", "tax"),
)


def build_draft(family: str, rng: random.Random) -> Draft:
    base = _base(rng)
    ids, events = _Ids(), {}
    auth_disc: dict = {}
    auth_adj: dict = {}
    exceptions: dict = {}
    loss_spec = {"kind": "shortfall", "tolerance": Decimal(0), "amount": None}
    policy = DEFAULT_POLICY

    if family == "single_event":
        kind = rng.choice(["price", "qty", "discount", "tax", "currency", "adjustment", "rounding"])
        if kind == "adjustment":
            _adjustment(rng, ids, events, auth_adj, _money(rng, 2_000, 90_000))
        else:
            eid = _chain_event(rng, ids, events, base, kind, auth_disc)
            if kind == "tax":  # force a real under-collection
                events[eid]["observed"]["rate"] = base["tax_rate"] - _rate(rng, "0.02", "0.04", 2)
        _contexts(rng, ids, events, rng.randint(2, 4))

    elif family == "independent":
        for _ in range(rng.randint(2, 3)):
            _adjustment(rng, ids, events, auth_adj, _money(rng, 2_000, 90_000))
        _contexts(rng, ids, events, rng.randint(0, 2))

    elif family in ("interaction", "redundancy"):
        n = rng.randint(2, 3) if family == "interaction" else rng.randint(2, 3)
        ds = [_money(rng, 2_000, 90_000) for _ in range(n)]
        for d in ds:
            _adjustment(rng, ids, events, auth_adj, d)
        total, mn = sum(ds), min(ds)
        if family == "interaction":
            tol = (mn * _d("0.5")).quantize(Decimal("0.01"))  # every d_i > tol
        else:
            tol = (total - mn * _rate(rng, "0.10", "0.90", 2)).quantize(Decimal("0.01"))  # total - d_i <= tol for all i
        loss_spec = {"kind": "threshold", "tolerance": tol, "amount": total}
        _contexts(rng, ids, events, rng.randint(0, 2))

    elif family == "exception":
        eid = ids.next()
        a = rng.choice([_d("0.03"), _d("0.05")])
        events[eid] = {"kind": "discount", "slot": 1, "observed": {"rate": a + _rate(rng, "0.05", "0.12", 2)},
                       "compliant": {"rate": a}, "exempt": True, "ts_group": "batch"}
        auth_disc[1] = a
        exceptions[eid] = f"APR-2026-{rng.randint(1, 99999):05d}"
        for _ in range(rng.randint(1, 2)):
            _adjustment(rng, ids, events, auth_adj, _money(rng, 2_000, 90_000))
        _contexts(rng, ids, events, rng.randint(0, 2))

    elif family in ("policy_ordered", "non_confluent"):
        combo = rng.choice(CHAIN_COMBOS)
        for kind in combo:
            if kind == "discount2":
                _chain_event(rng, ids, events, base, "discount", auth_disc, slot=2)
            else:
                _chain_event(rng, ids, events, base, kind, auth_disc, slot=1)
        if rng.random() < 0.4:  # lock the most upstream active event strictly earlier than the batch
            first = min((i for i in events), key=lambda i: ref._RANK[events[i]["kind"]])
            events[first]["ts_group"] = "early"
        _contexts(rng, ids, events, rng.randint(0, 2))
        pol = POLICY_FOR[family]
        policy = pol if isinstance(pol, str) else rng.choice(pol)
    else:
        raise ValueError(family)

    return Draft(family, policy, base, events, loss_spec, auth_disc, auth_adj, exceptions)


# ---- timestamps / structure ---------------------------------------------------
def assign_timestamps(draft: Draft, rng: random.Random) -> dict[str, datetime]:
    """batch group shares ONE timestamp (permutable: the log cannot order a SAP
    batch commit); 'early'/'ctx' events get distinct earlier ones; everything
    touches the invoice, so any pair with different timestamps is structurally
    locked -- exactly the rule in replay_core.constraint_extraction."""
    ts: dict[str, datetime] = {}
    batch = T0 + timedelta(hours=6)
    for i, (eid, e) in enumerate(sorted(draft.events.items())):
        g = e["ts_group"]
        if g == "batch":
            ts[eid] = batch
        elif g == "early":
            ts[eid] = T0 + timedelta(hours=1, minutes=i)
        else:  # ctx: distinct, before the batch
            ts[eid] = T0 + timedelta(hours=2, minutes=7 * (i + 1))
    return ts


def structural_pairs(draft: Draft, ts: dict[str, datetime]) -> list[tuple[str, str]]:
    ids = sorted(draft.events)
    out = []
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            if ts[a] != ts[b]:
                out.append((a, b) if ts[a] < ts[b] else (b, a))
    return out


# ---- OCEL writer ---------------------------------------------------------------------
def _attr_list(d: dict) -> list[dict]:
    return [{"name": k, "value": str(v)} for k, v in d.items()]


def write_ocel(path: Path, draft: Draft, ts: dict[str, datetime], target_ts: datetime, serial: int) -> dict:
    inv, po, acc = f"INV-{serial:05d}", f"PO-{serial:05d}", f"ACC-{serial % 10000:04d}"
    events, types = [], {}
    for eid in sorted(draft.events, key=lambda x: int(x[1:])):
        e = draft.events[eid]
        activity = e.get("activity") or ACTIVITY[e["kind"]]
        attrs = dict(e["observed"])
        if e["kind"] == "discount":
            attrs["slot"] = e["slot"]
        types.setdefault(activity, set()).update(attrs)
        rels = [{"objectId": inv, "qualifier": "posting"}]
        if e["kind"] == "context":
            rels.append({"objectId": po, "qualifier": "order"})
        events.append({"id": eid, "type": activity, "time": ts[eid].isoformat(),
                       "attributes": _attr_list(attrs), "relationships": rels})
    target_id = f"e{len(draft.events) + 1}"
    types.setdefault(TARGET_ACTIVITY, set())
    events.append({"id": target_id, "type": TARGET_ACTIVITY, "time": target_ts.isoformat(), "attributes": [],
                   "relationships": [{"objectId": inv, "qualifier": "posting"}, {"objectId": acc, "qualifier": "ledger"}]})
    doc = {
        "objectTypes": [{"name": n, "attributes": []} for n in ("Invoice", "Order", "Account")],
        "eventTypes": [{"name": a, "attributes": [{"name": k, "type": "string"} for k in sorted(ks)]} for a, ks in sorted(types.items())],
        "objects": [{"id": inv, "type": "Invoice", "attributes": [], "relationships": []},
                    {"id": po, "type": "Order", "attributes": [], "relationships": []},
                    {"id": acc, "type": "Account", "attributes": [], "relationships": []}],
        "events": events,
    }
    path.write_text(json.dumps(doc, indent=1))
    return {"target_event_id": target_id, "invoice_object": inv}


# ---- one case, with verification ----------------------------------------------
def _stringify(x):
    if isinstance(x, dict):
        return {(",".join(k) if isinstance(k, tuple) else str(k)): _stringify(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_stringify(v) for v in x]
    if isinstance(x, Fraction):
        return str((Decimal(x.numerator) / Decimal(x.denominator)).quantize(Decimal("0.000001")))
    if isinstance(x, Decimal):
        return str(x.quantize(Decimal("0.000001")))
    return x


from fractions import Fraction  # noqa: E402  (kept next to its only user)

EXPECT = {
    "single_event": "PASS", "independent": "PASS", "interaction": "PASS", "redundancy": "PASS",
    "exception": "PASS", "policy_ordered": "POLICY_ORDERED", "non_confluent": "BLOCKED",
}


def _verify_draft(draft: Draft, truth: dict) -> bool:
    fam = draft.family
    if truth["classification"] != EXPECT[fam] or truth["realized_loss"] <= 0:
        return False
    n_active = len(truth["active_event_ids"])
    if not (1 <= n_active <= 5 and len(truth["candidate_event_ids"]) <= 8):
        return False
    if len(truth["candidate_event_ids"]) < 3:
        return False
    v, phi = truth["coalition_values"], truth["shapley"]
    act = truth["active_event_ids"]
    L = truth["realized_loss"]
    if fam == "single_event":
        return phi is not None and sum(1 for x in phi.values() if x != 0) == 1
    if fam == "independent":
        return all(v[(i,)] == phi[i] > 0 for i in act)
    if fam == "interaction":
        return all(v[tuple(sorted(s))] == 0 for s in _proper_subsets(act)) and v[tuple(act)] == L
    if fam == "redundancy":
        return all(v[tuple(sorted(s))] == L for s in _proper_subsets(act) if s) and v[tuple(act)] == L
    if fam == "exception":
        ex = next(i for i, e in draft.events.items() if e.get("exempt"))
        return phi is not None and phi[ex] == 0 and any(phi[i] > 0 for i in act if i != ex)
    if fam == "policy_ordered":
        return any(x == "POLICY_ORDERED" for x in truth["subset_verdicts"].values())
    if fam == "non_confluent":
        return phi is None
    return True


def _proper_subsets(act):
    from itertools import combinations
    for r in range(len(act)):
        for s in combinations(act, r):
            yield s


def generate_case(family: str, seed: int, index: int, serial: int, out_public: Path) -> tuple[dict, dict]:
    for attempt in range(400):
        rng = random.Random(f"{seed}/{family}/{index}/{attempt}")
        draft = build_draft(family, rng)
        ts = assign_timestamps(draft, rng)
        pairs = structural_pairs(draft, ts)
        policy = load_policy(draft.policy_version)
        loss_spec = {k: v for k, v in draft.loss_spec.items()}
        truth = ref.compute_truth(draft.base, draft.events, loss_spec, policy.to_dict(), pairs)
        if _verify_draft(draft, truth):
            break
    else:
        raise RuntimeError(f"could not generate a valid '{family}' case (seed={seed}, index={index})")

    case_id = f"RSC-2026-{serial:05d}"
    target_ts = max(ts.values()) + timedelta(hours=1)
    meta = write_ocel(out_public / f"{case_id}.jsonocel", draft, ts, target_ts, serial)

    reference = {
        "contract_price": draft.base["price"], "ordered_quantity": draft.base["qty"],
        "tax_rate": draft.base["tax_rate"], "fx_rate": draft.base["fx"],
        "authorized_discount_rates": draft.authorized_discounts,
        "authorized_adjustments": draft.authorized_adjustments,
        "exceptions": draft.exceptions,
        "loss": {"kind": loss_spec["kind"], "tolerance": loss_spec["tolerance"], "amount": loss_spec["amount"]},
    }
    public = {
        "case_id": case_id, "ocel_file": f"{case_id}.jsonocel", **meta,
        "policy_version": draft.policy_version,
        "realized_loss": truth["realized_loss"],
        "reference": reference,
    }
    hidden = {"case_id": case_id, "family": family, **truth,
              "structural_pairs": pairs, "target_event_id": meta["target_event_id"]}
    return _stringify(public), _stringify(hidden)


def generate_benchmark(out_dir: str | Path, seed: int = 7, per_family: int = 20, families=FAMILIES) -> dict:
    out = Path(out_dir)
    pub, hid = out / "public", out / "hidden"
    pub.mkdir(parents=True, exist_ok=True)
    hid.mkdir(parents=True, exist_ok=True)
    cases, truths, serial = [], [], 1
    for fam in families:
        for i in range(per_family):
            c, t = generate_case(fam, seed, i, serial, pub)
            cases.append(c)
            truths.append(t)
            serial += 1
    (pub / "cases.json").write_text(json.dumps({"cases": cases}, indent=1))
    truth_path = hid / "truth.json"
    truth_path.write_text(json.dumps({"truth": truths}, indent=1, sort_keys=True))
    manifest = {
        "generator_version": GENERATOR_VERSION, "seed": seed, "per_family": per_family,
        "families": list(families), "num_cases": len(cases),
        "policies": sorted(p.stem for p in POLICY_DIR.glob("P-*.json")),
        "hidden_truth_sha256": hashlib.sha256(truth_path.read_bytes()).hexdigest(),
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    return manifest


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Generate the hidden-generative ReplaySemantics benchmark.")
    ap.add_argument("--out", default="data/benchmark")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--per-family", type=int, default=20)
    args = ap.parse_args()
    m = generate_benchmark(args.out, args.seed, args.per_family)
    print(json.dumps(m, indent=2))
