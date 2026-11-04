# ReplaySemantics — Frontend

The project's only frontend: React + Vite, with React Router, Tailwind, React Flow and Recharts. It talks to the FastAPI backend in `src/api/`.

## Running it

The backend must be running first, and login needs a Firebase project. Both are covered in the [main README](../README.md#run-it).

```bash
npm install
npm run dev
```

Open http://localhost:5173.

Settings go in `.env.local` (copy `.env.example`): the Firebase web app config, and `VITE_API_BASE_URL` if the backend isn't at `http://localhost:8000`. If the backend isn't running, pages show a "couldn't reach the backend" message.

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Build for production into `dist/` |
| `npm run preview` | Serve the production build |
| `npm run check:lib` | Run the 90 assertions on the page logic in `src/lib/` |

## What's real and what's preview

Every page calls the real backend unless the table says otherwise. Sample data is marked with a `PREVIEW` tag on screen (`src/components/PreviewTag.jsx`), and all of it lives in `src/data/mockData.js`.

| Page | Data |
|---|---|
| Landing, Login, Profile, Load log, History | Real (Firebase and `/api/me`, `/api/logs`, `/api/history`) |
| Dashboard | Real, except the "Pending Review" and "Blocked Attributions" cards, which show fixed numbers |
| Cases | Real (`/api/cases`). Benchmark cases show their verdict; other logs show "stages 1–2b only". |
| Replay Console, Replay Graph | Real (`/api/cases/{id}/replay`) |
| Replay Analysis | Real (`/analysis`, `/pair`, `/change`) |
| Swap Scenario | Real (`/scenario`) |
| Policies | Real (`/api/policies`) |
| Attribution | Preview. The Shapley layer (Member 3) isn't wired in. |
| Audit Log, Settings | Preview |

## Structure

```
src/
├── App.jsx                    routes; the login and active-log guards
├── lib/
│   ├── api.js                 the only file that talks to the backend
│   ├── firebase.js            Firebase setup
│   ├── session.jsx            signed-in user and active log
│   ├── SelectedCaseContext.jsx   selected case, shared across pages
│   ├── useApi.js              loading / error / refetch for api.js calls
│   ├── history.js             recording actions for History and Compare
│   ├── flow.js, graphLayout.js, ledger.js, scenario.js, verdict.js, paymentRoutes.js   page logic
│   ├── useReplaySpeed.js      replay animation speed
│   └── format.js              currency and date formatting
├── data/
│   └── mockData.js            all preview data
├── components/
│   ├── AppLayout.jsx, TopNav.jsx, TopBar.jsx    page frame and navigation
│   ├── LoadLog.jsx            choosing an event log
│   ├── ReplayFlow.jsx, GraphStage.jsx, ReplayStrip.jsx, PipelineTimeline.jsx   the console flow
│   ├── ChangePanel.jsx, PropagationReport.jsx   edits and swaps
│   ├── graph/EventNode.jsx, NodePopover.jsx     graph nodes
│   └── ...                    cards, tabs, status states
└── pages/
    ├── Landing.jsx, Login.jsx, Profile.jsx, History.jsx
    ├── Dashboard.jsx, Cases.jsx
    ├── ReplayConsole.jsx, ReplayGraph.jsx, Ledger.jsx, Scenario.jsx, Policies.jsx
    └── Attribution.jsx, AuditLog.jsx, Settings.jsx      preview pages
```

## Replacing the preview data

When a real endpoint exists, add a function for it in `src/lib/api.js`, then swap the page's `mockData.js` import for that call. For Attribution, keep the `{event, activity, phi, inCoalition, loss}` row shape so the chart and table don't need to change.
