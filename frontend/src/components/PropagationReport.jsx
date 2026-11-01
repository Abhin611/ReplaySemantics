import { Download } from 'lucide-react'
import Card from './Card'
import { formatPrecise, formatSigned, formatSignedFine, relationText, reportText } from '../lib/scenario'

// Bottom-of-page report of a swap: which nodes were applied, what the order changed in each, and how they read one
// another (the reason order matters). Every number comes from scenario.influence (src/replay_core/influence.py), i.e.
// from running the real transfer functions on the recorded values -- nothing is recomputed here.

const REL_STYLE = {
  stale: 'bg-status-blockedBg text-status-blocked',
  pending: 'bg-status-orderedBg text-status-ordered',
  not_in_change: 'bg-[#eef1f4] text-[#5c6b7a]',
}

const Th = ({ children, right }) => (
  <th className={`pb-1.5 pr-3 text-[10.5px] font-semibold uppercase tracking-wide text-[#8a97a3] ${right ? 'text-right' : 'text-left'}`}>{children}</th>
)
const hopText = (h) => (h === null || h === undefined ? 'target' : `hop ${h}`)

function download(s, caseId) {
  const blob = new Blob([reportText(s, caseId)], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `change-report-${caseId}-${s.subset.join('_')}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

export default function PropagationReport({ scenario: s, caseId, onFocusNode }) {
  const inf = s?.influence
  if (!inf) return null
  const orderNonZero = inf.influence.filter((i) => Number(i.delta) !== 0)
  const touched = inf.nodes

  return (
    <Card>
      <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[15px] font-bold text-[#101828]">Change report</div>
          <p className="mt-0.5 max-w-3xl text-[11.5px] leading-relaxed text-[#8a97a3]">
            What this order did. Every value stays as recorded unless the order makes a change necessary, so the order that was posted
            reproduces the original graph. Each figure comes from the real transfer functions, hop levels
            reached: {inf.hop_levels.length ? inf.hop_levels.map((h) => `hop ${h}`).join(' → ') : '—'} → invoice total.
          </p>
        </div>
        <button
          onClick={() => download(s, caseId)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#e2e6ea] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#101828] hover:bg-[#f2f4f6]"
        >
          <Download size={13} /> Download report
        </button>
      </div>

      {/* 1. Step by step */}
      <div className="mt-4 text-[12.5px] font-bold text-[#101828]">1 · Step by step: what each node did</div>
      <div className="mt-1 overflow-x-auto">
        <table className="w-full min-w-[640px] text-[11.5px]">
          <thead>
            <tr><Th>Step</Th><Th>Node applied</Th><Th>Its own change</Th><Th right>Total moves</Th><Th>Dependents left out of date</Th></tr>
          </thead>
          <tbody>
            {inf.steps.map((st) => (
              <tr key={st.node_id} className="border-t border-[#eef1f4] align-top">
                <td className="py-2 pr-3 font-mono font-semibold">{st.index + 1}</td>
                <td className="py-2 pr-3">
                  <button className="font-mono font-semibold text-teal-600 hover:underline" onClick={() => onFocusNode?.(st.node_id)}>{st.node_id}</button>
                  <div className="text-[10.5px] text-[#8a97a3]">{st.activity} · {hopText(st.hop)}</div>
                </td>
                <td className="py-2 pr-3 font-mono text-[11px] text-[#5c6b7a]">
                  {st.own_changes.length ? st.own_changes.map((c) => (
                    <div key={c.field}>{c.field}: {formatPrecise(c.before)} → <b className="text-[#101828]">{formatPrecise(c.after)}</b></div>
                  )) : <span className="text-[#8a97a3]">no change: same as posted</span>}
                </td>
                <td className="py-2 pr-3 text-right font-mono font-semibold">{formatSigned(st.delta_net)}</td>
                <td className="py-2">
                  {st.affects.length === 0 ? <span className="text-[#8a97a3]">none</span> : (
                    <ul className="flex flex-col gap-1">
                      {st.affects.map((a) => (
                        <li key={a.node_id} className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono font-semibold">{a.node_id}</span>
                          <span className="text-[10.5px] text-[#8a97a3]">{a.activity} · {hopText(a.hop)}</span>
                          <span className="font-mono">{a.field} {formatSignedFine(a.gap)}</span>
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${REL_STYLE[a.relation]}`}>{relationText(a.relation)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[10.5px] leading-snug text-[#8a97a3]">
        A node that runs before something it reads keeps its recorded value. When a value does move, any node that reads it and did not see the new value
        differs by the figure shown (what its own formula would give now, minus what it stores). That gap is how the order travels between hops.
      </p>

      {/* 2. Influence */}
      <div className="mt-5 text-[12.5px] font-bold text-[#101828]">2 · How the nodes read each other (why order matters)</div>
      {orderNonZero.length === 0 ? (
        <p className="mt-1 text-[11.5px] text-[#5c6b7a]">This order does not force any node in the swap to change, so every value stays as recorded.</p>
      ) : (
        <div className="mt-1 overflow-x-auto">
          <table className="w-full min-w-[560px] text-[11.5px]">
            <thead><tr><Th>Runs first</Th><Th>Node that moves</Th><Th right>Applied before it</Th><Th right>Applied after it</Th><Th right>Difference</Th></tr></thead>
            <tbody className="font-mono">
              {orderNonZero.map((i) => (
                <tr key={`${i.from}-${i.to}`} className="border-t border-[#eef1f4]">
                  <td className="py-1.5 pr-3 font-semibold">{i.from}</td>
                  <td className="py-1.5 pr-3 font-semibold">{i.to} <span className="font-sans text-[10px] text-[#8a97a3]">({i.field})</span></td>
                  <td className="py-1.5 pr-3 text-right">{formatPrecise(i.alone)}</td>
                  <td className="py-1.5 pr-3 text-right">{formatPrecise(i.after_upstream)}</td>
                  <td className="py-1.5 text-right font-semibold">{formatSignedFine(i.delta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-1 text-[10.5px] leading-snug text-[#8a97a3]">
        Difference ≠ 0 means the node ends at a different value depending on which of the two runs first: a discount applied after tax is
        taken on gross + tax. A node with no reason to move keeps its recorded value.
      </p>

      {/* 3. Ledger */}
      <div className="mt-5 text-[12.5px] font-bold text-[#101828]">3 · Node ledger: every node this swap touched</div>
      <div className="mt-1 overflow-x-auto">
        <table className="w-full min-w-[720px] text-[11.5px]">
          <thead>
            <tr><Th>Node</Th><Th>Hop</Th><Th>Role</Th><Th>Own change</Th><Th>Influenced by</Th><Th>Influences</Th></tr>
          </thead>
          <tbody>
            {touched.map((n) => (
              <tr key={n.node_id} className="border-t border-[#eef1f4] align-top">
                <td className="py-1.5 pr-3">
                  <button className="font-mono font-semibold text-teal-600 hover:underline" onClick={() => onFocusNode?.(n.node_id)}>{n.node_id}</button>
                  <div className="text-[10.5px] text-[#8a97a3]">{n.activity}</div>
                </td>
                <td className="py-1.5 pr-3 font-mono">{n.hop ?? '—'}</td>
                <td className="py-1.5 pr-3">{n.role === 'corrected' ? `applied · step ${n.step}` : 'affected (not in this swap)'}</td>
                <td className="py-1.5 pr-3 font-mono text-[11px] text-[#5c6b7a]">
                  {n.own_changes.length ? n.own_changes.map((c) => <div key={c.field}>{c.field}: {formatPrecise(c.before)} → {formatPrecise(c.after)}</div>) : n.stale_gaps.length ? (
                    n.stale_gaps.map((g, k) => <div key={k}>out of date by {formatSignedFine(g.gap)} after step {g.step}</div>)
                  ) : 'same as posted'}
                </td>
                <td className="py-1.5 pr-3 font-mono text-[11px]">{n.influenced_by.length ? n.influenced_by.map((x) => <div key={x.from}>{x.from} {formatSignedFine(x.delta)}</div>) : '—'}</td>
                <td className="py-1.5 pr-3 font-mono text-[11px]">{n.influences.length ? n.influences.map((x) => <div key={x.to}>{x.to} {formatSignedFine(x.delta)}</div>) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 5. Narrative */}
      <details className="mt-4" open>
        <summary className="cursor-pointer text-[12.5px] font-bold text-[#101828]">4 · In words</summary>
        <ul className="mt-1.5 flex flex-col gap-1 text-[12px] leading-snug text-[#344054]">
          {inf.narrative.map((line, i) => (
            <li key={i} className={line.startsWith('    ') ? 'ml-5 text-[#5c6b7a]' : ''}>{line.trim()}</li>
          ))}
        </ul>
      </details>
    </Card>
  )
}
