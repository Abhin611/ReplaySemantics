// Pure logic for the Replay Analysis page (corrected-ledger view). No React here, so
// `node scripts/check-lib.mjs` can test it.

export const CLASS_LABEL = {
  SWAP_ONLY: 'Swap only',
  MULTI_EDIT_ONLY: 'Multi-edit only',
  BOTH: 'Swap and edit',
  DIRECT_FIX: 'Direct fix',
}
export const CLASS_HINT = {
  SWAP_ONLY: 'all loss is stale posted amounts; the order of re-deriving them matters',
  MULTI_EDIT_ONLY: 'all loss is wrong inputs; no order choice among posted amounts',
  BOTH: 'wrong inputs and stale amounts; you choose to swap first or edit first',
  DIRECT_FIX: 'one posted amount is stale; nothing to order',
}
export const classLabel = (c) => CLASS_LABEL[c] || '—'

// Query string for the three candidate-set limits. Empty / null max_events means "no limit" and is left out.
export function limitsQuery({ maxEvents = null, minEvents = 3, maxHops = 3 } = {}) {
  const p = new URLSearchParams()
  if (maxEvents !== null && maxEvents !== undefined && maxEvents !== '') p.set('max_events', String(maxEvents))
  p.set('min_events', String(minEvents))
  p.set('max_hops', String(maxHops))
  return p
}

// Share of the realised loss that comes from stale posted amounts vs wrong inputs (0..100, summing to 100).
export function lossShares(totals) {
  const total = Number(totals?.realised_loss)
  if (!total || Number.isNaN(total)) return { stale: 0, inputs: 0 }
  const stale = Math.round((Number(totals.loss_from_stale_amounts) / total) * 1000) / 10
  return { stale, inputs: Math.round((100 - stale) * 10) / 10 }
}

// Click order is the re-derive order: clicking a node adds it at the end, clicking again removes it.
export function toggleSwap(list, node) {
  return list.includes(node) ? list.filter((n) => n !== node) : [...list, node]
}

// A banner when the kept candidate set is not the whole story; null when complete.
export function partialNotice(limits) {
  if (!limits || limits.complete) return null
  const sug = limits.suggestion
  return {
    reasons: limits.partial_reasons || [],
    suggestedHops: sug?.max_hops ?? null,
    dropped: (limits.dropped || []).map((d) => d.event_id),
  }
}

// "e3 then e4 (CO-03)" for an authoritative order, or the blocked sentence.
export function pairBadge(p) {
  if (p.blocked) return { tone: 'blocked', text: 'BLOCKED — policy cannot order this pair' }
  return { tone: 'ordered', text: `${p.authoritative_order.join(' then ')} (${(p.rules || []).join(', ')})` }
}

export const SEQUENCE_LABEL = { swap_first: 'Swap first, then edit', edit_first: 'Edit first, then swap', both: 'Compare both' }

// edits state {node: {field: value}} -> request body, dropping blanks
export function cleanEdits(edits) {
  const out = {}
  Object.entries(edits || {}).forEach(([n, f]) => {
    const kept = Object.fromEntries(Object.entries(f || {}).filter(([, v]) => v !== '' && v !== null && v !== undefined))
    if (Object.keys(kept).length) out[n] = kept
  })
  return out
}

// hop profile rows -> a compact text, e.g. "hop 1: 3 (1 correctable) · hop 2: 4 (3)"
export function hopProfileText(profile) {
  return (profile?.rows || []).filter((r) => r.events > 0)
    .map((r) => `hop ${r.hop}: ${r.events} (${r.active} correctable)`).join(' · ')
}
