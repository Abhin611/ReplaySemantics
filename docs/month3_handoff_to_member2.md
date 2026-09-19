# Month 3 handoff: Member 1 -> Member 2 (Ashwathy)

This is the contract Member 1's Month 3 work depends on. It covers three
things: two are ready now (no action needed from you until you touch
policy.json anyway), one is the actual blocker on the replay operator
and needs your input before I can build against it.

---

## 1. `given_constraints` -- ready now, just merge it in

`constraint_extraction.py` (Month 2 addition) now runs automatically as
part of `/api/cases/{case_id}/replay` (`stage_2b_constraint_extraction`
in the response) and is also exportable standalone via
`export_constraints()` in the same module.

For a given target event, it produces two lists:

- `given_constraints`: pairs of candidate events where the log itself
  already fixes an order (they share an object and have different
  timestamps). Shape:

  ```json
  {"before": "e966", "after": "e977", "shared_object": "0000019222", "reason": "structural_precedence"}
  ```

  Please treat these as hard rules alongside your own policy-authored
  canonical orderings (your Month 4 POLICY-ORDERED work) -- they're
  structural, not policy-authored, so they don't need a policy version
  bump and should never be overridden by a policy rule.

- `permutable_pairs`: everything else -- pairs with no structural
  order-lock between them. This is the list your Month 4
  order-behaviour testing (and my confluence checker) should actually
  run against, instead of every candidate pair.

**One thing to flag for your defense/write-up too, not just mine:**
this does *not* solve order-invariance. A permutable pair can still be
BLOCKED at Month 4 because the correction *math* doesn't commute (the
rounding/currency/tax example). This module only narrows which pairs
need testing -- keep that distinction explicit wherever this gets
described.

---

## 2. `remediation_cost` field -- small policy schema addition

For the Month 5/6 cost-constrained coalition highlighting Rohit's
building (best-K-under-budget over the coalition table), each
correction type in your policy schema needs a cost value. Simplest
version, and the one I'd recommend for a capstone: an integer cost of
1 per correction (turns the optimization into "best K-out-of-N"
instead of requiring you to justify real rupee/hour costs). Whenever
you're next touching policy.json's schema, add:

```json
{
  "correction_id": "discount_correction",
  "remediation_cost": 1
}
```

No rush on this -- Rohit doesn't need it until Month 5.

---

## 3. Transfer-function interface -- this is the actual blocker

This is the one I need from you before I can build
`propagate_multi()` (the multi-node edit/cascade feature, Month 3).

**Current state:** your correction functions `c(e_i)` are triggered
*by policy* -- given an event, apply the one correction the policy
says applies to it. That's enough for the standard replay path.

**What's new:** the manual multi-node edit feature (Rohit's UI, Month
4) needs to let someone override a field on any candidate event and
see the change cascade to every event downstream of it -- not just
apply a pre-defined correction, but recompute *any* affected node's
state given upstream inputs.

To make that cascade mechanical (a topological walk I can write once
this exists), each event type in the frozen domain
(Gross -> Discount -> Tax -> Net) needs a function with this shape:

```python
def transfer_function(node_id: str, inputs: dict, graph_context) -> dict:
    """
    inputs: the current attribute dict of every upstream node this
            node depends on (already recomputed if they were edited
            or are themselves downstream of an edit).
    Returns: the updated attribute dict for `node_id` -- at minimum
             whatever field(s) the frozen domain tracks (gross,
             discount, tax, net), recomputed from `inputs`.
    """
```

This is a generalization of what you're already building for the
frozen domain, not a separate system -- the existing correction
function *is* a transfer function whose only input is the node's own
prior state. I just need every event type to expose one with this
signature (or close to it -- happy to adjust to whatever's natural
given how you've structured the correction functions so far) so my
cascade code has one thing to call regardless of event type.

**What I'll build once I have this:** a `propagate_multi(graph,
overrides: dict[str, dict])` that topologically sorts the union of
descendants of every edited node and calls your transfer function
once per node in order -- so two edits that both feed the same
downstream node get combined correctly in a single pass, not
overwritten by whichever edit was applied last.

**Suggested next step:** even a stub version of this (fixed
signature, returns the node's attributes unchanged) is enough for me
to start on the cascade logic in parallel with you filling in the
real math -- same pattern as the Month 3 replay-operator handoff we
already used.
