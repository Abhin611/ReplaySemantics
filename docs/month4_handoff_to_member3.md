# Handoff to Rohit (Member 3): what the confluence checker gives your attribution layer

Everything below is live for the synthetic benchmark cases (`RSC-...`). Real VBFA cases have no stages 3-5.

## The one rule
**Shapley is computed only when `attribution_allowed` is true** (no subset is BLOCKED). For a BLOCKED case
return `shapley = None` and show the reason codes. `CaseVerdict.prediction(shapley)` already forces this.

## Python
```python
from replay_core.benchmark_io import load_benchmark_case
from replay_core.confluence import ConfluenceChecker

lc = load_benchmark_case("data/benchmark", "RSC-2026-00043")
cv = ConfluenceChecker.from_loaded(lc).check_case()

cv.classification          # "PASS" | "POLICY_ORDERED" | "BLOCKED"  (worst subset)
cv.attribution_allowed     # False iff BLOCKED
cv.players                 # the Shapley players: every correctable candidate (exempt events included, value 0)
cv.coalition_values()      # {"e1,e2": Decimal v(S) or None}  <- YOUR coalition table; key = sorted ids joined by ","; "" = empty set
cv.subsets["e1,e2"]        # SubsetVerdict: verdict, order_used, disagreeing_pairs, resolution (rules, reason codes)
cv.prediction(shapley)     # dict for policy_engine.benchmark.evaluate.score_case
```
`v(S) = Loss(empty) - Loss(R_P(X,S))`, replayed in the authoritative order (`order_used`): the only legal order
for PASS, the policy's order for POLICY_ORDERED, none for BLOCKED. Do not recompute v(S) yourself.

## API (JSON; all Decimals are strings)
* `GET /api/cases/{id}/replay` -> `stage_3_confluence_checks`, `stage_4_policy_resolution`, `stage_5_verdict`
  (`classification`, `attribution_allowed`, `coalition_values`, `shapley` (null until your layer is wired),
  `shapley_status`, `replay_of_all_corrections` with the per-step state trace for the animation),
  plus `node_status` (role + `order_sensitive_with` per event, for graph colouring).
* `POST /api/cases/{id}/edit` -> multi-node edit, one cascade. `GET /api/cases/{id}/state` -> editable fields.
* `replay_of_all_corrections.order_is_authoritative` is false for BLOCKED cases: the trace is illustrative only.

## Things to keep honest in the UI / report
* Synthetic cases are labelled `benchmark (synthetic)`; never show their amounts as EUR.
* "Order-sensitive pairs" are a subset of the "permutable pairs": structure only says an order was not fixed; the
  checker found how many of those pairs really disagree (`stats.pairs_order_sensitive` vs `pairs_tested`).
