# Changes in this drop (benchmark v2 + Replay Analysis)

> Historical note for this one update. Its counts are from that time; see README.md for the current state.

See docs/benchmark_v2.md for the design.

## New files
- docs/benchmark_v2.md
- frontend/src/components/PropagationReport.jsx
- frontend/src/lib/ledger.js
- frontend/src/pages/Ledger.jsx
- src/replay_core/influence.py
- src/replay_core/ledger.py
- src/replay_core/limits.py
- tests/test_influence.py
- tests/test_ledger.py
- tests/test_limits.py
- tests/test_matrix_benchmark.py
- tests/test_multihop.py

## Changed files
- README.md
- docs/benchmark_results.json
- frontend/scripts/check-lib.mjs
- frontend/src/App.jsx
- frontend/src/components/TopNav.jsx
- frontend/src/components/graph/EventNode.jsx
- frontend/src/index.css
- frontend/src/lib/api.js
- frontend/src/lib/graphLayout.js
- frontend/src/lib/scenario.js
- frontend/src/pages/Cases.jsx
- frontend/src/pages/ReplayConsole.jsx
- frontend/src/pages/Scenario.jsx
- src/api/app.py
- src/policy_engine/benchmark/evaluate.py
- src/policy_engine/benchmark/generator.py
- src/policy_engine/benchmark/reference_sim.py
- src/replay_core/benchmark_io.py
- src/replay_core/candidate_extraction.py
- src/replay_core/confluence.py
- src/replay_core/run_case.py
- src/replay_core/scenario.py

## Data
- data/benchmark/ regenerated: 54 cases (was 140); docs/benchmark_results.json re-scored; docs/screenshots/ added

## After unzipping
    $env:PYTHONPATH="src"; python -m pytest
    cd frontend; npm install; node scripts/check-lib.mjs; npm run dev
