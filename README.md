# ReplaySemantics

**Team No. 20** · Abhin Anoop (204) · Ashwathy J Ajith (222) · Rohit Ajoy (255)
Guide: Asst. Professor Remya · Dept. of CSE

ReplaySemantics takes a financial loss found in an ERP event log (OCEL 2.0), finds the events that could have caused it, and replays corrections to those events. It then checks whether the **order** of the corrections changes the result, and refuses to give a number when the log and the policy cannot settle that order.

| Verdict | Meaning |
|---|---|
| **PASS** | Every legitimate order gives the same total. |
| **POLICY-ORDERED** | Orders disagree, and the policy says which one is authoritative. |
| **BLOCKED** | Orders disagree and the policy does not settle it, so attribution is withheld. |

| Member | Track | Main code |
|---|---|---|
| Abhin Anoop (Member 1) | Graph, replay core, confluence checker, web app | `src/replay_core/`, `src/api/`, `frontend/` |
| Ashwathy J Ajith (Member 2) | Policies, correction functions, benchmark | `src/policy_engine/` |
| Rohit Ajoy (Member 3) | Shapley attribution, evidence artifact | Not in this repo yet |

## Project status

**Working**

- OCEL 2.0 ingestion, the object-centric graph, candidate extraction and order constraints
- Replay operator, multi-edit cascade, confluence checker and policy resolution
- 60-case benchmark, scored against the two naive baselines
- Replay Console, Replay Graph, Replay Analysis, Swap Scenario and Policies pages
- Landing page, Firebase login, profile, saved event logs, History and Compare

**Not finished**

| Item | Where it stands |
|---|---|
| Shapley attribution (Member 3) | The Attribution page shows sample data. `provisional_shapley` in `run_case.py` is an exact stand-in, used only for scoring. |
| Evidence artifact (Member 3) | Not started in this repo. |
| Audit Log and Settings pages | Sample data, marked `PREVIEW` on screen. |
| Dashboard "Pending Review" and "Blocked Attributions" cards | Fixed numbers, marked `PREVIEW` on screen. |
| Real-data verdicts | Logs other than the benchmark stop at stage 2b, because they have no pricing fields ([decision](docs/real_data_scope_decision.md)). |
| Final integration run (M5) | Not done yet. |

## Run it

You need Python, Node.js and a Firebase project (see [Sign-in setup](#sign-in-setup-firebase)). The backend serves the API only, and the site runs separately.

**Backend, from the repo root (PowerShell):**

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
$env:FIREBASE_PROJECT_ID="your-project-id"; $env:PYTHONPATH="src"; .venv\Scripts\python -m uvicorn api.app:app --reload --port 8000
```

On macOS or Linux:

```bash
pip install -r requirements.txt
FIREBASE_PROJECT_ID=your-project-id PYTHONPATH=src uvicorn api.app:app --reload --port 8000
```

**Frontend, in a second terminal:**

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**, sign in and load an event log. To see every stage, choose the **ReplaySemantics benchmark**.

## Sign-in setup (Firebase)

Passwords, verification emails and Google sign-in are handled by Firebase. The server only checks Firebase's tokens, so it needs no service account key.

1. Create a project at https://console.firebase.google.com and add a **Web app**.
2. Under **Authentication > Sign-in method**, enable **Email/Password** and **Google**.
3. Copy `frontend/.env.example` to `frontend/.env.local` and fill in the values from the web app's config.
4. Start the backend with `FIREBASE_PROJECT_ID` set to your project id, as shown above.

Email/password accounts must verify their address before they can use the app.

## Using the site

1. **Landing page and login.** Sign in with email and password, or with Google.
2. **Load an event log.** Open a sample, paste a link or upload a file. Logs are saved to your profile, and each one lists only its own cases.
3. **Pick a case** on the Cases page and run it.

| Page | Route | What it does | Data |
|---|---|---|---|
| Landing, Login | `/`, `/login` | Introduction and sign-in | Real |
| Dashboard | `/dashboard` | Overview of the active log, or the log picker if none is open | Real, except two preview cards |
| Load log | `/load-log` | Add an event log | Real |
| Profile | `/profile` | Account details and saved logs | Real |
| Cases | `/cases` | Cases in the active log, with verdicts on benchmark cases | Real |
| Replay Console | `/replay-console` | Step through the stages and read the verdict, pairs, rules and trace | Real |
| Replay Graph | `/replay-graph` | The event graph behind a case | Real |
| Replay Analysis | `/ledger` | Corrected inputs, posted amounts, swappable pairs, policy summary, and a change panel for edits and swaps | Real |
| Swap Scenario | `/scenario` | Run chosen events in another order and see what moves | Real |
| History | `/history` | Numbered list of your runs. Tick any two or more to compare them. | Real |
| Policies | `/policies` | The policy files and the pairs each one leaves unordered | Real |
| Attribution | `/attribution` | Shape of the future Shapley result | Preview |
| Audit Log, Settings | `/audit-log`, `/settings` | Placeholders | Preview |

### Event logs

| Log | Cases | What runs |
|---|---|---|
| ReplaySemantics benchmark (synthetic) | 60 | All stages |
| SAP order-to-cash (VBFA, real, 4,811 events) | 25 | Stages 1 to 2b |
| Your own OCEL 2.0 file or link | Depends on the log | Stages 1 to 2b |

Accepted formats are `.jsonocel`, `.xmlocel`, `.sqlite` and `.csv`, up to 200 MB. Links must be public: the server refuses private addresses, and checks redirects the same way.

## How the replay works

### The money model

Member 2's frozen domain, in exact `Decimal` arithmetic (`src/policy_engine/domain.py`):

```
net = (gross - sum(discount) + tax) * fx_rate + sum(adjustment) + rounding_adj
```

### Corrections and swaps are different things

| | Correction | Swap |
|---|---|---|
| **Question** | What should this have been under the policy? | What if these posted documents ran in another order? |
| **Inputs** | Restores the policy value | Keeps the recorded values |
| **Code** | `policy_engine/corrections.py` | `replay_core/swap.py` |
| **Used for** | The verdict and the benchmark truth | The Replay Console, Analysis and Swap Scenario displays |

A swap changes a value only when the order makes that necessary:

- A node that runs before something it reads keeps its recorded value.
- Any other node is worked out from the values in the books at that moment.
- A discount that runs after the tax is taken on gross + tax (`discount_after_tax`). This is the one extension to the frozen domain. The pipeline itself still runs discount before tax, so the compliant net and every correction are unchanged.

So the posted order always reproduces the original graph. In case 40, for example:

| Order | Result |
|---|---|
| `e3 → e4` (as posted) | e3 = 1,267.22, e4 = 1,025.30, and the total doesn't move |
| `e4 → e3` | Tax keeps its recorded 1,025.30, and the discount reads it: e3 = 0.11 × (11,520.21 + 1,025.30) = 1,380.01 |
| `e5 → e3` | Rounding keeps its recorded −0.02. A discount doesn't read rounding, so nothing moves. |

Values you want to change yourself go through the **Edit** button, which runs one cascade over everything that depends on them.

### Limits

Every case accepts `min_events` (warns only), `max_events` (no limit by default) and `max_hops` (3 by default). The site draws the entire graph on the first run, and you can narrow it afterwards.

Nothing is dropped silently: dropped events are listed, and the result is marked **complete** or **partial** with what to raise. Order locks are worked out on all reachable events, then restricted to the kept ones.

## Benchmark

There are 60 synthetic cases: 54 laid out by resolution class, hops and policy, plus 6 larger cases of up to 15 candidate events (`RSC-2026-00055` to `00060`). The design is in [docs/benchmark_v2.md](docs/benchmark_v2.md).

| Verdict | Cases | | Resolution class | Cases | | Policy | Cases |
|---|---|---|---|---|---|---|---|
| PASS | 16 | | Swap only | 12 | | P-2026-Q3-001 | 49 |
| POLICY-ORDERED | 33 | | Multi-edit only | 16 | | P-2026-Q3-002 (leaves rounding unordered) | 6 |
| BLOCKED | 11 | | Swap and edit | 28 | | P-2026-Q3-003 (orders nothing) | 5 |
| | | | Direct fix | 4 | | | |

Deepest correctable event: 4 cases at 1 hop, 20 at 2, 24 at 3, 9 at 4 and 3 at 5.

| System | Classification accuracy | False attribution rate |
|---|---|---|
| **ReplaySemantics** | **1.00** | **0.00** |
| Naive sequential | 0.27 | 0.18 |
| Naive split | 0.27 | 0.23 |

These are graded by the team's own oracle (`reference_sim.py`), so 1.00 means agreement with that model, not real-world truth. Full results are in [docs/benchmark_results.json](docs/benchmark_results.json).

To regenerate the benchmark or score it again (PowerShell, after `$env:PYTHONPATH="src"`):

```powershell
.venv\Scripts\python -m policy_engine.benchmark.generator --out data/benchmark --seed 7
.venv\Scripts\python -m replay_core.benchmark_run --root data/benchmark --out docs/benchmark_results.json
```

Generation fails if any quota is missed. With seed 7, the sealed truth hash in `data/benchmark/manifest.json` is `2b3b5c49c683...`.

## Known limits

- **Fixed-amount discounts aren't modelled.** Discounts are rate-based, so a fixed dollar amount would behave differently in a swap. This is recorded as future scope.
- **Only OCEL 2.0 logs load.** Other log formats aren't supported.
- **Real logs stop at stage 2b.** VBFA has no unit price, discount rate, tax rate or FX fields, so there is nothing to correct.
- **The exact checker is exponential.** It takes about 2 s for 8 freely permutable events and about 22 s for 10, and it refuses more than 10 correctable events.
- **Benchmark depth is synthetic.** It comes from chains of context events that move no money. The money model allows one tax, rounding, price, quantity and currency event, so 15 events can't all move money.
- **Large graphs zoom out.** Graphs of 12 to 15 events open at roughly 46–70% zoom.

## API

All endpoints except `/api/health` need a Firebase token (`Authorization: Bearer <token>`). Most also need an open event log.

| Status | Meaning |
|---|---|
| 401 | Missing or invalid token |
| 403 | Email not verified |
| 409 | No event log open |
| 503 | The server has no `FIREBASE_PROJECT_ID` |

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Health check |
| `GET`, `PATCH /api/me` | Your profile and active log |
| `GET /api/logs`, `POST /api/logs/sample`, `/url`, `/upload`, `/{id}/open` | Saved event logs |
| `GET`, `POST /api/history`, `POST /api/history/compare` | Recorded actions and comparisons |
| `GET /api/dashboard`, `/api/cases`, `/api/policies` | Overview, case list and policy files |
| `GET /api/benchmark/cases`, `/api/benchmark/verdicts` | Benchmark index and verdicts |
| `GET /api/cases/{id}/replay` | Stages 1–5 for a case |
| `GET /api/cases/{id}/hops` | Hop profile and the limits for the full graph |
| `GET /api/cases/{id}/analysis`, `/pair?a=&b=` | Replay Analysis data, and one pair run both ways |
| `GET /api/cases/{id}/scenario?subset=&order=` | A swap scenario |
| `POST /api/cases/{id}/change` | Edits and swaps in the sequence you choose |
| `GET /api/cases/{id}/state`, `POST /api/cases/{id}/edit` | Editable fields and a multi-node edit (benchmark cases only) |

`replay`, `state`, `edit`, `scenario`, `analysis`, `pair` and `change` accept the three limits as query parameters. FastAPI's interactive docs are at `http://localhost:8000/docs`.

## Configuration

| Variable | Where | Purpose | Default |
|---|---|---|---|
| `FIREBASE_PROJECT_ID` | Backend | Firebase project whose tokens are accepted | Required |
| `FIREBASE_AUTH_EMULATOR_HOST` | Backend | Use the local Auth Emulator (testing only) | Off |
| `REPLAY_DATA_DIR` | Backend | Account database and uploaded logs | `var/` |
| `REPLAY_MAX_LOG_MB` | Backend | Largest event log accepted | `200` |
| `REPLAY_BENCHMARK_DIR` | Backend | Benchmark folder | `data/benchmark` |
| `REPLAY_CORS_ORIGINS` | Backend | Comma-separated origins allowed to call the API | `http://localhost:5173` |
| `VITE_API_BASE_URL` | `frontend/.env.local` | Backend address | `http://localhost:8000` |
| `VITE_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID`, `_APP_ID` | `frontend/.env.local` | Firebase web app config | Required |
| `VITE_FIREBASE_AUTH_EMULATOR` | `frontend/.env.local` | Use the local Auth Emulator (testing only) | Off |

`var/` and `frontend/.env.local` aren't committed.

## Tests and command-line tools

There are 289 Python tests and 90 frontend logic assertions.

```powershell
$env:PYTHONPATH="src"; .venv\Scripts\python -m pytest
node frontend/scripts/check-lib.mjs
```

The pipeline also runs without the site (with `PYTHONPATH=src`):

```bash
# Read a log and print a summary
python -m replay_core.ingestion data/raw/ocel20_example.jsonocel

# Export flat CSVs for teammates
python -m replay_core.export data/raw/ocel20_example.jsonocel --out data/processed

# Find the candidate events behind a target event
python -m replay_core.candidate_extraction data/raw/vbfa_o2c_2019_2021_eur.jsonocel e977 --max-events 8

# Run one benchmark case through the full pipeline
python -m replay_core.run_case --root data/benchmark --case RSC-2026-00043
```

```python
from replay_core.benchmark_io import load_benchmark_case
from replay_core.confluence import ConfluenceChecker

case = load_benchmark_case("data/benchmark", "RSC-2026-00043")
verdict = ConfluenceChecker.from_loaded(case).check_case()
print(verdict.classification, verdict.attribution_allowed)
```

### A finding from the real data

With `max_events=8`, case `e977`'s graph comes back disconnected from its target. All 8 kept candidates come from a later traversal hop, and the hop-1 events that linked them to the target were pruned by the recency cutoff. The pipeline reports this in `result.warnings` instead of drawing an edge that isn't there. `max_events=20` gives the full connected tree.

## Repo layout

```
ReplaySemantics/
├── data/
│   ├── raw/                  # OCEL 2.0 example log and the real VBFA log
│   ├── processed/            # flat CSV exports of the example log
│   ├── processed_vbfa/       # flat CSV exports of the VBFA log
│   └── benchmark/            # public/ case logs, hidden/ sealed truth, manifest.json
├── docs/                     # benchmark design and results, handoffs, screenshots
├── frontend/                 # the site (React + Vite), see frontend/README.md
├── src/
│   ├── api/
│   │   ├── app.py            # FastAPI app: cases, replay, analysis, scenario, policies
│   │   ├── account.py        # profile, saved logs, history endpoints
│   │   ├── auth.py           # Firebase token check
│   │   ├── store.py          # SQLite store for users, logs and actions
│   │   ├── history.py        # action snapshots and Compare
│   │   └── log_source.py     # safe fetching of logs from a link
│   ├── replay_core/
│   │   ├── models.py, ingestion.py, export.py, vbfa_converter.py   # logs
│   │   ├── graph.py, candidate_extraction.py, constraint_extraction.py   # stages 1-2b
│   │   ├── replay.py, propagation.py    # replay operator and edit cascade
│   │   ├── confluence.py     # the order check: PASS / POLICY-ORDERED / BLOCKED
│   │   ├── swap.py           # swaps: recorded inputs only
│   │   ├── scenario.py, influence.py, ledger.py, limits.py, explain.py   # page data
│   │   └── benchmark_io.py, benchmark_run.py, baselines.py, run_case.py  # benchmark
│   └── policy_engine/
│       ├── domain.py, corrections.py, loss.py, ordering.py   # money and policy rules
│       ├── schema.py, case_builder.py, policy.schema.json, policies/
│       └── benchmark/        # generator, evaluate, reference_sim (the oracle)
├── tests/
├── pytest.ini
└── requirements.txt
```

## Project history

| Stage | What was added |
|---|---|
| Month 1 | OCEL 2.0 ingestion, validation and CSV export |
| Month 2 | Object-centric graph, backward traversal for candidates, order constraints, first React frontend |
| Month 3 | Member 2's policy engine merged, replay operator, multi-edit cascade, benchmark loading |
| Month 4 | Confluence checker, real verdicts in the UI, Policies page |
| Benchmark v2 | 54-case matrix, Replay Analysis page, limits on every case |
| UI flow | New Replay Console flow, event descriptions, Swap Scenario rework |
| Swaps | Swaps separated from corrections, `discount_after_tax` added |
| Accounts | Landing page, Firebase login, profile, saved logs, History, Compare, the old `webapp/` page removed |
| Larger cases | 6 cases of up to 15 candidate events, taking the benchmark to 60 |
