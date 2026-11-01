// Pure helpers for the Replay Console flow (graph build -> stages -> replay -> tabs). No React, so check-lib can test them.
import { badgeStatus, pairDetails } from './verdict.js'
import { formatEur } from './format.js'

export const STAGES = [
  { key: 'stage_1_extraction', label: 'Extraction', hint: 'Finds the posted invoice event the loss sits on.' },
  { key: 'stage_2_candidate_identification', label: 'Candidate Identification', hint: 'Traces back to the events that could have caused the loss.' },
  { key: 'stage_2b_constraint_extraction', label: 'Order Constraints', hint: 'Works out which events have a fixed order in the log and which do not.' },
  { key: 'stage_3_confluence_checks', label: 'Confluence Checks', hint: 'Swaps the events that have no fixed order and checks whether the total changes.' },
  { key: 'stage_4_policy_resolution', label: 'Policy Resolution', hint: 'Lets the policy fix an order wherever swapping changed the total.' },
  { key: 'stage_5_verdict', label: 'Verdict', hint: 'PASS, POLICY-ORDERED or BLOCKED for the whole case.' },
]

const SHORT = { 'Unit price': 'price', Quantity: 'qty', 'Discount rate': 'rate', 'Tax rate': 'rate', 'FX rate': 'fx', 'Fixed amount': 'amount', 'Decimals kept': 'dp' }

// One short line of values for a node, so no node on the graph is empty: its main value(s) or what the log recorded.
export function briefFor(desc, facts) {
  if (desc) {
    if (desc.node_type === 'reference') {
      const g = (l) => desc.lines.find((x) => x.label === l)?.text
      return `price ${g('Contract unit price')} × ${g('Ordered quantity')} · tax ${(g('Tax rate') || '').split('(')[1]?.replace(')', '') || g('Tax rate')}`
    }
    if (desc.node_type === 'net') return `total ${desc.total?.text ?? ''}`.trim()
    const inp = (desc.lines || []).find((l) => l.kind === 'input')
    if (inp) {
      const head = `${SHORT[inp.label] || inp.label} ${inp.text.split('  ')[0]}`
      const posted = ['discount', 'tax', 'rounding'].includes(desc.node_type) && desc.total ? ` → ${desc.total.text}` : ''
      return head + posted
    }
    const rec = desc.recorded || []
    if (rec.length) return `${rec[0].label.toLowerCase()} ${shortTime(rec[0].text)}`
  }
  const f = facts
  if (f) {
    if (f.attributes?.value != null) return `value ${formatEur(f.attributes.value)}`
    return `time ${shortTime(f.timestamp)}`
  }
  return ''
}

function shortTime(t) {
  const m = /T(\d\d:\d\d)/.exec(t || '') || / (\d\d:\d\d)/.exec(t || '')
  return m ? m[1] : (t || '').slice(0, 16)
}

// The graph highlights what each pipeline stage is inspecting (index 0..5); null = nothing in particular.
export function stageHighlight(i, result) {
  if (!result) return null
  const nodes = result.replay_graph?.nodes ?? []
  if (i === 0) return { type: 'nodes', ids: nodes.filter((n) => n.is_target).map((n) => n.id) }
  if (i === 1) return { type: 'nodes', ids: nodes.filter((n) => !n.is_target && !n.is_reference).map((n) => n.id) }
  if (i === 2) {
    const pairs = (result.stage_2b_constraint_extraction?.permutable_pairs ?? []).map((p) => [p.a, p.b])
    return pairs.length ? { type: 'pairs', pairs } : null
  }
  if (i === 3 || i === 4) {
    const pairs = pairDetails(result).map((p) => [p.a, p.b])
    return pairs.length ? { type: 'pairs', pairs } : null
  }
  return null
}

// Rows of the OCEL table shown before the graph is built: the start node first, then every event, oldest first.
export function ocelRows(result) {
  const rows = (result?.ocel_table?.rows ?? []).map((r) => ({ ...r }))
  const ref = result?.reference_node
  if (ref) {
    const g = (l) => ref.lines.find((x) => x.label === l)?.text
    rows.unshift({
      id: 'REF', activity: 'Case reference (start node)', timestamp: null, hop: null, is_target: false, is_reference: true,
      objects: ['contract terms', 'tax table', 'FX table'],
      attributes: { unit_price: g('Contract unit price'), quantity: g('Ordered quantity'), tax_rate: g('Tax rate'), fx_rate: g('FX rate') },
    })
  }
  return rows
}

export const attrText = (a, max = 70) => {
  const s = Object.entries(a || {}).map(([k, v]) => `${k}: ${v}`).join(' · ')
  return s.length > max ? `${s.slice(0, max - 1)}…` : s || '—'
}

// Keep a popover of size (w,h) fully inside a container of size (cw,ch) when anchored near (x,y).
export function clampPopover(x, y, w, h, cw, ch, gap = 14) {
  let left = x + gap
  if (left + w > cw - 8) left = x - w - gap
  left = Math.max(8, Math.min(left, cw - w - 8))
  let top = y - 24
  top = Math.max(8, Math.min(top, ch - h - 8))
  return { left, top }
}

// Locked-by-process and permutable (order not fixed) lists for the two vertical tabs.
export function constraintLists(result) {
  const s = result?.stage_2b_constraint_extraction
  return {
    locked: (s?.given_constraints ?? []).filter((c) => c.reason !== 'target_precedence'),
    toTarget: (s?.given_constraints ?? []).filter((c) => c.reason === 'target_precedence'),
    permutable: s?.permutable_pairs ?? [],
  }
}

// One timeline entry per pipeline stage, worded from the real stage payloads.
export function pipelineItems(result) {
  const s1 = result.stage_1_extraction
  const s2 = result.stage_2_candidate_identification
  const s2b = result.stage_2b_constraint_extraction
  const msg = (k) => result[k]?.message
  return [
    { key: 'stage_1_extraction', label: 'Stage 1 · Extraction', status: s1?.status,
      body: s1?.target_event ? `Target: ${s1.target_event.activity} (${formatEur(s1.target_event.value_eur)})` : msg('stage_1_extraction') },
    { key: 'stage_2_candidate_identification', label: 'Stage 2 · Candidate Identification', status: s2?.status,
      body: `${s2?.num_candidates} kept of ${s2?.total_discovered} discovered · ${s2?.hops_used} hops used`,
      warning: s2?.warnings?.length ? s2.warnings.join('; ') : null },
    { key: 'stage_2b_constraint_extraction', label: 'Stage 2b · Order Constraints', status: s2b?.status,
      body: `${s2b?.num_constraints} locked · ${s2b?.num_permutable_pairs} permutable` },
    { key: 'stage_3_confluence_checks', label: 'Stage 3 · Confluence Checks', status: result.stage_3_confluence_checks?.status, body: msg('stage_3_confluence_checks') },
    { key: 'stage_4_policy_resolution', label: 'Stage 4 · Policy Resolution', status: result.stage_4_policy_resolution?.status, body: msg('stage_4_policy_resolution') },
    { key: 'stage_5_verdict', label: 'Stage 5 · Verdict', status: result.stage_5_verdict?.status, body: msg('stage_5_verdict'),
      badge: result.stage_5_verdict?.status === 'complete' ? badgeStatus(result.stage_5_verdict.classification) : null },
  ]
}

// The limits that draw the WHOLE graph on the first run (from GET /api/cases/{id}/hops -> full_graph).
export function fullGraphLimits(hops) {
  const f = hops?.full_graph
  return f ? { maxHops: f.max_hops, maxEvents: f.max_events, minEvents: f.min_events } : { maxHops: 3, maxEvents: null, minEvents: 3 }
}
