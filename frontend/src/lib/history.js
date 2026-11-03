// Pure logic for the History page. No React here, so scripts/check-lib.mjs can test it.

// the limits a page holds -> the shape the server stores with an action
export function limitsBody(limits) {
  if (!limits) return undefined
  const { maxEvents = null, minEvents = 3, maxHops = 3 } = limits
  return { max_events: maxEvents === '' ? null : maxEvents, min_events: minEvents, max_hops: maxHops }
}

// ticking and unticking actions for a comparison
export function toggleId(ids, id) {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
}

const money = (x) => (x === null || x === undefined ? 'n/a' : Number(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

// the comparison report as plain text, for the Download button
export function compareReportText(report) {
  const cols = report.columns
  const lines = ['ReplaySemantics - comparison report', `Actions: ${cols.map((c) => c.seq).join(', ')}`, '']
  cols.forEach((c) => {
    lines.push(`Action ${c.seq}: ${c.title}`)
    lines.push(`  Event log: ${c.log_label ?? 'n/a'} | Case: ${c.case_id ?? 'n/a'} | When: ${c.created_at}`)
    lines.push(`  Verdict: ${c.verdict ?? 'n/a'} | Order: ${c.order.length ? c.order.join(' -> ') : 'n/a'}`)
    lines.push(`  Total: ${money(c.total)} | Loss: ${money(c.loss)} | Total vs Action ${cols[0].seq}: ${money(c.total_vs_first)}`)
    c.outcomes.forEach((o) => lines.push(`  ${o.label}: total ${money(o.total)}, loss ${money(o.loss)}`))
    lines.push('')
  })
  lines.push('FINDINGS', ...report.findings.map((f) => `- ${f}`))
  return lines.join('\n')
}
