"""API: benchmark case list / state / multi-node edit (Member 1, Month 3)."""
import json
from pathlib import Path

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")
pytest.importorskip("pm4py")

from fastapi.testclient import TestClient  # noqa: E402

from api import app as api_module  # noqa: E402

VBFA = Path(__file__).parent.parent / "data" / "raw" / "vbfa_o2c_2019_2021_eur.jsonocel"


@pytest.fixture()
def client(bench_root, monkeypatch):
    monkeypatch.setattr(api_module, "BENCHMARK_DIR", bench_root)
    api_module._load_benchmark_case_cached.cache_clear()
    api_module._checked_case_cached.cache_clear()
    return TestClient(api_module.app)


def first_case(client):
    return client.get("/api/benchmark/cases").json()["cases"][0]["case_id"]


def test_benchmark_list_is_public_data_only_and_labelled_synthetic(client):
    r = client.get("/api/benchmark/cases")
    assert r.status_code == 200 and r.json()["source"] == "benchmark (synthetic)"
    assert len(r.json()["cases"]) == 28
    blob = r.text
    for forbidden in ("family", "classification", "shapley", "coalition_values", "subset_verdicts", "compliant_net"):
        assert forbidden not in blob


def test_state_endpoint_describes_nodes_and_editable_fields(client):
    cid = first_case(client)
    d = client.get(f"/api/cases/{cid}/state").json()
    assert d["case_id"] == cid and d["source"] == "benchmark (synthetic)"
    types = {n["node_type"] for n in d["nodes"]}
    assert "net" in types
    assert all(n["editable_fields"] for n in d["nodes"] if n["node_type"] not in ("net", "context"))
    assert all(n["editable_fields"] == [] for n in d["nodes"] if n["node_type"] in ("net", "context"))
    assert float(d["realized_loss"]) >= 0 and d["observed_net"] != d["compliant_net"]


def test_edit_endpoint_runs_one_cascade_for_several_nodes(client):
    from replay_core.benchmark_io import load_benchmark_case
    from replay_core.propagation import propagate_multi, EDITABLE_FIELDS
    # pick a case with at least two editable, non-rounding nodes
    for c in client.get("/api/benchmark/cases").json()["cases"]:
        nodes = [n for n in client.get(f"/api/cases/{c['case_id']}/state").json()["nodes"]
                 if n["editable_fields"] and n["editable_fields"] != ["decimals", "mode"]]
        if len(nodes) >= 2:
            break
    body = {"edits": {n["node_id"]: {n["editable_fields"][0]: "1.5"} for n in nodes[:2]}}
    r = client.post(f"/api/cases/{c['case_id']}/edit", json=body)
    assert r.status_code == 200, r.text
    d = r.json()
    expected = propagate_multi(load_benchmark_case(api_module.BENCHMARK_DIR, c["case_id"]).model, body["edits"])
    assert d["net_after"] == str(expected.net_after) and d["recomputed"] == list(expected.recomputed)
    assert set(d["edited"]) == set(body["edits"]) and d["source"] == "benchmark (synthetic)"
    json.dumps(d)


def test_edit_endpoint_rejects_bad_edits_with_422(client):
    cid = first_case(client)
    nodes = client.get(f"/api/cases/{cid}/state").json()["nodes"]
    tgt = next(n for n in nodes if n["node_type"] == "net")["node_id"]
    r = client.post(f"/api/cases/{cid}/edit", json={"edits": {tgt: {"net": "1"}}})
    assert r.status_code == 422 and "no editable fields" in r.json()["detail"]
    r = client.post(f"/api/cases/{cid}/edit", json={"edits": {"nope": {"rate": "1"}}})
    assert r.status_code == 422
    assert client.post(f"/api/cases/{cid}/edit", json={}).status_code == 422  # missing body field


def test_unknown_case_is_404(client):
    assert client.post("/api/cases/RSC-9999/edit", json={"edits": {}}).status_code == 404
    assert client.get("/api/cases/RSC-9999/state").status_code == 404


@pytest.mark.skipif(not VBFA.exists(), reason="VBFA log not in this checkout")
def test_real_vbfa_case_gets_a_clear_422_not_a_vacuous_result(client):
    r = client.post("/api/cases/e977/edit", json={"edits": {"e1": {"rate": "0.1"}}})
    assert r.status_code == 422 and "VBFA" in r.json()["detail"] and "benchmark" in r.json()["detail"]


def test_missing_benchmark_dir_explains_how_to_generate_it(tmp_path, monkeypatch):
    monkeypatch.setattr(api_module, "BENCHMARK_DIR", tmp_path / "nope")
    r = TestClient(api_module.app).get("/api/benchmark/cases")
    assert r.status_code == 404 and "policy_engine.benchmark.generator" in r.json()["detail"]


# ------------------------------------------------------------------ stages 3-5 (confluence checker)
@pytest.fixture()
def truth(bench_root):
    from policy_engine.benchmark import evaluate
    return evaluate.load_truth(bench_root)


def test_every_benchmark_case_runs_all_five_stages_and_matches_the_truth(client, truth):
    for cid, t in truth.items():
        r = client.get(f"/api/cases/{cid}/replay")
        assert r.status_code == 200, (cid, r.text)
        d = r.json()
        assert d["source"] == "benchmark (synthetic)" and d["case_id"] == cid
        for k in ("stage_1_extraction", "stage_2_candidate_identification", "stage_2b_constraint_extraction",
                  "stage_3_confluence_checks", "stage_4_policy_resolution", "stage_5_verdict"):
            assert d[k]["status"] == "complete", (cid, k)
        v = d["stage_5_verdict"]
        assert v["classification"] == t["classification"], cid
        assert v["attribution_allowed"] == (t["shapley"] is not None)
        for key, tv in t["coalition_values"].items():
            assert (v["coalition_values"][key] is None) == (tv is None), (cid, key)
        assert d["replay_graph"]["nodes"] and v["message"]


def test_blocked_case_withholds_attribution_and_explains_why(client, truth):
    cid = next(c for c, t in truth.items() if t["classification"] == "BLOCKED")
    d = client.get(f"/api/cases/{cid}/replay").json()
    v, p = d["stage_5_verdict"], d["stage_4_policy_resolution"]
    assert v["classification"] == "BLOCKED" and v["shapley"] is None and "withheld" in v["shapley_status"]
    assert p["blocked_subsets"] and p["blocked_subsets"][0]["reason_code"] == "ORDERS_DISAGREE_NO_POLICY_ORDER"
    assert "BLOCKED" in p["message"] and d["stage_3_confluence_checks"]["order_sensitive_pairs"]
    rep = v["replay_of_all_corrections"]
    assert rep["order_is_authoritative"] is False and "NOT an authoritative" in rep["note"]


def test_policy_ordered_and_pass_cases_give_an_authoritative_replay_trace(client, truth):
    for fam, cls in (("policy_ordered", "POLICY_ORDERED"), ("interaction", "PASS")):
        cid = next(c for c, t in truth.items() if t["family"] == fam)
        v = client.get(f"/api/cases/{cid}/replay").json()["stage_5_verdict"]
        assert v["classification"] == cls and v["attribution_allowed"]
        rep = v["replay_of_all_corrections"]
        assert rep["order_is_authoritative"] and rep["reaches_compliant_net"]
        assert [s["node_id"] for s in rep["trace"]] == rep["order"] and rep["trace"][-1]["net_after"] == rep["net"]


def test_node_status_marks_order_sensitive_events_for_graph_colouring(client, truth):
    cid = next(c for c, t in truth.items() if t["family"] == "non_confluent")
    d = client.get(f"/api/cases/{cid}/replay").json()
    nodes = {n["event_id"]: n for n in d["node_status"]}
    sensitive = {x for p in d["stage_3_confluence_checks"]["order_sensitive_pairs"] for x in p}
    assert sensitive and all(nodes[x]["order_sensitive_with"] for x in sensitive)
    assert {n["role"] for n in nodes.values()} <= {"effective", "exempt", "context"}


def test_benchmark_cases_are_listed_for_the_ui_without_a_fake_eur_value(client):
    rows = client.get("/api/cases").json()["cases"]
    bench = [r for r in rows if r.get("source") == "benchmark (synthetic)"]
    assert len(bench) == 28 and all(r["value_eur"] is None and "synthetic" in r["note"] for r in bench)
    assert len(rows) > 28  # VBFA cases still there (when the real log is present)


@pytest.mark.skipif(not VBFA.exists(), reason="VBFA log not in this checkout")
def test_real_vbfa_case_reports_stages_3_to_5_as_not_applicable(client):
    d = client.get("/api/cases/e34/replay").json()
    assert d["stage_2b_constraint_extraction"]["status"] == "complete"
    for k in ("stage_3_confluence_checks", "stage_4_policy_resolution", "stage_5_verdict"):
        assert d[k]["status"] == "not_applicable" and "benchmark" in d[k]["message"]
    assert "classification" not in d["stage_5_verdict"]  # never a vacuous PASS for real data


def test_replay_endpoint_without_a_benchmark_still_serves_vbfa(tmp_path, monkeypatch):
    if not VBFA.exists():
        pytest.skip("VBFA log not in this checkout")
    monkeypatch.setattr(api_module, "BENCHMARK_DIR", tmp_path / "none")
    api_module._load_benchmark_case_cached.cache_clear()
    c = TestClient(api_module.app)
    assert c.get("/api/cases").status_code == 200
    assert c.get("/api/cases/e34/replay").json()["stage_5_verdict"]["status"] == "not_applicable"


def test_verdicts_endpoint_gives_every_benchmark_case_its_real_verdict(client, truth):
    d = client.get("/api/benchmark/verdicts").json()
    assert d["source"] == "benchmark (synthetic)" and set(d["verdicts"]) == set(truth)
    for cid, t in truth.items():
        v = d["verdicts"][cid]
        assert v["classification"] == t["classification"] and v["attribution_allowed"] == (t["shapley"] is not None)
        assert v["num_candidates"] >= v["num_players"] >= 1 and v["policy_version"].startswith("P-")
    assert {v["classification"] for v in d["verdicts"].values()} == {"PASS", "POLICY_ORDERED", "BLOCKED"}


def test_rows_carry_realized_loss_and_policy_for_the_cases_page(client):
    row = next(r for r in client.get("/api/cases").json()["cases"] if r.get("source") == "benchmark (synthetic)")
    assert float(row["realized_loss"]) > 0 and row["policy_version"].startswith("P-")


def test_pair_details_say_which_order_sensitive_pairs_the_policy_resolves(client, truth):
    seen = set()
    for cid, t in truth.items():
        if t["family"] not in ("policy_ordered", "non_confluent"):
            continue
        d = client.get(f"/api/cases/{cid}/replay").json()
        pairs = d["stage_3_confluence_checks"]["order_sensitive_pairs"]
        details = d["stage_4_policy_resolution"]["pair_details"]
        assert [[x["a"], x["b"]] for x in details] == pairs and details
        for x in details:
            seen.add(x["status"])
            if x["status"] == "blocked":
                assert x["reason_code"] == "ORDERS_DISAGREE_NO_POLICY_ORDER" and x["policy_first"] is None
            assert x["subsets_order_sensitive"] >= 1
        assert (t["classification"] == "BLOCKED") == any(x["status"] == "blocked" for x in details)
        assert all(n["correction_id"] for n in d["node_status"] if n["role"] == "effective")
        assert all("verdict" in s and "order_used" in s for s in d["stage_3_confluence_checks"]["subsets"])
    assert seen == {"blocked", "policy_ordered"}


def test_verdict_cache_is_big_enough_to_hold_a_whole_benchmark(client):
    """Regression: an LRU of 64 thrashed on the 140-case benchmark, recomputing every verdict
    on every call (~2.5 s each time). Second call must be served from the cache."""
    info = api_module._checked_case_cached.cache_info
    assert api_module._checked_case_cached.cache_info().maxsize >= 512
    client.get("/api/benchmark/verdicts")
    misses = info().misses
    client.get("/api/benchmark/verdicts")
    assert info().misses == misses and info().hits >= 28


def test_stage3_reports_distinct_pair_counts_not_per_subset_sums(client, truth):
    for cid in list(truth)[:28]:
        s3 = client.get(f"/api/cases/{cid}/replay").json()["stage_3_confluence_checks"]
        n_eff = len([x for x in s3["players"]])
        assert s3["distinct_pairs_unlocked"] + s3["distinct_pairs_locked"] <= n_eff * (n_eff - 1) // 2
        assert len(s3["order_sensitive_pairs"]) <= s3["distinct_pairs_unlocked"]
        assert f"{len(s3['order_sensitive_pairs'])} of them really change" in s3["message"]


def test_policies_endpoint_lists_the_real_policy_files_with_coverage(client):
    d = client.get("/api/policies").json()["policies"]
    by = {p["policy_version"]: p for p in d}
    assert set(by) == {"P-2026-Q3-001", "P-2026-Q3-002", "P-2026-Q3-003"}
    for p in d:
        assert p["description"] and p["effective_from"] and len(p["corrections"]) == 7
        assert p["coverage"]["total_pairs"] == 21
        assert p["coverage"]["ordered_pairs"] + len(p["coverage"]["unordered_pairs"]) == 21
        assert all(c["correction_id"] and c["activity"] and "remediation_cost" in c for c in p["corrections"])
    # P-003 defines no ordering at all; P-001 orders everything except the commuting price/quantity pair;
    # P-002 is in between (it says nothing about currency, adjustments or rounding)
    assert by["P-2026-Q3-003"]["coverage"]["ordered_pairs"] == 0 and by["P-2026-Q3-003"]["canonical_orderings"] == []
    assert by["P-2026-Q3-001"]["coverage"]["unordered_pairs"] == [["price_correction", "quantity_correction"]]
    assert 0 < by["P-2026-Q3-002"]["coverage"]["ordered_pairs"] < by["P-2026-Q3-001"]["coverage"]["ordered_pairs"]
    assert sum(p["used_by_cases"] for p in d) == 28  # every benchmark case uses exactly one listed policy


def test_policies_endpoint_works_without_a_benchmark(tmp_path, monkeypatch):
    monkeypatch.setattr(api_module, "BENCHMARK_DIR", tmp_path / "none")
    d = TestClient(api_module.app).get("/api/policies").json()["policies"]
    assert len(d) == 3 and all(p["used_by_cases"] is None for p in d)
