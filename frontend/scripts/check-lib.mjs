// Plain-Node checks for the pure UI logic (src/lib/verdict.js) -- no test runner needed:
//   node scripts/check-lib.mjs                      # built-in samples
//   node scripts/check-lib.mjs payloads.json        # + real API payloads (see below)
// payloads.json = { "<case_id>": <GET /api/cases/{id}/replay response>, ... }
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  badgeStatus, buildNodeStatus, isApplicable, pairDetails, pairSentence, subsetRows, traceSteps, correctionLabel,
} from '../src/lib/verdict.js'

let checks = 0
const ok = (cond, msg) => { assert.ok(cond, msg); checks++ }
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++ }

// ---- built-in samples ----------------------------------------------------------------------
eq(badgeStatus('POLICY_ORDERED'), 'POLICY-ORDERED')
eq(badgeStatus('BLOCKED'), 'BLOCKED')
eq(badgeStatus('nonsense'), null)
eq(correctionLabel('discount_correction'), 'discount')
eq(correctionLabel(null), null)

const vbfa = { stage_5_verdict: { status: 'not_applicable', message: 'n/a' } }
ok(!isApplicable(vbfa) && !isApplicable(null))
eq(buildNodeStatus(vbfa), null, 'real VBFA data gets no verdict colouring')
eq(pairDetails(vbfa), [])
eq(subsetRows(vbfa), [])

const sample = {
  stage_3_confluence_checks: { status: 'complete', subsets: [
    { key: 'e1,e2', subset: ['e1', 'e2'], verdict: 'BLOCKED', agree: false, order_used: null },
    { key: '', subset: [], verdict: 'PASS', agree: true, order_used: [] },
    { key: 'e1', subset: ['e1'], verdict: 'PASS', agree: true, order_used: ['e1'] },
  ] },
  stage_4_policy_resolution: { pair_details: [
    { a: 'e1', b: 'e2', status: 'blocked', reason_code: 'ORDERS_DISAGREE_NO_POLICY_ORDER', policy_first: null },
    { a: 'e2', b: 'e3', status: 'policy_ordered', policy_first: 'e2' },
  ] },
  stage_5_verdict: { status: 'complete', coalition_values: { '': '0', e1: '5.00', 'e1,e2': null } },
  node_status: [
    { event_id: 'e1', role: 'effective', correction_id: 'discount_correction', order_sensitive_with: ['e2'] },
    { event_id: 'e2', role: 'effective', correction_id: 'tax_correction', order_sensitive_with: ['e1', 'e3'] },
    { event_id: 'e3', role: 'effective', correction_id: 'rounding_correction', order_sensitive_with: ['e2'] },
    { event_id: 'e4', role: 'effective', correction_id: 'price_correction', order_sensitive_with: [] },
    { event_id: 'e5', role: 'exempt', correction_id: 'discount_correction', order_sensitive_with: [] },
    { event_id: 'c1', role: 'context', correction_id: null, order_sensitive_with: [] },
  ],
}
const ns = buildNodeStatus(sample)
eq(Object.fromEntries(Object.entries(ns).map(([k, v]) => [k, v.kind])),
  { e1: 'blocked', e2: 'blocked', e3: 'ordered', e4: 'independent', e5: 'exempt', c1: 'context' },
  'a node in any blocked pair is blocked, even if another of its pairs is policy-ordered')
const rows = subsetRows(sample)
eq(rows.map((r) => r.key), ['', 'e1', 'e1,e2'], 'subsets sorted by size')
eq(rows.map((r) => r.value), ['0', '5.00', null], 'BLOCKED subset keeps value null (never a number)')
ok(pairSentence(sample.stage_4_policy_resolution.pair_details[0], ns).includes('no rule'))
ok(pairSentence(sample.stage_4_policy_resolution.pair_details[1], ns).includes('applies e2 first'))

const steps = traceSteps({ observed_net: '10', trace: [
  { index: 0, node_id: 'e1', net_after: '12', applied: true, changed: [{}] },
  { index: 1, node_id: 'e2', net_after: '12', applied: false, noop_reason: 'exempt', changed: [] },
] })
eq(steps.map((s) => [s.index, s.nodeId, s.net]), [[0, null, '10'], [1, 'e1', '12'], [2, 'e2', '12']])
eq(traceSteps(null), [])

// ---- real payloads from the backend ---------------------------------------------------------
if (process.argv[2]) {
  const payloads = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  let blocked = 0, ordered = 0, pass = 0, vb = 0
  for (const [cid, r] of Object.entries(payloads)) {
    if (!isApplicable(r)) { vb++; eq(buildNodeStatus(r), null, cid); continue }
    const st = buildNodeStatus(r)
    const v = r.stage_5_verdict
    const kinds = new Set(Object.values(st).map((x) => x.kind))
    ok(Object.keys(st).length === r.node_status.length, `${cid}: every node classified`)
    ok(badgeStatus(v.classification), `${cid}: known verdict`)
    // colouring must agree with the case verdict
    eq(kinds.has('blocked'), v.classification === 'BLOCKED', `${cid}: blocked nodes iff BLOCKED`)
    if (v.classification === 'POLICY_ORDERED') ok(kinds.has('ordered'), `${cid}: ordered nodes`)
    if (v.classification === 'PASS') ok(!kinds.has('ordered') && !kinds.has('blocked'), `${cid}: PASS has no sensitive nodes`)
    // pairs: every sentence renders; BLOCKED subsets never carry a number
    for (const p of pairDetails(r)) ok(pairSentence(p, st).length > 20, `${cid}: sentence`)
    for (const row of subsetRows(r)) ok((row.verdict === 'BLOCKED') === (row.value === null), `${cid}/${row.key}: value iff not BLOCKED`)
    const t = traceSteps(v.replay_of_all_corrections)
    ok(t.length >= 2 && t[0].net === v.replay_of_all_corrections.observed_net, `${cid}: trace starts at observed`)
    if (v.replay_of_all_corrections.order_is_authoritative) ok(v.replay_of_all_corrections.reaches_compliant_net, `${cid}: authoritative replay reaches compliant net`)
    if (v.classification === 'BLOCKED') blocked++; else if (v.classification === 'POLICY_ORDERED') ordered++; else pass++
  }
  console.log(`real payloads: ${blocked} BLOCKED, ${ordered} POLICY_ORDERED, ${pass} PASS, ${vb} real VBFA`)
}
console.log(`lib checks passed (${checks} assertions)`)
