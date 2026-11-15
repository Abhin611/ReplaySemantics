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

This section assumes you have never run a coding project before. Follow the steps in order and copy each command exactly. The guide is written for **Windows** with **Visual Studio Code**; macOS and Linux differences are at the end.

### How the project is put together

The project has two parts, and **both must be running at the same time**:

- **The backend** (Python) does the calculations. It runs at `http://localhost:8000`, but you never open that address yourself.
- **The website** (the "frontend") is what you see and click. It runs at `http://localhost:5173`.

"localhost" means "this computer". Nothing is put on the internet: both parts run only on your PC, and each one runs in its own **terminal** (a window where you type commands).

Sign-in is handled by **Firebase**, a free Google service that manages accounts and passwords. You don't have to install or run Firebase, but the website needs a small settings file that tells it which Firebase project to use (step 4).

### Step 1: Install the tools (once per computer)

Install these three programs, accepting the default options unless a step below says otherwise:

1. **Python 3.10 or newer** from https://www.python.org/downloads/. On the first installer screen, **tick "Add python.exe to PATH"** before clicking *Install Now*. Without this, the commands below will not find Python.
2. **Node.js (the "LTS" version)** from https://nodejs.org. This also installs `npm`, which downloads the website's building blocks.
3. **Visual Studio Code** from https://code.visualstudio.com. This is the editor you will run everything from.

Restart your computer after installing, so the new programs are found.

### Step 2: Get the project and open it

1. On the project's GitHub page, click the green **Code** button, then **Download ZIP**. (If you know Git, `git clone` works too.)
2. Right-click the downloaded ZIP and choose **Extract All**.
3. Open Visual Studio Code, choose **File > Open Folder**, and pick the extracted project folder (usually `ReplaySemantics-main`): the one that directly contains `README.md`, `src` and `frontend`. If VS Code asks whether you trust the authors, click **Yes**.
4. Open a terminal with **Terminal > New Terminal** in the top menu. A panel opens at the bottom of the window. That is where you type the commands. To run a command, paste it there and press **Enter**.

### Step 3: Download what the project needs (once)

These commands download the libraries the project uses. They can take a few minutes; wait until the blinking cursor comes back before typing the next one. Some warnings in yellow are normal.

In the terminal, run these one at a time:

```powershell
python -m venv .venv
```

```powershell
.venv\Scripts\python -m pip install -r requirements.txt
```

```powershell
cd frontend
```

```powershell
npm install
```

```powershell
cd ..
```

The first command creates a `.venv` folder, a private Python just for this project. The second fills it with the Python libraries. `npm install` creates `frontend\node_modules` with the website's libraries. The last command takes the terminal back to the main folder.

### Step 4: Add the sign-in settings file (once)

The website needs a small text file called `.env.local`, inside the `frontend` folder. It tells the website which Firebase project handles sign-in. The file is not included in the download, so you have to add it yourself.

There are two ways to do this. **Choose only one:**

- **Option A** uses the project team's existing Firebase project. It is quicker, and you only need the file from the team.
- **Option B** sets up your own free Firebase project. Use it if you can't get the file from the team, or want your own separate accounts.

The values in this file are the website's public Firebase settings, not passwords, so they are safe to share with teammates.

#### Option A: Use the team's Firebase project

1. **Ask the team for the settings.** Ask the project team (Abhin Anoop) for the `.env.local` file. They may send the file itself, or its contents as text (for example in a chat or an email).
2. **If you were sent the file**, save it into the `frontend` folder of the project. Make sure it is named exactly `.env.local`:
   - Windows may hide the name or add `.txt` to the end. In VS Code's file list on the left, open the `frontend` folder and check that it shows `.env.local`, not `.env.local.txt` and not `env.local`.
   - If the name is wrong, right-click it, choose **Rename**, and fix it.
3. **If you were sent the contents as text**, create the file in VS Code instead:
   1. In the file list on the left, right-click the `frontend` folder and choose **New File...**.
   2. Type `.env.local` as the name (with the dot at the start) and press **Enter**. An empty file opens.
   3. Paste the text you were sent into it. It should look like this, with real values after each `=`:

      ```
      VITE_API_BASE_URL=http://localhost:8000
      VITE_FIREBASE_API_KEY=...
      VITE_FIREBASE_AUTH_DOMAIN=replaysemantics.firebaseapp.com
      VITE_FIREBASE_PROJECT_ID=replaysemantics
      VITE_FIREBASE_APP_ID=...
      ```

   4. Press **Ctrl + S** to save.
4. **Remember the project ID.** With this option, the project ID is `replaysemantics`. That is already the value used in the step 5 commands, so you don't need to change anything there.
5. **About accounts.** Your accounts will be stored in the team's Firebase project. Signing up with email and password, or with Google, both work straight away.

#### Option B: Set up your own Firebase project

You need a Google account for this, and it is free. Firebase handles the passwords, verification emails and Google sign-in. The backend only checks Firebase's sign-in tickets, so it needs no secret key.

1. **Create the project.**
   1. Go to https://console.firebase.google.com and sign in with your Google account.
   2. Click **Create a project** (or **Add project**), and type any name, such as `my-replay`.
   3. Accept the terms. When asked about Google Analytics, turn it **off** (it isn't needed), and click **Create project**. Wait for it to finish, then click **Continue**.
2. **Find the project ID.** Click the gear icon next to **Project Overview** at the top left, then **Project settings**. On the **General** tab, find **Project ID**, for example `my-replay-1a2b3`. It can differ from the name you typed. Copy it somewhere, because you need it in step 5.
3. **Register the website with Firebase.**
   1. On the same **Project settings** page, scroll down to **Your apps** and click the **Web** icon, which looks like `</>`.
   2. Type any nickname, such as `replay-web`, and leave "Firebase Hosting" unticked. Click **Register app**.
   3. Firebase shows a block of code with a section called `firebaseConfig`, containing `apiKey`, `authDomain`, `projectId` and `appId`. Keep this page open; you'll copy these four values next. (You can always find them again under **Project settings > Your apps**.)
4. **Turn on sign-in.**
   1. In the left menu, open **Build > Authentication** (or **Security > Authentication**) and click **Get started**.
   2. On the **Sign-in method** tab, click **Email/Password**, switch on the first **Enable** toggle, and click **Save**.
   3. Click **Add new provider**, then **Google**. Switch **Enable** on, choose your email as the "Project support email", and click **Save**.
   4. You don't need to change anything else. `localhost`, which is where this project runs, is allowed by default under **Settings > Authorized domains**.
5. **Create the settings file.**
   1. In VS Code's file list on the left, open the `frontend` folder. Right-click `.env.example`, choose **Copy**, then right-click the `frontend` folder and choose **Paste**. This creates `.env copy.example`.
   2. Right-click that copy, choose **Rename**, and name it exactly `.env.local`.
   3. Open `.env.local` and type each value from the Firebase page after its `=` sign. Leave out the quote marks and don't add spaces:

      ```
      VITE_API_BASE_URL=http://localhost:8000
      VITE_FIREBASE_API_KEY=the apiKey value, e.g. AIzaSyB...
      VITE_FIREBASE_AUTH_DOMAIN=the authDomain value, e.g. my-replay-1a2b3.firebaseapp.com
      VITE_FIREBASE_PROJECT_ID=the projectId value, e.g. my-replay-1a2b3
      VITE_FIREBASE_APP_ID=the appId value, e.g. 1:123456789:web:abc123
      ```

   4. Leave the last two lines (starting with `#`) as they are, and press **Ctrl + S** to save.
6. **Use your project ID in step 5.** In the backend command in step 5, replace `replaysemantics` with your own project ID. The two must match, or sign-in will work but the website won't be able to load anything.

**Check, for either option:** the `frontend` folder should now contain a file named exactly `.env.local`, next to `.env.example`. If you change this file later, stop the website (Terminal 2) and start it again, because it only reads the file when it starts.

### Step 5: Start the project (every time)

You need **two terminals**: one for the backend and one for the website.

**Terminal 1, the backend.** In the terminal you already have, make sure you are in the main project folder (the line before the cursor should end in the project folder name, such as `ReplaySemantics-main>`, not `frontend>`). Then run:

```powershell
$env:FIREBASE_PROJECT_ID="replaysemantics"; $env:PYTHONPATH="src"; .venv\Scripts\python -m uvicorn api.app:app --port 8000
```

If you chose Option B in step 4, replace `replaysemantics` with your project's ID. The backend is ready when it prints **`Application startup complete`**. Leave this terminal alone: it has to keep running.

**Terminal 2, the website.** Open a second terminal by clicking the **+** button at the top right of the terminal panel. Then run:

```powershell
cd frontend
```

```powershell
npm run dev
```

When it shows `Local: http://localhost:5173/`, the website is ready.

### Step 6: Use the website

1. Open a web browser (Chrome, Edge or Firefox) and go to **http://localhost:5173**.
2. Click **Get started** and create an account, or sign in with Google. If you sign up with an email and password, Firebase sends you a verification email. Click its link before you sign in.
3. When asked to load an event log, choose the **ReplaySemantics benchmark**. It is the sample that shows every stage of the project.

### Stopping and starting again

- **To stop:** click inside each terminal and press **Ctrl + C**. Closing VS Code also stops both.
- **To start again later:** open the folder in VS Code and repeat **step 5** only. Steps 1 to 4 are one-time setup.

### If something goes wrong

| What you see | What to do |
|---|---|
| `'python' is not recognized` | Python is not on PATH. Run the Python installer again, choose *Modify*, and make sure "Add Python to environment variables" is ticked. Then restart VS Code. |
| `npm.ps1 cannot be loaded because running scripts is disabled` | Type `npm.cmd` instead of `npm` (for example `npm.cmd install` and `npm.cmd run dev`). |
| `No module named uvicorn` or `No module named api` | Terminal 1 is in the wrong folder, or step 3 was skipped. Run `cd ..` until you are in the main folder, and redo step 3 if needed. |
| `Port 5173 is in use` or `address already in use` | The project (or another program) is already running. Stop the old terminals with Ctrl + C, or close VS Code and open it again. |
| The page is blank, or sign-in fails with an "api-key" error | `frontend\.env.local` is missing or has the wrong values (step 4). Stop Terminal 2 with Ctrl + C and run `npm run dev` again after fixing it. |
| Sign-in works, but the site says it cannot reach the server | Terminal 1 is not running, or `FIREBASE_PROJECT_ID` doesn't match the project in `.env.local`. Restart Terminal 1 with the step 5 command. |
| A `UserWarning` about ISO8601 appears in Terminal 1 | Harmless. Ignore it. |

### On macOS or Linux

Use the built-in Terminal app (or VS Code's terminal) and these commands instead of the PowerShell ones above. Your Python may be called `python3`.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cd frontend && npm install && cd ..
```

Start the backend:

```bash
FIREBASE_PROJECT_ID=replaysemantics PYTHONPATH=src .venv/bin/python -m uvicorn api.app:app --port 8000
```

Start the website in a second terminal:

```bash
cd frontend
npm run dev
```

### Advanced options

- To run the backend on another address, set `VITE_API_BASE_URL` in `frontend\.env.local`.
- If the website runs on a port other than 5173, start the backend with `$env:REPLAY_CORS_ORIGINS="http://localhost:<port>"` added to the step 5 command, so the backend accepts requests from it.
- Adding `--reload` to the backend command restarts it automatically whenever you change the Python code.

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
