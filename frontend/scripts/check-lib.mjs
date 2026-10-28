// Plain-Node checks for the pure UI logic (src/lib/verdict.js) -- no test runner needed:
//   node scripts/check-lib.mjs                      # built-in samples
//   node scripts/check-lib.mjs payloads.json        # + real API payloads (see below)
// payloads.json = { "<case_id>": <GET /api/cases/{id}/replay response>, ... }
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  badgeStatus, buildNodeStatus, isApplicable, pairDetails, pairSentence, subsetRows, traceSteps, correctionLabel, observedExplanation,
} from '../src/lib/verdict.js'
import {
  scenarioPath, parseScenarioParams, formatPrecise, formatSigned, direction, shapleyRows, orderLabel,
  unionEvents, togglePair, samePair, MAX_SCENARIO_EVENTS,
} from '../src/lib/scenario.js'

let checks = 0
const ok = (cond, msg) => { assert.ok(cond, msg); checks++ }
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++ }

// ---- built-in samples ----------------------------------------------------------------------
eq(badgeStatus('POLICY_ORDERED'), 'POLICY-ORDERED')
eq(badgeStatus('BLOCKED'), 'BLOCKED')
eq(badgeStatus('nonsense'), null)
eq(correctionLabel('discount_correction'), 'discount')
eq(correctionLabel(null), null)

// Stage 0 description: zero parts and fx 1 are left out; missing breakdown falls back
const bd = { gross: '100', discount: '10', tax: '9', fx_rate: '1', adjustment: '0', rounding_adj: '-0.1', net: '98.9' }
const txt = observedExplanation(bd, (x) => String(x))
ok(txt.includes('Gross value 100') && txt.includes('less discounts 10') && txt.includes('plus tax 9'), 'stage 0 text names the parts')
ok(txt.includes('less posted rounding 0.1') && !txt.includes('fx rate') && !txt.includes('adjustments'), 'zero / identity parts omitted')
ok(observedExplanation({ ...bd, fx_rate: '1.25', adjustment: '2' }).includes('fx rate 1.25'), 'fx shown when not 1')
ok(observedExplanation(undefined).startsWith('The case total exactly as it was posted'), 'fallback without breakdown')

// traceSteps carries the written-out calculation of every stage
const calcReplay = { observed_net: '10', observed_calculation: { rows: [{ key: 'net', value: '10' }] },
  trace: [{ node_id: 'e1', net_after: '12', applied: true, changed: [], calculation: { rows: [{ key: 'net', value: '12' }] } }] }
const cs = traceSteps(calcReplay)
ok(cs[0].calculation.rows[0].value === '10' && cs[1].calculation.rows[0].value === '12', 'steps carry their calculation')

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

// ---- scenario helpers ---------------------------------------------------------------------
eq(scenarioPath('RSC-1', ['e2', 'e1']), '/scenario?case=RSC-1&subset=e1%2Ce2')
eq(scenarioPath('RSC-1', ['e1', 'e2'], ['e2', 'e1']), '/scenario?case=RSC-1&subset=e1%2Ce2&order=e2%2Ce1')
{
  const parsed = parseScenarioParams(new URLSearchParams('case=RSC-1&subset=e1,e2&order=e2,e1'))
  eq(parsed, { caseId: 'RSC-1', subset: ['e1', 'e2'], order: ['e2', 'e1'] })
  eq(parseScenarioParams(new URLSearchParams('')), { caseId: null, subset: [], order: [] })
  // the path the console builds round-trips through the page's parser
  const rt = parseScenarioParams(new URLSearchParams(scenarioPath('RSC-9', ['e3', 'e1']).split('?')[1]))
  eq(rt, { caseId: 'RSC-9', subset: ['e1', 'e3'], order: [] })
}
eq(orderLabel(['e1', 'e2']), 'e1 → e2')
eq(formatPrecise('1234567.5'), '1,234,567.50')
eq(formatPrecise('0.0023928960'), '0.002393', 'sub-cent amounts are never rounded to 0.00')
eq(formatPrecise('0'), '0.00')
eq(formatPrecise(null), '—')
eq(formatSigned('-176650.94'), '−176,650.94')
eq(formatSigned('20850.6'), '+20,850.60')
eq(formatSigned('0.000'), '0.00')
eq([direction('-1'), direction('2'), direction('0')], ['down', 'up', 'flat'])
{
  const rows = shapleyRows({ status: 'ok', v_of_subset: '100', values: { e1: '25', e2: '75' } })
  eq(rows.map((r) => [r.id, r.share]), [['e2', 0.75], ['e1', 0.25]], 'largest share first')
  eq(shapleyRows({ status: 'withheld', values: null }), [], 'withheld Shapley yields no rows')
  eq(shapleyRows(null), [])
}
const tl = traceSteps({ observed_net: '10', observed_loss: '5', trace: [{ index: 0, node_id: 'e1', net_after: '12', loss_after: '3', changed: [], applied: true }] })
eq(tl.map((x) => x.loss), ['5', '3'], 'step losses carried through when the payload has them')
eq(traceSteps({ observed_net: '10', trace: [{ index: 0, node_id: 'e1', net_after: '12', changed: [], applied: true }] }).map((x) => x.loss), [null, null])

// ---- selecting several pairs ----------------------------------------------------------------
{
  const p12 = { a: 'e1', b: 'e2' }, p23 = { a: 'e2', b: 'e3' }, p45 = { a: 'e4', b: 'e5' }
  eq(unionEvents([]), [], 'no pairs -> no events')
  eq(unionEvents([p12]), ['e1', 'e2'])
  eq(unionEvents([p12, p23]), ['e1', 'e2', 'e3'], 'a shared event is counted once')
  eq(unionEvents([p45, p12]), ['e1', 'e2', 'e4', 'e5'], 'sorted')
  eq(unionEvents(undefined), [])
  ok(samePair(p12, { a: 'e1', b: 'e2', extra: 1 }) && !samePair(p12, p23))
  eq(togglePair([], p12), [p12], 'toggle adds')
  eq(togglePair([p12, p23], p12), [p23], 'toggle removes')
  eq(togglePair([p12], p23), [p12, p23], 'toggle keeps others')
  eq(MAX_SCENARIO_EVENTS, 6, 'mirrors the backend cap (src/replay_core/scenario.py)')
  // the path the console builds for a multi-pair run round-trips through the page's parser
  const path = scenarioPath('RSC-9', unionEvents([p23, p12]))
  eq(parseScenarioParams(new URLSearchParams(path.split('?')[1])).subset, ['e1', 'e2', 'e3'])
}

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
