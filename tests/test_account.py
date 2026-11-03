"""Sign-in, per-user event logs, history of actions and the comparison report, through the real API.

Only the token check itself is replaced: each test token names its user. Everything behind it runs for real.
"""
import json
from pathlib import Path

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("firebase_admin")

from fastapi.testclient import TestClient  # noqa: E402

from api import app as api_module  # noqa: E402
from api import auth, log_source  # noqa: E402

OCEL_SAMPLE = Path(__file__).resolve().parents[1] / "data" / "raw" / "ocel20_example.jsonocel"
CASE_40 = "RSC-2026-00040"
LIMITS = {"max_hops": 3, "max_events": 7, "min_events": 7}


def _verify(token):
    if token.startswith("unverified"):
        raise auth.AuthError("Please verify your email address first.", 403)
    if token == "bad":
        raise auth.AuthError("Your sign-in has expired or is not valid. Please sign in again.")
    return {"uid": token, "email": f"{token}@example.com", "name": token.title(), "email_verified": True,
            "firebase": {"sign_in_provider": "password"}}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("REPLAY_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(auth, "verify_token", _verify)
    return TestClient(api_module.app)


def h(user="kavya"):
    return {"Authorization": f"Bearer {user}"}


def _benchmark(client, user="kavya"):
    r = client.post("/api/logs/sample", json={"sample": "benchmark"}, headers=h(user))
    assert r.status_code == 200
    return r.json()["log"]


def _upload(client, user="kavya", name="my log.jsonocel"):
    r = client.post("/api/logs/upload", params={"filename": name}, content=OCEL_SAMPLE.read_bytes(), headers=h(user))
    assert r.status_code == 200, r.text
    return r.json()["log"]


def _swap(client, order, user="kavya"):
    r = client.post("/api/history", headers=h(user), json={
        "kind": "swap", "case_id": CASE_40, "subset": ["e3", "e4"], "order": order, "limits": LIMITS})
    assert r.status_code == 200, r.text
    return r.json()


# ---- sign-in ----
def test_every_api_call_needs_a_valid_sign_in(client):
    for path in ("/api/cases", "/api/dashboard", "/api/me", "/api/logs", "/api/history", "/api/policies"):
        assert client.get(path).status_code == 401, path
        assert client.get(path, headers=h("bad")).status_code == 401, path


def test_an_unverified_email_is_refused(client):
    r = client.get("/api/me", headers=h("unverified-user"))
    assert r.status_code == 403 and "verify" in r.json()["detail"]


def test_the_real_token_check_refuses_unverified_emails_and_garbage(monkeypatch):
    monkeypatch.undo()
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "demo-test")
    monkeypatch.setattr(auth.firebase_auth, "verify_id_token", lambda t, app=None, clock_skew_seconds=0: {"uid": "u", "email_verified": False})
    with pytest.raises(auth.AuthError) as e:
        auth.verify_token("t")
    assert e.value.status == 403

    def boom(t, app=None, clock_skew_seconds=0):
        raise ValueError("bad signature")
    monkeypatch.setattr(auth.firebase_auth, "verify_id_token", boom)
    with pytest.raises(auth.AuthError) as e:
        auth.verify_token("t")
    assert e.value.status == 401


@pytest.fixture()
def real_firebase(monkeypatch):
    """The real token check with no emulator and no service account key, as on a developer's PC. Only Google's public
    keys are stood in for: tokens are signed here with a matching test key, so the signature check really runs."""
    import datetime
    import firebase_admin
    import jwt
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from google.oauth2 import id_token

    monkeypatch.delenv("FIREBASE_AUTH_EMULATOR_HOST", raising=False)
    monkeypatch.delenv("GOOGLE_APPLICATION_CREDENTIALS", raising=False)
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "demo-real")

    def reset():
        try:
            firebase_admin.delete_app(firebase_admin.get_app())
        except ValueError:
            pass
    reset()
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(x509.NameOID.COMMON_NAME, "test")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(1).not_valid_before(now - datetime.timedelta(days=1)).not_valid_after(now + datetime.timedelta(days=1))
            .sign(key, hashes.SHA256()))
    pem = cert.public_bytes(serialization.Encoding.PEM).decode()
    monkeypatch.setattr(id_token, "_fetch_certs", lambda request, url: {"k1": pem})

    def sign(project="demo-real", verified=True, signer=key, iat_offset=-5):
        t = int(now.timestamp())
        return jwt.encode({"aud": project, "iss": f"https://securetoken.google.com/{project}", "sub": "user-1", "email": "a@example.com",
                           "email_verified": verified, "iat": t + iat_offset, "auth_time": t - 5, "exp": t + 3000,
                           "firebase": {"sign_in_provider": "google.com"}},
                          signer, algorithm="RS256", headers={"kid": "k1"})
    yield sign
    reset()


def test_a_real_token_is_accepted_without_a_service_account_key(real_firebase):
    claims = auth.verify_token(real_firebase())
    assert claims["uid"] == "user-1" and claims["email"] == "a@example.com"


def test_a_slightly_slow_pc_clock_does_not_refuse_a_good_token(real_firebase):
    assert auth.verify_token(real_firebase(iat_offset=10))["uid"] == "user-1"


def test_real_tokens_that_must_be_refused(real_firebase):
    from cryptography.hazmat.primitives.asymmetric import rsa
    for bad in (real_firebase(project="another-project"), real_firebase(signer=rsa.generate_private_key(public_exponent=65537, key_size=2048)), "garbage"):
        with pytest.raises(auth.AuthError) as e:
            auth.verify_token(bad)
        assert e.value.status == 401
    with pytest.raises(auth.AuthError) as e:
        auth.verify_token(real_firebase(verified=False))
    assert e.value.status == 403


def test_a_server_without_a_firebase_project_says_so(monkeypatch):
    monkeypatch.delenv("FIREBASE_PROJECT_ID", raising=False)
    with pytest.raises(auth.AuthError) as e:
        auth.verify_token("t")
    assert e.value.status == 503 and "FIREBASE_PROJECT_ID" in str(e.value)


def test_the_first_sign_in_creates_a_profile_and_a_rename_stays(client):
    me = client.get("/api/me", headers=h()).json()
    assert me["user"]["email"] == "kavya@example.com" and me["user"]["name"] == "Kavya" and me["active_log"] is None
    assert client.patch("/api/me", json={"name": "Kavya Mehra"}, headers=h()).json()["user"]["name"] == "Kavya Mehra"
    assert client.get("/api/me", headers=h()).json()["user"]["name"] == "Kavya Mehra"


# ---- event logs ----
def test_the_benchmark_opens_only_its_60_cases_and_an_ocel_log_only_its_25(client):
    samples = client.get("/api/logs", headers=h()).json()["samples"]
    assert next(s for s in samples if s["id"] == "benchmark")["cases"] == 60
    _benchmark(client)
    cases = client.get("/api/cases", headers=h()).json()["cases"]
    assert len(cases) == 60 and all(c["case_id"].startswith("RSC-") for c in cases)
    assert client.get("/api/dashboard", headers=h()).json()["available_cases"] == 60

    vbfa = Path(__file__).resolve().parents[1] / "data" / "raw" / "vbfa_o2c_2019_2021_eur.jsonocel"
    r = client.post("/api/logs/upload", params={"filename": vbfa.name}, content=vbfa.read_bytes(), headers=h())
    assert r.status_code == 200, r.text
    cases = client.get("/api/cases", headers=h()).json()["cases"]
    assert len(cases) == 25 and not any(c["case_id"].startswith("RSC-") for c in cases)
    assert client.get("/api/dashboard", headers=h()).json()["available_cases"] == 25


def test_nothing_is_loaded_until_the_user_loads_a_log(client):
    assert client.get("/api/cases", headers=h()).status_code == 409
    assert client.get("/api/dashboard", headers=h()).status_code == 409
    _benchmark(client)
    cases = client.get("/api/cases", headers=h()).json()["cases"]
    assert cases and all(c["case_id"].startswith("RSC-") for c in cases)


def test_an_uploaded_log_shows_only_its_own_cases_and_stops_at_the_constraints(client):
    log = _upload(client)
    assert log["label"] == "my log.jsonocel" and log["events"] > 0 and "path" not in log
    cases = client.get("/api/cases", headers=h()).json()["cases"]
    assert cases and not any(c["case_id"].startswith("RSC-") for c in cases)
    assert client.get(f"/api/cases/{CASE_40}/replay", headers=h()).status_code == 404
    d = client.get(f"/api/cases/{cases[0]['case_id']}/replay", headers=h()).json()
    assert d["stage_5_verdict"]["status"] == "not_applicable" and d["source"] == "my log.jsonocel"
    assert client.get(f"/api/cases/{cases[0]['case_id']}/analysis", headers=h()).status_code == 422
    assert client.get("/api/dashboard", headers=h()).json()["log_label"] == "my log.jsonocel"


def test_a_file_that_is_not_a_log_is_refused_and_not_saved(client, tmp_path):
    r = client.post("/api/logs/upload", params={"filename": "x.jsonocel"}, content=b"not json", headers=h())
    assert r.status_code == 422 and "OCEL" in r.json()["detail"]
    assert client.post("/api/logs/upload", params={"filename": "x.exe"}, content=b"x", headers=h()).status_code == 422
    assert client.post("/api/logs/upload", params={"filename": "x.jsonocel"}, content=b"", headers=h()).status_code == 422
    assert client.get("/api/logs", headers=h()).json()["logs"] == []
    assert not list((tmp_path / "logs" / "kavya").glob("*"))


def test_saved_logs_reopen_without_entering_them_again_and_survive_a_new_session(client):
    first, second = _upload(client), _benchmark(client)
    assert client.get("/api/me", headers=h()).json()["active_log"]["id"] == second["id"]
    logs = client.get("/api/logs", headers=h()).json()
    assert {x["id"] for x in logs["logs"]} == {first["id"], second["id"]} and logs["active_log_id"] == second["id"]
    assert client.post(f"/api/logs/{first['id']}/open", headers=h()).status_code == 200
    assert client.get("/api/me", headers=h()).json()["active_log"]["id"] == first["id"]
    assert not any(c["case_id"].startswith("RSC-") for c in client.get("/api/cases", headers=h()).json()["cases"])
    # the same file again is the same saved log, not a second row
    assert _upload(client)["id"] == first["id"]
    assert len(client.get("/api/logs", headers=h()).json()["logs"]) == 2


def test_users_cannot_reach_each_others_logs_or_history(client):
    log = _upload(client, "kavya")
    _benchmark(client, "rohit")
    assert client.post(f"/api/logs/{log['id']}/open", headers=h("rohit")).status_code == 404
    assert all(c["case_id"].startswith("RSC-") for c in client.get("/api/cases", headers=h("rohit")).json()["cases"])
    assert not any(c["case_id"].startswith("RSC-") for c in client.get("/api/cases", headers=h("kavya")).json()["cases"])
    action = _swap(client, ["e3", "e4"], "rohit")["action"]
    assert client.get("/api/history", headers=h("kavya")).json()["actions"] == []
    assert client.post("/api/history/compare", json={"ids": [action["id"], action["id"] + 1]}, headers=h("kavya")).status_code == 404


@pytest.mark.parametrize("url", [
    "http://localhost/x.jsonocel", "http://127.0.0.1/x.jsonocel", "http://[::1]/x.jsonocel", "http://10.0.0.5/x.jsonocel",
    "http://192.168.1.1/x.jsonocel", "http://169.254.169.254/latest/meta-data/x.jsonocel", "file:///etc/passwd", "ftp://example.com/x.jsonocel", "not a link",
])
def test_links_to_private_addresses_and_other_schemes_are_refused(client, url):
    r = client.post("/api/logs/url", json={"url": url}, headers=h())
    assert r.status_code == 422, r.text
    assert client.get("/api/logs", headers=h()).json()["logs"] == []


def test_a_redirect_to_a_private_address_is_refused(client, monkeypatch):
    import httpx
    import socket

    def resolve(host, port, *a, **k):
        ip = "93.184.216.34" if host == "public.example" else socket.gethostbyname(host)
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port))]
    monkeypatch.setattr(log_source.socket, "getaddrinfo", resolve)

    calls = []

    def handler(request):
        calls.append(str(request.url))
        return httpx.Response(302, headers={"location": "http://127.0.0.1/secret.jsonocel"})
    real = httpx.Client
    monkeypatch.setattr(log_source.httpx, "Client", lambda **k: real(transport=httpx.MockTransport(handler), **k))
    r = client.post("/api/logs/url", json={"url": "http://public.example/x.jsonocel"}, headers=h())
    assert r.status_code == 422 and "private" in r.json()["detail"]
    assert calls == ["http://public.example/x.jsonocel"]  # the private address was never requested


def test_a_public_link_loads_and_a_web_page_is_explained(client, monkeypatch):
    import httpx
    import socket
    monkeypatch.setattr(log_source.socket, "getaddrinfo", lambda h_, p, *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", p))])

    def handler(request):
        if request.url.path.endswith(".jsonocel"):
            return httpx.Response(200, content=OCEL_SAMPLE.read_bytes())
        return httpx.Response(200, content=b"<html></html>")
    real = httpx.Client
    monkeypatch.setattr(log_source.httpx, "Client", lambda **k: real(transport=httpx.MockTransport(handler), **k))
    log = client.post("/api/logs/url", json={"url": "https://public.example/data/orders.jsonocel"}, headers=h()).json()["log"]
    assert log["label"] == "orders.jsonocel" and log["url"] == "https://public.example/data/orders.jsonocel"
    r = client.post("/api/logs/url", json={"url": "https://public.example/dashboard"}, headers=h())
    assert r.status_code == 422 and "web page" in r.json()["detail"]


# ---- history ----
def test_each_action_gets_the_next_number_and_stores_its_result(client):
    _benchmark(client)
    a1 = client.post("/api/history", headers=h(), json={"kind": "run_case", "case_id": CASE_40, "limits": LIMITS}).json()["action"]
    a2 = _swap(client, ["e3", "e4"])["action"]
    a3 = _swap(client, ["e4", "e3"])["action"]
    assert [a1["seq"], a2["seq"], a3["seq"]] == [1, 2, 3]
    assert a1["snapshot"]["verdict"] == "POLICY_ORDERED" and float(a1["snapshot"]["total"]) == 906570
    assert float(a2["snapshot"]["total"]) == 906570 and a2["snapshot"]["changes"] == []
    assert round(float(a3["snapshot"]["total"]), 2) == 897504.30
    assert a3["snapshot"]["changes"][0]["node"] == "e3" and a3["log_label"].startswith("ReplaySemantics benchmark")
    # it reads the same in a later session (a new client), newest first
    again = TestClient(api_module.app).get("/api/history", headers=h()).json()["actions"]
    assert [x["seq"] for x in again] == [3, 2, 1] and again[0]["snapshot"] == a3["snapshot"]


def test_reopening_the_same_swap_is_not_a_new_action_but_running_a_case_again_is(client):
    _benchmark(client)
    assert _swap(client, ["e3", "e4"])["recorded"] is True
    assert _swap(client, ["e3", "e4"])["recorded"] is False
    body = {"kind": "run_case", "case_id": CASE_40, "limits": LIMITS}
    seqs = [client.post("/api/history", headers=h(), json=body).json()["action"]["seq"] for _ in range(2)]
    assert seqs == [2, 3]


def test_pair_and_change_actions(client):
    _benchmark(client)
    p = client.post("/api/history", headers=h(), json={"kind": "pair", "case_id": CASE_40, "a": "e3", "b": "e4", "limits": LIMITS}).json()["action"]
    assert len(p["snapshot"]["outcomes"]) == 2
    c = client.post("/api/history", headers=h(), json={
        "kind": "change", "case_id": CASE_40, "edits": {"e3": {"rate": "0.2"}}, "swap": ["e3", "e4"], "limits": LIMITS}).json()["action"]
    assert c["snapshot"]["changes"] == [{"node": "e3", "field": "rate", "before": None, "after": "0.2"}] and len(c["snapshot"]["outcomes"]) == 2


def test_a_run_on_an_uploaded_log_is_recorded_without_a_total(client):
    _upload(client)
    cid = client.get("/api/cases", headers=h()).json()["cases"][0]["case_id"]
    a = client.post("/api/history", headers=h(), json={"kind": "run_case", "case_id": cid}).json()["action"]
    assert a["snapshot"]["total"] is None and a["snapshot"]["verdict"] is None and a["snapshot"]["note"]


def test_an_action_needs_a_loaded_log_and_a_valid_kind(client):
    assert client.post("/api/history", headers=h(), json={"kind": "run_case", "case_id": "x"}).status_code == 409
    _benchmark(client)
    assert client.post("/api/history", headers=h(), json={"kind": "nonsense", "case_id": CASE_40}).status_code == 422


# ---- compare ----
def test_compare_two_actions_reports_the_real_differences(client):
    _benchmark(client)
    a = _swap(client, ["e3", "e4"])["action"]
    b = _swap(client, ["e4", "e3"])["action"]
    r = client.post("/api/history/compare", json={"ids": [b["id"], a["id"]]}, headers=h()).json()
    assert [c["seq"] for c in r["columns"]] == [1, 2]  # oldest first, whatever order they were ticked in
    assert round(float(r["columns"][1]["total_vs_first"]), 2) == -9065.70 and float(r["columns"][0]["moved"]) == 0
    row = r["node_rows"][0]
    assert (row["node"], row["field"]) == ("e3", "amount") and "1" not in row["values"] and "2" in row["values"]
    text = " ".join(r["findings"])
    assert "same case" in text and "9,065.70 apart" in text and "Action 1: unchanged" in text


def test_compare_any_number_of_actions_across_cases_and_logs(client):
    _benchmark(client)
    ids = [_swap(client, ["e3", "e4"])["action"]["id"], _swap(client, ["e4", "e3"])["action"]["id"]]
    other = client.post("/api/history", headers=h(), json={"kind": "run_case", "case_id": "RSC-2026-00005"}).json()["action"]["id"]
    r = client.post("/api/history/compare", json={"ids": [*ids, other]}, headers=h()).json()
    assert len(r["columns"]) == 3 and "different cases" in r["findings"][0]
    _upload(client)
    cid = client.get("/api/cases", headers=h()).json()["cases"][0]["case_id"]
    last = client.post("/api/history", headers=h(), json={"kind": "run_case", "case_id": cid}).json()["action"]["id"]
    r = client.post("/api/history/compare", json={"ids": [*ids, other, last]}, headers=h()).json()
    assert len(r["columns"]) == 4 and "different event logs" in r["findings"][0] and "no total" in r["findings"][-1]
    json.dumps(r)


def test_compare_needs_at_least_two_actions(client):
    _benchmark(client)
    a = _swap(client, ["e3", "e4"])["action"]
    assert client.post("/api/history/compare", json={"ids": [a["id"]]}, headers=h()).status_code == 422
    assert client.post("/api/history/compare", json={"ids": [a["id"], a["id"]]}, headers=h()).status_code == 422
