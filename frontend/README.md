# ReplaySemantics — Frontend

React + Vite frontend for the ReplaySemantics capstone, built from the Figma
prototype (`fresco-finite-40597007.figma.site`) and wired to the real
FastAPI backend (`src/api/app.py`) wherever that backend actually exists.

This is a clean rebuild, not a port of `webapp/index.html` — different
stack (React Router + Tailwind + React Flow + Recharts instead of vanilla
JS + vis-network), and it covers all 8 screens from the Figma design instead
of just the Replay Console.

## What's real vs. preview

Every screen either calls your live pipeline or is clearly tagged as
preview data. Nothing pretends to be real when it isn't — same rule your
`app.py` already follows for stages 3–5.

| Screen | Data source |
|---|---|
| **Dashboard** | Real (`/api/dashboard`, `/api/cases`). "Pending Review" / "Blocked Attributions" stat cards are tagged preview — they need the Month 4 confluence checker. |
| **Cases** | Real case list and values (`/api/cases`). Status / Policy Version columns are tagged preview (deterministic pseudo-verdict, not a real classification). |
| **Replay Console** | Real. Calls `/api/cases/{id}/replay`, renders Stage 1 (Extraction) and Stage 2 (Candidate Identification) output and the real candidate graph. Stages 3–5 show the backend's own `"not_implemented"` message. Legend items beyond "Idle" are tagged preview since no verdict classifier exists yet. |
| **Replay Graph** | Same real graph data as Replay Console, standalone view + Node Inspector. Verdict badge/colors are tagged preview. |
| **Attribution** | Full preview — Shapley engine is Month 5 / Member 3, not built. Page is shaped to match the eventual API response so swapping in the real endpoint later is a data-source change, not a redesign. |
| **Policies** | Full preview — Member 2's policy engine is in progress. |
| **Audit Log** | Full preview — no auth/event-sourcing layer exists yet. |
| **Settings** | Full preview — no user-management backend exists yet. |

Every preview element carries a small `PREVIEW` badge in the UI
(`src/components/PreviewTag.jsx`) so it's never mistaken for a live result.
All preview content lives in one file: `src/data/mockData.js`.

## Running it

```bash
# 1. Backend (from the ReplaySemantics repo root)
cd ReplaySemantics
$env:PYTHONPATH="src"          # PowerShell
uvicorn api.app:app --reload --port 8000

# 2. Frontend (this folder)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The frontend expects the backend at
`http://localhost:8000` by default — copy `.env.example` to `.env` and set
`VITE_API_BASE_URL` if you run it elsewhere. If the backend isn't running,
every real-data screen shows a clear "couldn't reach the backend" message
instead of failing silently.

`npm run build` produces a production bundle in `dist/`.

## Structure

```
src/
├── lib/
│   ├── api.js                 — the ONLY file that talks to the backend; one
│   │                            function per real endpoint
│   ├── useApi.js               — loading/error/refetch hook for the api.js calls
│   ├── format.js                — currency/date formatting
│   └── SelectedCaseContext.jsx  — shares the selected case across
│                                  Replay Console / Replay Graph / Attribution
├── data/
│   └── mockData.js              — ALL preview/mock data lives here, nowhere else
├── components/
│   ├── Sidebar.jsx, TopBar.jsx, AppLayout.jsx
│   ├── Card.jsx, StatCard.jsx, StatusBadge.jsx
│   ├── PreviewTag.jsx           — the "this is mock data" badge
│   └── StatusStates.jsx         — Loading / Error / Empty states
└── pages/
    ├── Dashboard.jsx, Cases.jsx
    ├── ReplayConsole.jsx, ReplayGraph.jsx   — React Flow graphs
    ├── Attribution.jsx                      — Recharts bar chart
    ├── Policies.jsx, AuditLog.jsx, Settings.jsx
```

## As the real backend grows

- **Month 4 (confluence checker)**: once `/api/cases/{id}/replay` returns
  real `status` values per node instead of `"idle"`, delete
  `previewStatusFor()` / `previewPolicyVersionFor()` calls in `Dashboard.jsx`,
  `Cases.jsx`, and `ReplayGraph.jsx`, and read `node.status` /
  `result.stage_3_confluence_checks` directly.
- **Month 5 (Shapley attribution)**: once a real attribution endpoint
  exists, replace `mockAttributionFor()` in `Attribution.jsx` with a call
  through `src/lib/api.js`, keeping the same `{event, activity, phi,
  inCoalition, loss}` row shape so the chart and table don't need to change.
- **Policies / Audit Log / Settings**: same pattern — build the real
  endpoint to return the shape already consumed from `mockData.js`, then
  swap the import for an `api.js` call.
