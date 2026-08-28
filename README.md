# ReplaySemantics — Member 1 Track (Graph & Replay Core)

**Team No. 20** · Abhin Anoop (204) · Ashwathy J Ajith (222) · Rohit Ajoy (255)
Guide: Asst. Professor Remya · Dept. of CSE

This is Abhin's (Member 1) portion of the ReplaySemantics capstone: the
**OCEL 2.0 ingestion pipeline → object-centric graph → replay operator →
confluence checker**, per the project roadmap (M1–M5).

## Seeing it live: a real backend + demo frontend for your Figma design

Your Figma prototype (fresco-finite-...figma.site) is a static click-through
mockup — it can't call Python. `src/api/app.py` + `webapp/index.html` bridge
that gap: a small FastAPI backend wraps the real Month 1-2 pipeline, and a
minimal coded frontend (styled after your Figma screens) calls it.

**What's real vs. stubbed:** Stage 1 (Extraction) and Stage 2 (Candidate
Identification) run your actual ingestion + graph + backward-traversal code
against the real VBFA dataset. Stages 3-5 (Confluence Checks / Policy
Resolution / Verdict) honestly report `not_implemented` — they depend on
your Month 3-4 work and Member 2's correction functions.

Run it:
```bash
pip install -r requirements.txt
cd ReplaySemantics
PYTHONPATH=src uvicorn api.app:app --reload --port 8000
```
Open **http://localhost:8000** — Dashboard shows real aggregate stats
(events/objects/case count/value, computed live, not the Figma mock
numbers). Cases lists real invoice-line events from the log. Replay Console
lets you pick a case and click **Run Replay** — it actually calls
`extract_candidate_events()` and renders the real candidates found.

Try case `e34` (a real €802,800 / ~₹7.4 Cr invoice line) for a rich example.

Bringing this into your actual Figma-designed UI (once Confluence Checks /
Policy Resolution exist) means either: (a) exporting/rebuilding the Figma
screens as React components that fetch from this same API, or (b) keeping
this API and writing a proper frontend against it later. Either way, this
API is the seam — every screen in your Figma file maps to one of its
endpoints (`/api/dashboard`, `/api/cases`, `/api/cases/{id}/replay`).

## Status: Month 2 — Core Build I ✅

Built and tested on top of Month 1:

- **`src/replay_core/graph.py`** — `ObjectCentricGraph`: a bipartite
  event↔object graph (via networkx) built directly from an
  `ObjectCentricLog`. No object-object edges are synthesized; every
  higher-level query (an object's chronological event history, events on
  an object before a given time, etc.) is derived from this single
  event-to-object relation graph, which is the actual structure OCEL 2.0
  guarantees.
- **`src/replay_core/candidate_extraction.py`** — implements **Objective 1**
  from the proposal: bounded backward traversal from a target ("realized
  loss") event, producing the candidate event set `E` (size 3–8) that
  Member 2's correction functions will operate on. Ranking is recency +
  a deterministic tie-break (event id), with a documented seam for
  swapping in a policy-aware scorer later.
- **16 new tests** (10 → 26 total), including a real, non-trivial case
  pulled from the VBFA dataset where backward traversal legitimately
  crosses from an Order's Goods-Movement history into a *different*
  object's (a Delivery's) event history at hop 1 — genuine multi-hop,
  object-centric behavior, not single-object lookback.

### Worked example (real data, not synthetic)

Target event `e977` — an Invoice line (`Create Invoice (from Order)`,
€2,679.20) on Order `0000019222` / Invoice `0090040516`. Backward traversal
finds 20 candidate events across 3 hops (10 Goods Movements on the Order,
then a cross-object jump into Delivery `0080018999`'s own history), bounded
down to the top 8 most recent for the actual candidate set. Reproduce with:

```bash
PYTHONPATH=src python3 -m replay_core.candidate_extraction \
  data/raw/vbfa_o2c_2019_2021_eur.jsonocel e977 --max-events 8
```

## Status: Month 1 — Foundation ✅

Built and tested:

- **`src/replay_core/ingestion.py`** — loads OCEL 2.0 logs (`.jsonocel`,
  `.xmlocel`, `.sqlite`, `.csv`) via pm4py, structurally validates them
  (dangling relations, null ids/timestamps, orphan events), and converts to
  a framework-agnostic internal representation.
- **`src/replay_core/models.py`** — plain dataclasses (`OCELEvent`,
  `OCELObject`, `E2ORelation`, `ObjectCentricLog`) that every later stage
  (graph construction, replay operator, confluence checker) builds on, with
  no pm4py dependency leaking downstream.
- **`src/replay_core/export.py`** — writes flat `events.csv` / `objects.csv`
  / `relations.csv` / `summary.json` to `data/processed/`, so Member 2
  (policy/correction functions) and Member 3 (evidence schema) can start
  their own work without needing pm4py installed.
- **`tests/test_ingestion.py`** — 10 unit tests, all passing.

### Sample dataset

`data/raw/ocel20_example.*` — the canonical OCEL 2.0 example log (a small
Procure-to-Pay case: Purchase Requisition → Purchase Order → Invoice →
Payment, with a payment-block/unblock cycle), pulled from pm4py's own test
suite. 13 events, 9 objects, 4 object types. Good for pipeline development;
swap in a real/larger OCEL 2.0 dataset once one is chosen for the
hidden-generative benchmark (Month 5, Member 2's track).

## Usage

```bash
pip install -r requirements.txt

# Ingest + print summary
PYTHONPATH=src python3 -m replay_core.ingestion data/raw/ocel20_example.jsonocel

# Ingest + export processed CSVs for teammates
PYTHONPATH=src python3 -m replay_core.export data/raw/ocel20_example.jsonocel --out data/processed

# Run tests
PYTHONPATH=src pytest tests/ -v
```

```python
from replay_core import load_ocel

log = load_ocel("data/raw/ocel20_example.jsonocel")
print(log.summary())
log.events_for_object("PR1")   # all events touching Purchase Requisition PR1, time-ordered
```

## Repo layout

```
ReplaySemantics/
├── data/
│   ├── raw/            # source OCEL 2.0 files (not modified)
│   │   └── vbfa/       # raw SAP VBFA export (real large-scale O2C data)
│   └── processed/      # flat CSV exports for teammates
├── src/replay_core/
│   ├── models.py             # ObjectCentricLog, OCELEvent, OCELObject, E2ORelation
│   ├── ingestion.py           # load_ocel(), validate_ocel()
│   ├── export.py              # export_processed()
│   ├── vbfa_converter.py      # SAP VBFA -> OCEL 2.0 converter
│   ├── graph.py               # ObjectCentricGraph (bipartite event<->object graph)
│   └── candidate_extraction.py  # extract_candidate_events() -- backward traversal
├── tests/
│   ├── test_ingestion.py
│   ├── test_graph.py
│   └── test_candidate_extraction.py
├── pytest.ini
└── requirements.txt
```

## Next up (Month 3 — Core Build II)

- Replay operator `R_P(X,S)`: given the candidate set `E` and Member 2's
  correction functions `c(eᵢ)`, recompute financial state under any subset
  `S ⊆ E` of applied corrections.
- Idempotence checks: applying the same correction twice should not change
  the result further.
