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

export function scenarioPath(caseId, subset, order) {
  const p = new URLSearchParams({ case: caseId, subset: [...subset].sort().join(',') })
  if (order && order.length) p.set('order', order.join(','))
  return `/scenario?${p.toString()}`
}

export function parseScenarioParams(params) {
  const list = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [])
  return { caseId: params.get('case') || null, subset: list(params.get('subset')), order: list(params.get('order')) }
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
