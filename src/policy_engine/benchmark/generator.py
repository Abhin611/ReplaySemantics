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

Reproduce (benchmark v2, the default: 54 cases laid out by resolution class x hops, see MATRIX_SPECS):
    PYTHONPATH=src python -m policy_engine.benchmark.generator --out data/benchmark --seed 7
Legacy v1 design (7 families x N cases, optional 5 multi-hop cases):
    PYTHONPATH=src python -m policy_engine.benchmark.generator --legacy --out data/benchmark_v1 --seed 7 --per-family 20 --multihop
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

GENERATOR_VERSION = "2.0.0"
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
        if "hop" in e:  # multi-hop case: events reach the invoice through linked documents
            rels = _multihop_relationships(draft, eid, inv, serial)
        else:
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
        "objectTypes": [{"name": n, "attributes": []} for n in (("Invoice", "Order", "Account", "Document") if _parents(draft) else ("Invoice", "Order", "Account"))],
        "eventTypes": [{"name": a, "attributes": [{"name": k, "type": "string"} for k in sorted(ks)]} for a, ks in sorted(types.items())],
        "objects": [{"id": inv, "type": "Invoice", "attributes": [], "relationships": []},
                    {"id": po, "type": "Order", "attributes": [], "relationships": []},
                    {"id": acc, "type": "Account", "attributes": [], "relationships": []},
                    *[{"id": _link_id(serial, p), "type": "Document", "attributes": [], "relationships": []}
                      for p in sorted(_parents(draft))]],
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


def _verify_draft(draft: Draft, truth: dict, caps: bool = True) -> bool:
    """caps=True is the legacy benchmark (<=5 active, <=8 candidates). The matrix benchmark passes caps=False:
    it has no fixed event limit, only the oracle's own soft cap on ACTIVE nodes."""
    fam = draft.family
    if truth["classification"] != EXPECT[fam] or truth["realized_loss"] <= 0:
        return False
    if caps:
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


# ---- multi-hop cases (appended after the 140 standard cases; opt in with multihop=True) ------------------
# The 140 standard cases put every correction event directly on the target's invoice, so the backward
# traversal never needs more than 1 hop. These cases chain events through linked documents (an event
# touches only its parent's document), so the deep events are reachable ONLY by following the chain.
EXTRACTION_DEFAULT_MAX_HOPS = 3  # mirrors replay_core.candidate_extraction.DEFAULT_MAX_HOPS (kept independent)


@dataclass(frozen=True)
class MultihopSpec:
    name: str        # family label stored in the sealed truth
    expect_as: str   # verification rule reused from the standard families
    policy: str
    tree: tuple      # ((key, kind, parent_key or None), ...), parents listed before children
    hops: int        # deepest hop in the tree


MULTIHOP_SPECS = (
    # Deep events are carried by CONTEXT events (they move no money) so that order-sensitive pairs can sit at
    # depth: two events that hang off different branches share no object, so the log cannot order them.
    # 141 (2 hops): discount on the invoice, tax one hop back; order-sensitive pairs (discount, tax), (tax, rounding)
    MultihopSpec("multihop_policy_ordered", "policy_ordered", "P-2026-Q3-001", (
        ("D", "discount", None), ("R", "rounding", None), ("K1", "context", None), ("T", "tax", "K1")), 2),
    # 142 (2 hops): additive adjustments (no order effect); the third adjustment is one hop back
    MultihopSpec("multihop_interaction", "interaction", "P-2026-Q3-001", (
        ("A1", "adjustment", None), ("A2", "adjustment", None), ("A3", "adjustment", "A1")), 2),
    # 143 (3 hops): rounding <- tax <- discount chain; price hangs on a context branch 3 hops back
    MultihopSpec("multihop_policy_ordered", "policy_ordered", "P-2026-Q3-001", (
        ("R", "rounding", None), ("C", "currency", None), ("K1", "context", None), ("T", "tax", "R"),
        ("K2", "context", "K1"), ("D", "discount", "T"), ("P", "price", "K2")), 3),
    # 144 (3 hops): redundant adjustments chained over 3 levels
    MultihopSpec("multihop_redundancy", "redundancy", "P-2026-Q3-001", (
        ("A1", "adjustment", None), ("A2", "adjustment", "A1"), ("A3", "adjustment", "A1"), ("A4", "adjustment", "A2")), 3),
    # 145 (4 hops): rounding <- tax <- discount chain; price 4 hops back on a context branch; no policy order -> BLOCKED
    MultihopSpec("multihop_non_confluent", "non_confluent", "P-2026-Q3-003", (
        ("R", "rounding", None), ("C", "currency", None), ("K1", "context", None), ("T", "tax", "R"),
        ("K2", "context", "K1"), ("D", "discount", "T"), ("K3", "context", "K2"), ("P", "price", "K3")), 4),
)


def _link_id(serial: int, eid: str) -> str:
    return f"DOC-{serial:05d}-{eid}"


def _parents(draft: Draft) -> set:
    return {e["parent"] for e in draft.events.values() if e.get("parent")}


def _multihop_relationships(draft: Draft, eid: str, inv: str, serial: int) -> list:
    e = draft.events[eid]
    rels = [{"objectId": inv, "qualifier": "posting"}] if e["hop"] == 1 else \
        [{"objectId": _link_id(serial, e["parent"]), "qualifier": "linked_document"}]
    if eid in _parents(draft):
        rels.append({"objectId": _link_id(serial, eid), "qualifier": "linked_document"})
    return rels


def build_multihop_draft(spec: MultihopSpec, rng: random.Random) -> Draft:
    base = _base(rng)
    ids, events, auth_disc, auth_adj = _Ids(), {}, {}, {}
    adj_keys = [k for k, kind, _ in spec.tree if kind == "adjustment"]
    ds = {k: _money(rng, 2_000, 90_000) for k in adj_keys}
    key2id: dict = {}
    for key, kind, parent in spec.tree:
        if kind == "adjustment":
            eid = _adjustment(rng, ids, events, auth_adj, ds[key])
        elif kind == "context":
            eid = ids.next()
            events[eid] = {"kind": "context", "activity": rng.choice(CONTEXT_ACTIVITIES),
                           "observed": {}, "compliant": {}, "ts_group": "ctx"}
        else:
            eid = _chain_event(rng, ids, events, base, kind, auth_disc, slot=1)
        key2id[key] = eid
        events[eid]["parent"] = key2id[parent] if parent else None
        events[eid]["hop"] = 1 if parent is None else events[key2id[parent]]["hop"] + 1
    loss_spec = {"kind": "shortfall", "tolerance": Decimal(0), "amount": None}
    if adj_keys:  # same threshold construction as the standard interaction / redundancy families
        total, mn = sum(ds.values()), min(ds.values())
        if spec.expect_as == "interaction":
            tol = (mn * _d("0.5")).quantize(Decimal("0.01"))
        else:
            tol = (total - mn * _rate(rng, "0.10", "0.90", 2)).quantize(Decimal("0.01"))
        loss_spec = {"kind": "threshold", "tolerance": tol, "amount": total}
    return Draft(spec.expect_as, spec.policy, base, events, loss_spec, auth_disc, auth_adj, {})


def multihop_timestamps(draft: Draft) -> dict:
    """Deeper events happened earlier (a deeper document exists before the one built on it); events at the
    same depth share one timestamp (a batch the log cannot order)."""
    batch = T0 + timedelta(hours=6)
    return {eid: batch - timedelta(hours=e["hop"] - 1) for eid, e in draft.events.items()}


def multihop_structural_pairs(draft: Draft, ts: dict) -> list:
    """Same rule as replay_core.constraint_extraction: a pair is order-locked only if the two events share an
    object AND have different timestamps (earlier first); otherwise it is permutable."""
    parents = _parents(draft)

    def objs(eid):
        e = draft.events[eid]
        s = {"INV"} if e["hop"] == 1 else {"L:" + e["parent"]}
        if eid in parents:
            s.add("L:" + eid)
        return s

    ids = sorted(draft.events)
    out = []
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            if objs(a) & objs(b) and ts[a] != ts[b]:
                out.append((a, b) if ts[a] < ts[b] else (b, a))
    return out


def generate_multihop_case(spec: MultihopSpec, seed: int, index: int, serial: int, out_public: Path) -> tuple:
    for attempt in range(400):
        rng = random.Random(f"{seed}/{spec.name}/{spec.hops}/{index}/{attempt}")
        draft = build_multihop_draft(spec, rng)
        ts = multihop_timestamps(draft)
        pairs = multihop_structural_pairs(draft, ts)
        policy = load_policy(draft.policy_version)
        loss_spec = dict(draft.loss_spec)
        truth = ref.compute_truth(draft.base, draft.events, loss_spec, policy.to_dict(), pairs)
        deepest_active = all(e["hop"] < spec.hops or e["kind"] in ref.ACTIVE_KINDS for e in draft.events.values())
        if _verify_draft(draft, truth) and deepest_active:
            break
    else:
        raise RuntimeError(f"could not generate a valid '{spec.name}' case ({spec.hops} hops, seed={seed}, index={index})")

    case_id = f"RSC-2026-{serial:05d}"
    target_ts = max(ts.values()) + timedelta(hours=1)
    meta = write_ocel(out_public / f"{case_id}.jsonocel", draft, ts, target_ts, serial)
    reference = {
        "contract_price": draft.base["price"], "ordered_quantity": draft.base["qty"],
        "tax_rate": draft.base["tax_rate"], "fx_rate": draft.base["fx"],
        "authorized_discount_rates": draft.authorized_discounts,
        "authorized_adjustments": draft.authorized_adjustments, "exceptions": draft.exceptions,
        "loss": {"kind": loss_spec["kind"], "tolerance": loss_spec["tolerance"], "amount": loss_spec["amount"]},
    }
    public = {"case_id": case_id, "ocel_file": f"{case_id}.jsonocel", **meta,
              "policy_version": draft.policy_version, "realized_loss": truth["realized_loss"], "reference": reference}
    if spec.hops > EXTRACTION_DEFAULT_MAX_HOPS:  # extraction setting, not truth: the default depth cannot reach it
        public["max_hops"] = spec.hops
    hidden = {"case_id": case_id, "family": spec.name, "required_hops": spec.hops, **truth,
              "structural_pairs": pairs, "target_event_id": meta["target_event_id"]}
    return _stringify(public), _stringify(hidden)


def generate_benchmark(out_dir: str | Path, seed: int = 7, per_family: int = 20, families=FAMILIES,
                       multihop: bool = False) -> dict:
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
    if multihop:  # appended AFTER the standard cases, so cases 1..140 are unchanged
        for i, spec in enumerate(MULTIHOP_SPECS):
            c, t = generate_multihop_case(spec, seed, i, serial, pub)
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
        **({"multihop_cases": len(MULTIHOP_SPECS)} if multihop else {}),
        "hidden_truth_sha256": hashlib.sha256(truth_path.read_bytes().replace(b"\r\n", b"\n")).hexdigest(),
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    return manifest


# =====================================================================================================
# Benchmark v2: matrix-driven generation (resolution class x hops x policy)
# =====================================================================================================
# Every case is described by a MatrixSpec; the generator keeps drawing until the independent oracle
# (reference_sim.ledger_truth) confirms the case really has the requested class, depth and BLOCKED status.
# There is no fixed candidate limit: depth comes from chains of CONTEXT events (they move no money), so the
# graph grows deep, not wide. The default traversal (max_hops=3) therefore does NOT see 4- and 5-hop events:
# the replay report marks such a run PARTIAL and says what to raise.
P1, P2, P3 = "P-2026-Q3-001", "P-2026-Q3-002", "P-2026-Q3-003"
CLASSES = ("DIRECT_FIX", "SWAP_ONLY", "MULTI_EDIT_ONLY", "BOTH")


@dataclass(frozen=True)
class MatrixSpec:
    cls: str          # resolution class the oracle must confirm
    family: str       # descriptive label stored in the sealed truth
    hops: int         # depth of the deepest correctable event
    policy: str
    blocked: bool = False
    variant: str = ""  # template selector (see _matrix_tree)


def _swap_specs() -> list:
    out = []
    for hops, rows in ((2, [("DT", P1, 0), ("DTR", P1, 0), ("DD2T", P1, 0), ("TR", P3, 1)]),
                       (3, [("DTR", P1, 0), ("TR", P1, 0), ("DTR", P2, 1)]),
                       (4, [("DT", P1, 0), ("DTR", P2, 1)]),
                       (5, [("DTR", P1, 0)])):
        out += [MatrixSpec("SWAP_ONLY", "swap_only", hops, pol, bool(b), v) for v, pol, b in rows]
    return out


def _both_specs() -> list:
    out, k = [], 0
    cyc = ["DTR", "DT", "TR", "DD2T", "DTR", "DT", "DTR", "TR", "DT", "DTR", "DD2T"]
    inp = ["price", "qty", "currency"]
    plan = {2: [(P1, 0)] * 9 + [(P2, 1), (P3, 1)], 3: [(P1, 0)] * 10 + [(P2, 1), (P3, 1)],
            4: [(P1, 0), (P3, 1)], 5: [(P2, 1)]}
    for hops, rows in plan.items():
        for pol, b in rows:
            v = cyc[k % len(cyc)]
            if b and pol == P2 and "R" not in v:
                v = "DTR"  # policy 002 only fails on pairs that involve rounding
            out.append(MatrixSpec("BOTH", "both", hops, pol, bool(b), f"{v}+{inp[k % 3]}"))
            k += 1
    return out


def _multi_specs() -> list:
    rows = [(2, "single"), (2, "independent"), (2, "interaction"), (2, "redundancy"), (2, "locked"),
            (3, "independent"), (3, "interaction"), (3, "redundancy"), (3, "exception"), (3, "exception"),
            (3, "locked"), (4, "locked"), (4, "redundancy"), (5, "locked")]
    return [MatrixSpec("MULTI_EDIT_ONLY", v, h, P1, False, v) for h, v in rows]


def _direct_specs() -> list:
    return [MatrixSpec("DIRECT_FIX", "direct_fix", 1, P1, False, v) for v in ("discount", "tax", "rounding", "discount")]


def matrix_specs() -> list:
    specs = _direct_specs() + _swap_specs() + _multi_specs() + _both_specs()
    return sorted(specs, key=lambda s: (s.hops, CLASSES.index(s.cls)))  # stable: ids run 1-hop ... 5-hop


MATRIX_SPECS = tuple(matrix_specs())
MATRIX_QUOTAS = {  # the minimums the user asked for; generation FAILS if any is missed
    "cases": 54, "swap_only_min": 7, "multi_edit_only_min": 10, "both_min": 15,
    "direct_fix": 4, "blocked": 9, "hops": {1: 4, 2: 20, 3: 21, 4: 6, 5: 3},
}
_KIND_OF = {"D": "discount", "D2": "discount2", "T": "tax", "R": "rounding"}


def _posted_kinds(code: str) -> list:
    return {"DT": ["discount", "tax"], "DTR": ["discount", "tax", "rounding"], "TR": ["tax", "rounding"],
            "DD2T": ["discount", "discount2", "tax"]}[code]


def _matrix_tree(spec: MatrixSpec, rng: random.Random) -> tuple:
    """-> (tree, adj_mode, exempt_keys). tree = ((key, kind, parent_key), ...), parents first."""
    h, tree, adj_mode = spec.hops, [], None

    def chain(n):  # K1..Kn chained; returns last key or None
        prev = None
        for i in range(1, n + 1):
            tree.append((f"K{i}", "context", prev))
            prev = f"K{i}"
        return prev

    def at_depth(d):  # parent key for an event at hop d (needs the chain K1..K_{h-1})
        return None if d <= 1 else f"K{d - 1}"

    cls = spec.cls
    if cls == "DIRECT_FIX":
        tree += [("K1", "context", None), ("K2", "context", None), ("X", spec.variant, None)]
    elif cls in ("SWAP_ONLY", "BOTH"):
        code, _, inp = spec.variant.partition("+")
        if h == 1:
            tree += [("K1", "context", None), ("K2", "context", None)]
        else:
            chain(h - 1)
        for j, kind in enumerate(_posted_kinds(code)):
            tree.append((f"P{j}", kind, at_depth(h)))
        if cls == "BOTH":
            d_in = rng.randint(1, h)
            tree.append(("IN", inp, at_depth(d_in)))
    else:  # MULTI_EDIT_ONLY
        v = spec.variant
        if v == "locked":
            if h == 2:
                tree += [("K1", "context", None), ("R", "rounding", None), ("T", "tax", "R"), ("PR", "price", "K1")]
            else:  # R(1) <- T(2) <- D(3) locked chain, price hangs on its own context branch h hops deep
                tree += [("R", "rounding", None), ("T", "tax", "R"), ("D", "discount", "T")]
                prev = None
                for i in range(1, h):
                    tree.append((f"K{i}", "context", prev))
                    prev = f"K{i}"
                tree.append(("PR", rng.choice(["price", "qty"]), prev))
        else:
            chain(h - 1) if h > 1 else tree.extend([("K1", "context", None), ("K2", "context", None)])
            n_adj = {"single": 1, "independent": rng.randint(2, 3), "interaction": rng.randint(2, 3),
                     "redundancy": rng.randint(2, 3), "exception": rng.randint(1, 2)}[v]
            if v in ("interaction", "redundancy"):
                adj_mode = v
            if v == "single":
                tree.append(("A0", rng.choice(["price", "qty", "currency", "adjustment"]), at_depth(h)))
            else:
                tree.append(("A0", "adjustment", at_depth(h)))
                for j in range(1, n_adj):
                    tree.append((f"A{j}", "adjustment", at_depth(rng.randint(1, h))))
            if v == "exception":
                tree.append(("EX", "exempt_discount", at_depth(rng.randint(1, h))))
    return tuple(tree), adj_mode


def build_matrix_draft(spec: MatrixSpec, rng: random.Random) -> Draft:
    tree, adj_mode = _matrix_tree(spec, rng)
    base = _base(rng)
    ids, events, auth_disc, auth_adj, exceptions = _Ids(), {}, {}, {}, {}
    adj_keys = [k for k, kind, _ in tree if kind == "adjustment"]
    ds = {k: _money(rng, 2_000, 90_000) for k in adj_keys}
    key2id: dict = {}
    for key, kind, parent in tree:
        if kind == "adjustment":
            eid = _adjustment(rng, ids, events, auth_adj, ds[key])
        elif kind == "context":
            eid = ids.next()
            events[eid] = {"kind": "context", "activity": rng.choice(CONTEXT_ACTIVITIES),
                           "observed": {}, "compliant": {}, "ts_group": "ctx"}
        elif kind == "exempt_discount":
            eid = ids.next()
            a = rng.choice([_d("0.03"), _d("0.05")])
            events[eid] = {"kind": "discount", "slot": 1, "observed": {"rate": a + _rate(rng, "0.05", "0.12", 2)},
                           "compliant": {"rate": a}, "exempt": True, "ts_group": "batch"}
            auth_disc[1] = a
            exceptions[eid] = f"APR-2026-{rng.randint(1, 99999):05d}"
        elif kind == "discount2":
            eid = _chain_event(rng, ids, events, base, "discount", auth_disc, slot=2)
        else:
            eid = _chain_event(rng, ids, events, base, kind, auth_disc, slot=1)
        key2id[key] = eid
        events[eid]["parent"] = key2id[parent] if parent else None
        events[eid]["hop"] = 1 if parent is None else events[key2id[parent]]["hop"] + 1
    loss_spec = {"kind": "shortfall", "tolerance": Decimal(0), "amount": None}
    if adj_mode:
        total, mn = sum(ds.values()), min(ds.values())
        tol = (mn * _d("0.5")).quantize(Decimal("0.01")) if adj_mode == "interaction" else \
            (total - mn * _rate(rng, "0.10", "0.90", 2)).quantize(Decimal("0.01"))
        loss_spec = {"kind": "threshold", "tolerance": tol, "amount": total}
    fam = {"single": "single_event", "independent": "independent", "interaction": "interaction",
           "redundancy": "redundancy", "exception": "exception"}.get(spec.variant, spec.family)
    return Draft(fam, spec.policy, base, events, loss_spec, auth_disc, auth_adj, exceptions)


_DEMO_FAMILIES = ("single_event", "independent", "interaction", "redundancy", "exception")


def _verify_matrix(spec: MatrixSpec, draft: Draft, truth: dict, lt: dict) -> bool:
    if truth["realized_loss"] <= 0 or lt["resolution_class"] != spec.cls or lt["blocked"] != spec.blocked:
        return False
    deepest = max(e["hop"] for e in draft.events.values() if e["kind"] in ref.ACTIVE_KINDS)
    if deepest != spec.hops:
        return False
    if spec.blocked != (truth["classification"] == "BLOCKED"):
        return False
    stale, inputs = lt["loss_from_stale_amounts"], lt["loss_from_inputs"]
    if spec.cls == "SWAP_ONLY":
        return inputs == 0 and stale > 0
    if spec.cls == "BOTH":
        return inputs > 0 and stale > 0
    if spec.cls == "DIRECT_FIX":
        return inputs == 0 and stale > 0 and len(lt["posted_nodes"]) == 1
    if draft.family in _DEMO_FAMILIES and not _verify_draft(draft, truth, caps=False):
        return False
    return inputs > 0  # MULTI_EDIT_ONLY: the loss comes from inputs, no order choice


def generate_matrix_case(spec: MatrixSpec, seed: int, index: int, serial: int, out_public: Path) -> tuple:
    for attempt in range(600):
        rng = random.Random(f"{seed}/matrix/{index}/{attempt}")
        try:
            draft = build_matrix_draft(spec, rng)
            ts = multihop_timestamps(draft)
            pairs = multihop_structural_pairs(draft, ts)
            policy = load_policy(draft.policy_version).to_dict()
            truth = ref.compute_truth(draft.base, draft.events, dict(draft.loss_spec), policy, pairs)
            lt = ref.ledger_truth(draft.base, draft.events, dict(draft.loss_spec), policy, pairs)
        except (ref.OracleTooLarge, AssertionError):
            continue
        if _verify_matrix(spec, draft, truth, lt):
            break
    else:
        raise RuntimeError(f"could not generate {spec} (seed={seed}, index={index})")
    case_id = f"RSC-2026-{serial:05d}"
    target_ts = max(ts.values()) + timedelta(hours=1)
    meta = write_ocel(out_public / f"{case_id}.jsonocel", draft, ts, target_ts, serial)
    reference = {
        "contract_price": draft.base["price"], "ordered_quantity": draft.base["qty"],
        "tax_rate": draft.base["tax_rate"], "fx_rate": draft.base["fx"],
        "authorized_discount_rates": draft.authorized_discounts,
        "authorized_adjustments": draft.authorized_adjustments, "exceptions": draft.exceptions,
        "loss": {"kind": draft.loss_spec["kind"], "tolerance": draft.loss_spec["tolerance"],
                 "amount": draft.loss_spec["amount"]},
    }
    public = {"case_id": case_id, "ocel_file": f"{case_id}.jsonocel", **meta,
              "policy_version": draft.policy_version, "realized_loss": truth["realized_loss"], "reference": reference,
              # a SUGGESTION read off the public log (deepest correctable event); never applied silently
              "suggested_max_hops": spec.hops}
    hidden = {"case_id": case_id, "family": f"{spec.cls.lower()}/{draft.family}", **truth,
              "structural_pairs": pairs, "target_event_id": meta["target_event_id"],
              "required_hops": spec.hops, "design": {"class": spec.cls, "hops": spec.hops,
                                                     "policy": spec.policy, "blocked": spec.blocked},
              "ledger": lt}
    return _stringify(public), _stringify(hidden)


def generate_matrix_benchmark(out_dir, seed: int = 7) -> dict:
    out = Path(out_dir)
    pub, hid = out / "public", out / "hidden"
    for d in (pub, hid):
        d.mkdir(parents=True, exist_ok=True)
        for f in d.glob("*"):  # never leave files of an older generation behind
            f.unlink()
    cases, truths = [], []
    for i, spec in enumerate(MATRIX_SPECS):
        c, t = generate_matrix_case(spec, seed, i, i + 1, pub)
        cases.append(c)
        truths.append(t)
    quotas = check_quotas(truths)
    (pub / "cases.json").write_text(json.dumps({"cases": cases}, indent=1))
    truth_path = hid / "truth.json"
    truth_path.write_text(json.dumps({"truth": truths}, indent=1, sort_keys=True), newline="\n")
    manifest = {
        "generator_version": GENERATOR_VERSION, "design": "matrix", "seed": seed, "num_cases": len(cases),
        "policies": sorted(p.stem for p in POLICY_DIR.glob("P-*.json")), "quotas": quotas,
        "hidden_truth_sha256": hashlib.sha256(truth_path.read_bytes().replace(b"\r\n", b"\n")).hexdigest(),
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2), newline="\n")
    return manifest


def check_quotas(truths: list) -> dict:
    """Count the delivered cases and FAIL if any quota is missed."""
    cls = {c: sum(1 for t in truths if t["design"]["class"] == c) for c in CLASSES}
    hops = {h: sum(1 for t in truths if t["design"]["hops"] == h) for h in range(1, 6)}
    pol = {p: sum(1 for t in truths if t["design"]["policy"] == p) for p in (P1, P2, P3)}
    blocked = sum(1 for t in truths if t["design"]["blocked"])
    q = MATRIX_QUOTAS
    problems = []
    if len(truths) < q["cases"]:
        problems.append(f"{len(truths)} cases < {q['cases']}")
    for c, key in (("SWAP_ONLY", "swap_only_min"), ("MULTI_EDIT_ONLY", "multi_edit_only_min"), ("BOTH", "both_min")):
        if cls[c] < q[key]:
            problems.append(f"{c}: {cls[c]} < {q[key]}")
    if cls["DIRECT_FIX"] < q["direct_fix"]:
        problems.append(f"DIRECT_FIX: {cls['DIRECT_FIX']} < {q['direct_fix']}")
    if blocked < q["blocked"]:
        problems.append(f"blocked: {blocked} < {q['blocked']}")
    for h, n in q["hops"].items():
        if hops[h] < n:
            problems.append(f"{h}-hop: {hops[h]} < {n}")
    if problems:
        raise RuntimeError("benchmark quotas missed: " + "; ".join(problems))
    return {"by_class": cls, "by_hops": hops, "by_policy": pol, "blocked": blocked}


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Generate the hidden-generative ReplaySemantics benchmark.")
    ap.add_argument("--out", default="data/benchmark")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--legacy", action="store_true", help="the v1 design (7 families x --per-family cases)")
    ap.add_argument("--per-family", type=int, default=20, help="legacy only")
    ap.add_argument("--multihop", action="store_true", help="legacy only: append 5 multi-hop cases")
    args = ap.parse_args()
    if args.legacy:
        m = generate_benchmark(args.out, args.seed, args.per_family, multihop=args.multihop)
    else:
        m = generate_matrix_benchmark(args.out, args.seed)
    print(json.dumps(m, indent=2))
