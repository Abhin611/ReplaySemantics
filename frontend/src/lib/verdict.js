// src/lib/verdict.js
//
// Pure helpers (no React) that turn the REAL stage 3-5 payloads of
// GET /api/cases/{id}/replay into what the UI shows. Kept framework-free so
// scripts/check-lib.mjs can test them against real API output with plain Node.
//
// Nothing here invents a verdict: if the payload says "not_applicable" (real
// VBFA events) every helper returns null / empty rather than a placeholder.

export const VERDICTS = {
  PASS: {
    badge: 'PASS',
    color: '#1a7f4c',
    meaning:
      'Every legitimate order of the corrections gives the same total, so the outcome is well-defined.',
  },
  POLICY_ORDERED: {
    badge: 'POLICY-ORDERED',
    color: '#92650a',
    meaning:
      'Different orders give different totals, but the policy fixes which order is authoritative, so the outcome is well-defined under that policy.',
  },
  BLOCKED: {
    badge: 'BLOCKED',
    color: '#b3261e',
    meaning:
      'Different orders give different totals and the policy does not say which is right. There is no defensible number, so attribution is withheld.',
  },
}

export const REASONS = {
  ORDERS_DISAGREE_NO_POLICY_ORDER:
    'The policy has no rule saying which of these corrections must be applied first.',
  POLICY_AND_STRUCTURE_CYCLE:
    'The policy order contradicts the order already fixed by the log.',
}

// 'POLICY_ORDERED' (API) -> 'POLICY-ORDERED' (StatusBadge key)
export function badgeStatus(classification) {
  return VERDICTS[classification]?.badge ?? null
}

export function isApplicable(result) {
  return result?.stage_5_verdict?.status === 'complete'
}

// One entry per order-sensitive pair, enriched with plain-English wording.
export function pairDetails(result) {
  if (!isApplicable(result)) return []
  return result.stage_4_policy_resolution?.pair_details ?? []
}

// id -> { kind, partners, correction }
//   kind: 'blocked' (in an unresolved order-sensitive pair), 'ordered' (order-sensitive but the
//         policy fixes it), 'independent' (its correction commutes with every other),
//         'exempt' (approved exception, identity correction), 'context' (no correction).
// Returns null for real VBFA results (nothing to colour).
export function buildNodeStatus(result) {
  if (!isApplicable(result)) return null
  const pairs = pairDetails(result)
  const worst = {}
  for (const p of pairs) {
    for (const id of [p.a, p.b]) {
      if (p.status === 'blocked') worst[id] = 'blocked'
      else if (worst[id] !== 'blocked') worst[id] = 'ordered'
    }
  }
  const out = {}
  for (const n of result.node_status ?? []) {
    let kind
    if (n.role === 'context') kind = 'context'
    else if (n.role === 'exempt') kind = 'exempt'
    else kind = worst[n.event_id] ?? 'independent'
    out[n.event_id] = {
      kind,
      partners: n.order_sensitive_with ?? [],
      correction: n.correction_id ?? null,
    }
  }
  return out
}

export const NODE_KIND_STYLE = {
  blocked: { border: '#b3261e', bg: '#fbe4e2', text: '#7a1a14', label: 'order-sensitive · blocked' },
  ordered: { border: '#92650a', bg: '#fdf1d8', text: '#6b4a08', label: 'order-sensitive · policy-ordered' },
  independent: { border: '#2563eb', bg: '#eaf1ff', text: '#1e3a8a', label: 'order-independent' },
  exempt: { border: '#8a97a3', bg: '#f4f6f8', text: '#5c6b7a', label: 'approved exception' },
  context: { border: '#c2cad2', bg: '#ffffff', text: '#8a97a3', label: 'context (no correction)' },
}

export function correctionLabel(id) {
  if (!id) return null
  return id.replace(/_correction$/, '').replace(/_/g, ' ')
}

// "Fixing E1 (discount) and E2 (tax) in different orders gives different totals ..."
export function pairSentence(pair, nodeStatus, lookup = {}) {
  const name = (id) => {
    const c = correctionLabel(nodeStatus?.[id]?.correction)
    return c ? `${id} (${c})` : `${id}${lookup[id] ? ` (${lookup[id]})` : ''}`
  }
  const base = `Correcting ${name(pair.a)} and ${name(pair.b)} in different orders gives different totals.`
  if (pair.status === 'policy_ordered') {
    return pair.policy_first
      ? `${base} The policy applies ${pair.policy_first} first.`
      : `${base} The policy fixes the order.`
  }
  return `${base} ${REASONS[pair.reason_code] ?? 'The policy does not resolve it.'}`
}

// Rows for the coalition-value table: every subset with its verdict and v(S) ("withheld" if BLOCKED).
export function subsetRows(result) {
  if (!isApplicable(result)) return []
  const values = result.stage_5_verdict.coalition_values ?? {}
  return (result.stage_3_confluence_checks?.subsets ?? [])
    .map((s) => ({
      key: s.key,
      subset: s.subset,
      verdict: s.verdict,
      agree: s.agree,
      orderUsed: s.order_used,
      value: values[s.key] ?? null,
    }))
    .sort((a, b) => a.subset.length - b.subset.length || a.key.localeCompare(b.key))
}

// Net after each step of the full replay, with the observed net as step 0.
export function traceSteps(replay) {
  if (!replay) return []
  const steps = [{ index: 0, nodeId: null, net: replay.observed_net, changed: [], applied: true }]
  for (const s of replay.trace ?? []) {
    steps.push({
      index: s.index + 1,
      nodeId: s.node_id,
      net: s.net_after,
      changed: s.changed ?? [],
      applied: s.applied,
      reason: s.noop_reason,
    })
  }
  return steps
}
