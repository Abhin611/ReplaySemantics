# Replay flow redesign - changed / new files only

> Historical note for this one update. Its counts are from that time; see README.md for the current state.

Copy this zip's contents over the project (same paths), then `cd frontend && npm run build` (or `npm run dev`).

1-4, 9  Every node lists the values it holds (recorded OCEL facts: time, objects, attributes). A new start node REF shows the
        fixed case values (contract unit price, quantity, tax rate, FX, authorised discount rates, rounding rule); the net node
        says which of these and which events its price / quantity / tax come from.
5       Scenario / Run change work on the corrected ledger: a swap only re-derives posted amounts; input values never change
        unless YOU edit them.
6       The 422 "'e5' is not a correctable event" is fixed: the scenario runs on the ledger view and carries the graph limits in the URL.
7       The first run draws the ENTIRE graph (max hops, min_events = max_events). Narrow it afterwards.
8       "swap only / edit only / both" wording removed. Edit button on every case; Run change runs after all your edits.
10      New console flow: OCEL table -> nodes appear row by row -> stages on one line -> locked / permutable tabs -> replay strip ->
        verdict / pairs / events / rules / stages tabs. Node click opens a popover. Edit button bottom-right of the graph.
        During the animation only Skip / Refresh / speed are available; the page scrolls itself when it ends.
        Scenario and Analysis pages reworked.
Tests: 248 passed (pytest); 85 assertions (node scripts/check-lib.mjs).
