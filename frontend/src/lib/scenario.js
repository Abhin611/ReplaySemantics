// src/lib/scenario.js
//
// Pure helpers (no React) for the "Corrected Scenario" page. The scenario lives entirely in the URL
// (?case=..&subset=e1,e2&order=e2,e1): the backend recomputes it deterministically, nothing is stored,
// so a scenario can be bookmarked, refreshed or shared as a link.

// Mirrors MAX_SCENARIO_EVENTS in src/replay_core/scenario.py: one change may correct at most this many events.
export const MAX_SCENARIO_EVENTS = 6

export const samePair = (p, q) => p.a === q.a && p.b === q.b

// Every distinct event in the chosen pairs, sorted. Pairs may overlap (e1⇄e2 and e2⇄e3 -> e1,e2,e3):
// an event shared by two pairs is corrected once.
export function unionEvents(pairs) {
  return [...new Set((pairs || []).flatMap((p) => [p.a, p.b]))].sort()
}

// Add the pair if absent, remove it if present.
export function togglePair(pairs, pair) {
  return pairs.some((p) => samePair(p, pair)) ? pairs.filter((p) => !samePair(p, pair)) : [...pairs, pair]
}

export function scenarioPath(caseId, subset, order, limits) {
  const p = new URLSearchParams({ case: caseId, subset: [...subset].sort().join(',') })
  if (order && order.length) p.set('order', order.join(','))
  // the candidate-set limits travel with the scenario: without them the page would rebuild the case at the default depth
  if (limits) {
    p.set('max_hops', String(limits.maxHops))
    p.set('min_events', String(limits.minEvents))
    if (limits.maxEvents !== null && limits.maxEvents !== undefined && limits.maxEvents !== '') p.set('max_events', String(limits.maxEvents))
  }
  return `/scenario?${p.toString()}`
}

export function parseScenarioParams(params) {
  const list = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [])
  const num = (k, d) => (params.get(k) ? Number(params.get(k)) : d)
  return {
    caseId: params.get('case') || null, subset: list(params.get('subset')), order: list(params.get('order')),
    limits: params.get('max_hops') ? { maxHops: num('max_hops', 3), minEvents: num('min_events', 3), maxEvents: params.get('max_events') ? Number(params.get('max_events')) : null } : null,
  }
}

export const orderLabel = (order) => (order || []).join(' → ')

// Amounts: normally 2 dp with grouping; a non-zero amount under 0.01 (sub-cent order disagreements
// exist in the benchmark) is shown to up to 6 dp, never rounded to a misleading 0.00.
export function formatPrecise(value) {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  if (Number.isNaN(n)) return String(value)
  if (n !== 0 && Math.abs(n) < 0.01) return n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

export function formatSigned(value) {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  if (Number.isNaN(n)) return String(value)
  if (n === 0) return '0.00'
  return `${n > 0 ? '+' : '−'}${formatPrecise(Math.abs(n))}`
}

// Like formatSigned but keeps up to 4 decimals (propagation gaps are often a few cents or less).
export function formatSignedFine(value) {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  if (Number.isNaN(n)) return String(value)
  if (n === 0) return '0.00'
  const body = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
  return `${n > 0 ? '+' : '−'}${body}`
}

// 'down' | 'up' | 'flat' for a decimal-string delta
export function direction(delta) {
  const n = Number(delta)
  return n < 0 ? 'down' : n > 0 ? 'up' : 'flat'
}

// Shapley rows, largest share first, with each event's share of the total (0..1) for the bars.
export function shapleyRows(shapley) {
  if (!shapley || shapley.status !== 'ok') return []
  const total = Number(shapley.v_of_subset)
  return Object.entries(shapley.values)
    .map(([id, v]) => ({ id, value: v, share: total ? Number(v) / total : 0 }))
    .sort((a, b) => Number(b.value) - Number(a.value) || a.id.localeCompare(b.id))
}

// id -> {role, step, changes} for the chosen order, or null
export function nodeEffects(scenario) {
  return scenario?.selected?.node_effects ?? null
}

const RELATION_TEXT = {
  stale: 'applied before it → does not include this value',
  pending: 'applied later → will absorb',
  not_in_change: 'not in this swap → stays out of date',
}
export const relationText = (r) => RELATION_TEXT[r] ?? r

// The propagation overlay for one step of the replay. `traceNode` is the event the step-through is on
// (null = the posted case, before any correction). Returns null when nothing should be drawn.
//   nodes[id] = { state: 'active'|'done'|'queued'|'target', step, affected?: {gap, field, relation} }
//   edges     = arrows from the corrected node to every dependent it leaves out of date, plus one to the total
export function buildFlow(influence, traceNode, targetId) {
  if (!influence || !traceNode) return null
  const order = influence.order
  const k = order.indexOf(traceNode)
  if (k < 0) return null
  const nodes = {}
  order.forEach((id, i) => {
    nodes[id] = { state: i < k ? 'done' : i === k ? 'active' : 'queued', step: i + 1 }
  })
  const st = influence.steps[k]
  const edges = []
  st.affects.forEach((a) => {
    nodes[a.node_id] = { ...(nodes[a.node_id] ?? { state: 'idle' }), affected: { gap: a.gap, field: a.field, relation: a.relation } }
    edges.push({
      from: st.node_id, to: a.node_id, kind: a.relation,
      label: `${formatSignedFine(a.gap)} ${a.relation === 'pending' ? 'absorbed later' : 'now stale'}`,
    })
  })
  if (targetId) {
    nodes[targetId] = { state: 'target', deltaText: formatSigned(st.delta_net) }
    edges.push({ from: st.node_id, to: targetId, kind: 'total', label: `total ${formatSigned(st.delta_net)}` })
  }
  return { nodes, edges, step: k }
}

// Plain-text version of the change report (for the download button).
export function reportText(s, caseId) {
  const inf = s.influence
  const lines = [
    `ReplaySemantics - change report`,
    `Case ${caseId} | policy ${s.policy_version} | verdict of this change: ${s.subset_verdict}${s.exploratory ? ' (exploratory: no authoritative order)' : ''}`,
    `Swapped together: ${s.subset.join(', ')} | order applied: ${inf.order.join(' -> ')}`,
    `Total ${formatPrecise(s.baseline.net)} -> ${formatPrecise(s.selected.net)} (${formatSigned(s.selected.delta_net)}) | realised loss ${formatPrecise(s.baseline.loss)} -> ${formatPrecise(s.selected.loss)} (${formatSigned(s.selected.delta_loss)})`,
    '',
    'WHAT HAPPENED, STEP BY STEP',
    ...inf.narrative,
    '',
    'NODE LEDGER',
    ...inf.nodes.map((n) => {
      const ch = n.own_changes.map((c) => `${c.field} ${formatPrecise(c.before)} -> ${formatPrecise(c.after)}`).join('; ')
      return `${n.node_id} ${n.activity} (hop ${n.hop}) | ${n.step ? `applied at step ${n.step}` : 'not in this swap'} | ${ch || 'value stays as posted'}`
    }),
  ]
  return lines.join('\n')
}
