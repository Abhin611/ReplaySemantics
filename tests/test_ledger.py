"""Corrected-ledger analysis (replay_core/ledger.py) against the independent oracle, plus the pair run and the change."""
from decimal import Decimal

import pytest

from policy_engine.benchmark import generator as gen
from policy_engine.benchmark.evaluate import load_truth
from replay_core.benchmark_io import load_benchmark_case, load_benchmark_index, suggested_max_hops
from replay_core.ledger import LedgerError, analyse, run_change, run_pair


@pytest.fixture(scope="module")
def root(tmp_path_factory):
    r = tmp_path_factory.mktemp("ledger")
    gen.generate_matrix_benchmark(r, seed=7)
    return r


@pytest.fixture(scope="module")
def truth(root):
    return load_truth(root)


def _lc(root, cid, hops=None):
    return load_benchmark_case(root, cid, max_hops=hops or suggested_max_hops(load_benchmark_index(root)[cid]))


def _pairs(d):
    return sorted(sorted(p["pair"]) for p in d)


def test_analysis_agrees_with_the_oracle_on_every_case(root, truth):
    for cid, t in truth.items():
        a, lg = analyse(_lc(root, cid)), t["ledger"]
        assert a["resolution_class"] == lg["resolution_class"], cid
        assert a["blocked"] == lg["blocked"], cid
        assert sorted(a["posted_nodes"]) == sorted(lg["posted_nodes"]), cid
        assert _pairs(a["pairs"]) == _pairs(lg["swappable_pairs"]), cid
        assert a["policy_summary"]["counts"] == lg["policy_summary"], cid
        for p in a["pairs"]:
            o = next(x for x in lg["swappable_pairs"] if sorted(x["pair"]) == sorted(p["pair"]))
            assert (p["blocked"], p["authoritative_order"]) == (o["blocked"], o["authoritative_order"]), cid
        for key in ("loss_from_stale_amounts", "loss_from_inputs"):
            assert abs(Decimal(a["totals"][key]) - Decimal(lg[key])) < Decimal("0.00001"), (cid, key)
        assert a["complete"], cid


def test_loss_split_adds_up_and_swap_only_is_all_stale(root, truth):
    for cid, t in truth.items():
        a = analyse(_lc(root, cid))["totals"]
        assert Decimal(a["loss_from_stale_amounts"]) + Decimal(a["loss_from_inputs"]) == Decimal(a["realised_loss"])
        if t["design"]["class"] == "SWAP_ONLY":
            assert Decimal(a["loss_from_inputs"]) == 0 and Decimal(a["loss_from_stale_amounts"]) == Decimal(a["realised_loss"])


def test_nodes_show_corrected_inputs_and_posted_amounts_only_where_posted(root, truth):
    cid = next(c for c, t in truth.items() if t["design"]["class"] == "BOTH" and not t["design"]["blocked"])
    a = analyse(_lc(root, cid))
    for n in a["nodes"]:
        assert ("posted" in n) == (n["role"] == "posted")
        if n["role"] == "context":
            assert not n["inputs"]
    assert any(n["role"] == "input" and n["deviates"] for n in a["nodes"])


def test_description_mentions_real_numbers_and_no_class_names(root, truth):
    for cid, t in truth.items():
        d = analyse(_lc(root, cid))["description"]
        assert not any(w in (d["headline"] + " ".join(d["text"])).lower() for w in ("swap only", "multi-edit only", "swap and edit"))
        assert d["text"] and any(ch.isdigit() for ch in " ".join(d["text"]))
        if t["design"]["blocked"]:
            assert "cannot order" in d["headline"] and any("cannot order" in x or "cannot be ordered" in x for x in d["text"])


def test_pair_run_both_orders_and_authority(root, truth):
    cid = next(c for c, t in truth.items() if t["design"]["class"] == "SWAP_ONLY" and not t["design"]["blocked"])
    lc = _lc(root, cid)
    a = analyse(lc)
    p = a["pairs"][0]
    r = run_pair(lc, *p["pair"])
    assert len(r["orders"]) == 2 and sum(o["authoritative"] for o in r["orders"]) == 1
    auth = next(o for o in r["orders"] if o["authoritative"])
    assert auth["order"] == p["authoritative_order"]
    assert Decimal(auth["final_net"]) == Decimal(next(o for o in p["orders"] if o["order"] == auth["order"])["net"])
    assert all(len(o["steps"]) == 2 and o["steps"][0]["dependents"] for o in r["orders"])


def test_blocked_pair_has_no_authoritative_order(root, truth):
    cid = next(c for c, t in truth.items() if t["design"]["class"] == "SWAP_ONLY" and t["design"]["blocked"])
    lc = _lc(root, cid)
    p = next(x for x in analyse(lc)["pairs"] if x["blocked"])
    r = run_pair(lc, *p["pair"])
    assert r["blocked"] and r["authoritative_order"] is None and not any(o["authoritative"] for o in r["orders"])
    assert all(o["exploratory"] for o in r["orders"])


def test_pair_run_rejects_locked_and_unknown_pairs(root, truth):
    cid = next(c for c, t in truth.items() if t["design"]["class"] == "MULTI_EDIT_ONLY" and len(t["ledger"]["posted_nodes"]) >= 2)
    lc = _lc(root, cid)
    a = analyse(lc)
    assert a["locked_pairs"]
    with pytest.raises(LedgerError, match="fixes their order"):
        run_pair(lc, *a["locked_pairs"][0])
    with pytest.raises(LedgerError):
        run_pair(lc, "e1", "e1")


def test_change_swap_edit_sequences_and_agreement(root, truth):
    seen = set()
    for cid, t in truth.items():
        if t["design"]["class"] != "BOTH" or t["design"]["blocked"]:
            continue
        lc = _lc(root, cid)
        a = analyse(lc)
        # editing every value to its authorised figure is what moves the case to the compliant total: a swap alone cannot
        edits = {n["node_id"]: n["inputs"] for n in a["nodes"] if n["inputs"] and not n["exempt"]}
        r = run_change(lc, edits, a["swap_default"], "both")
        assert [x["sequence"] for x in r["runs"]] == ["swap_first", "edit_first"]
        assert r["sequences_agree"] == (len({x["final_net"] for x in r["runs"]}) == 1)
        seen.add(r["sequences_agree"])
        # the swap runs in the policy order, so it agrees with the cascade's own order and keeps the edited values
        assert any(x["matches_compliant_total"] for x in r["runs"]), cid
    assert seen  # at least one case exercised


def test_change_validation(root, truth):
    cid = next(c for c, t in truth.items() if t["design"]["class"] == "BOTH" and not t["design"]["blocked"])
    lc = _lc(root, cid)
    with pytest.raises(LedgerError, match="nothing to run"):
        run_change(lc, {}, [])
    with pytest.raises(LedgerError, match="not a posted"):
        run_change(lc, {}, ["e999"])
    a = analyse(lc)
    with pytest.raises(LedgerError):
        run_change(lc, {a["input_nodes"][0]: {"nonsense": "1"}}, [])
    with pytest.raises(LedgerError, match="sequence"):
        run_change(lc, {a["input_nodes"][0]: {}}, [a["posted_nodes"][0]], "sideways")
