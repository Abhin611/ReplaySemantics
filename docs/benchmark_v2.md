# Benchmark v2 and the Replay Analysis view

## 1. The idea in one paragraph
In the frozen money domain a loss can only come from two places. A wrong **input** (unit price, quantity, FX rate, a manual
adjustment) is fixed by *editing* it, after which one cascade recomputes every dependent. A stale **posted amount** (the stored
result on a discount, tax or rounding document) is fixed by *re-deriving* it, and when two such documents interact the **order**
of re-deriving changes the total. The corrected ledger C is the observed case with every non-exempt input restored and every
posted amount left as posted. Everything in the new view is read off C.

## 2. Resolution classes (computed by the system AND by the independent oracle)
Let P = active, non-exempt discount / tax / rounding nodes. A pair (a, b) in P is **swappable** when the log does not lock it
(locks are transitively closed over *all* reachable events, then restricted) and re-deriving a-then-b vs b-then-a from C gives
different totals. It is **authoritative** when the policy orders it (rule ids reported), otherwise **BLOCKED**.

| class | condition |
|---|---|
| SWAP_ONLY | swappable pair exists, no wrong input |
| BOTH | swappable pair exists and at least one wrong input |
| MULTI_EDIT_ONLY | no swappable pair, wrong input(s) (or locked posted nodes) |
| DIRECT_FIX | no swappable pair, no wrong input, a stale posted node |

`blocked` is a flag on a case: some swappable pair (or subset) the policy cannot order. Loss split: `loss_from_stale_amounts`
= Loss(C) (what only re-deriving posted amounts removes); `loss_from_inputs` = Loss(observed) - Loss(C).

## 3. The 54-case matrix, and the 6 larger cases
| | 1 hop | 2 | 3 | 4 | 5 | total |
|---|---|---|---|---|---|---|
| Direct fix | 4 | | | | | 4 |
| Swap only | | 4 | 3 | 2 | 1 | 10 |
| Multi-edit only | | 5 | 6 | 2 | 1 | 14 |
| Both | | 11 | 12 | 2 | 1 | 26 |
| **total** | 4 | 20 | 21 | 6 | 3 | 54 |

BLOCKED: 3 swap-only + 6 both = 9 (policy -002: 5 cases, partly resolved; policy -003: 4 cases, nothing resolves).
Policies: -001 45 cases, -002 5, -003 4. Multi-edit cases keep the attribution demos (single, independent, interaction,
redundancy, exception) and add locked posted-node chains with a deep price.

Six larger cases follow the matrix (`LARGE_SPECS`), two per case-level verdict. Their ids come last, so cases 1-54 are unchanged.

| case | verdict | candidate events | correctable | deepest correctable hop | policy |
|---|---|---|---|---|---|
| RSC-2026-00055 | PASS | 12 | 4 adjustments (interaction) | 4 | -001 |
| RSC-2026-00056 | PASS | 15 | 5 adjustments (independent) | 3 | -001 |
| RSC-2026-00057 | POLICY-ORDERED | 13 | discount, tax, rounding | 3 | -001 |
| RSC-2026-00058 | POLICY-ORDERED | 15 | 2 discounts, tax, rounding, price, currency | 4 | -001 |
| RSC-2026-00059 | BLOCKED | 14 | discount, tax, rounding | 3 | -003 |
| RSC-2026-00060 | BLOCKED | 15 | discount, tax, rounding, quantity, currency | 4 | -002 |

The rest of each case is context events. The money model allows one tax, rounding, price, quantity and currency event, and
the oracle's soft cap is 7 correctable events (the checker's limit is 10), so 15 events cannot all move money. Context events
still make the traversal, the graph and the order constraints larger.
Depth comes from chains of context events (they move no money), so the graph grows deep, not wide. A "hop" is one step through a
linked document; the deepest *correctable* event defines a case's depth. `generate_matrix_benchmark` fails loudly if any quota is missed.

## 4. Limits (all cases)
`min_events` (warn only), `max_events` (none by default), `max_hops` (3 by default). The default therefore does not see 4- and
5-hop events: the result is marked **partial** and says what to raise. A case's public `suggested_max_hops` (read off the public
log) is a hint; only the scoring harness applies it, explicitly. Completeness uses only public data: no correctable event may be
dropped or lie beyond `max_hops`, and the kept events must explain the case's stated realised loss.

## 5. Limitations
* The oracle (`reference_sim.py`) is written by the same team, so 100% means agreement with that model, not real-world truth.
* The domain is small (7 correction types) and the arithmetic basic by design; a tiered discount / cap would be the next rule.
* The exact checker is exponential in correctable events (10 is the refusal limit); real SAP events (20 candidates) have no
  pricing fields and stop at stages 1-2b.
* "Swappable" is defined on the pair alone, starting from C; a pair that only disagrees in the presence of a third node is
  still caught by the subset summary, not by the pair list.
* Multi-hop depth is built with context events, which makes deep graphs possible but synthetic.
* Shapley (still the provisional exact routine) is intentionally outside the new view.
