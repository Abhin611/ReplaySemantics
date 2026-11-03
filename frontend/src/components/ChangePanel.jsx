import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Loader2, Pencil, RotateCcw, Shuffle } from 'lucide-react'
import Card from './Card'
import { postChange, recordAction } from '../lib/api'
import { limitsBody } from '../lib/history'
import { formatPrecise } from '../lib/scenario'
import { SEQUENCE_LABEL, cleanEdits, toggleSwap } from '../lib/ledger'

const LABEL = { unit_price: 'unit price', quantity: 'quantity', rate: 'rate', fx_rate: 'FX rate', amount: 'amount', decimals: 'decimals', mode: 'mode' }

// Edit is available on EVERY case: press "Edit values", change whatever you like in any node, and only then press
// "Run change" -- it runs once, with all your edits together (one cascade through every dependent), optionally combined with
// running posted nodes in an order you choose. It starts from the books as posted: no value changes unless an edit or the order changes it.
export default function ChangePanel({ caseId, limits, analysis, defaultSwap = [], panelId = 'edit-panel' }) {
  const base = analysis?.editable || {}
  const [open, setOpen] = useState(false)
  const [vals, setVals] = useState({})
  const [swap, setSwap] = useState(defaultSwap)
  const [sequence, setSequence] = useState('both')
  const [res, setRes] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setVals({}); setRes(null); setErr(null); setSwap(defaultSwap) }, [caseId, JSON.stringify(limits)]) // eslint-disable-line react-hooks/exhaustive-deps

  const nodes = (analysis?.nodes || []).filter((n) => n.editable_fields?.length)
  const posted = nodes.filter((n) => n.role === 'posted').map((n) => n.node_id)
  const staged = useMemo(() => {
    const out = {}
    Object.entries(vals).forEach(([n, f]) => Object.entries(f).forEach(([k, v]) => {
      if (v !== '' && String(v) !== String(base[n]?.[k])) { out[n] = { ...(out[n] || {}), [k]: v } }
    }))
    return out
  }, [vals, base])
  const stagedCount = Object.values(staged).reduce((a, f) => a + Object.keys(f).length, 0)
  const set = (n, k, v) => setVals((m) => ({ ...m, [n]: { ...(m[n] || {}), [k]: v } }))

  const run = async () => {
    setBusy(true); setErr(null)
    try {
      const body = { edits: cleanEdits(staged), swap, sequence }
      setRes(await postChange(caseId, body, limits))
      recordAction({ kind: 'change', case_id: caseId, ...body, limits: limitsBody(limits) })
    } catch (e) { setErr(e.message); setRes(null) } finally { setBusy(false) }
  }
  const reset = () => { setVals({}); setSwap([]); setRes(null); setErr(null) }

  return (
    <Card id={panelId}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Pencil size={16} /> <h3 className="text-[15px] font-semibold text-[#101828]">Edit values and run a change</h3>
        <button onClick={() => setOpen((o) => !o)} className="ml-auto rounded-lg border border-[#e2e6ea] bg-white px-3 py-1.5 text-[12.5px] font-semibold hover:bg-[#f2f4f6]" data-testid="edit-toggle">
          {open ? 'Close editing' : 'Edit values'}
        </button>
      </div>
      <p className="mb-3 text-[12.5px] text-[#5c6b7a]">
        Every node keeps the value it shows until <b>you</b> change it. Edit as many values as you want, choose which posted amounts to run and in what order, then press
        <b> Run change</b> once: all your edits run together and flow through every node that depends on them.
      </p>
      {open && (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" data-testid="edit-fields">
          {nodes.map((n) => (
            <div key={n.node_id} className="rounded-lg border border-[#e2e6ea] p-2.5 text-[12.5px]">
              <div className="font-semibold text-[#101828]">{n.node_id} · {n.activity}</div>
              {n.editable_fields.map((f) => {
                const changed = staged[n.node_id]?.[f] !== undefined
                return (
                  <label key={f} className="mt-1.5 flex items-center justify-between gap-2 text-[#5c6b7a]">{LABEL[f] || f}
                    <input value={vals[n.node_id]?.[f] ?? base[n.node_id]?.[f] ?? ''} onChange={(e) => set(n.node_id, f, e.target.value)}
                      className={`w-28 rounded border px-2 py-1 text-right font-mono text-[#101828] ${changed ? 'border-amber-400 bg-amber-50' : 'border-[#e2e6ea]'}`} />
                  </label>
                )
              })}
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px]">
        <Shuffle size={14} className="text-[#8a97a3]" /> <span className="text-[#5c6b7a]">Swap order (click in the order you want):</span>
        {posted.length === 0 && <span className="text-[#8a97a3]">no posted amounts in this case</span>}
        {posted.map((p) => {
          const i = swap.indexOf(p)
          return (
            <button key={p} onClick={() => setSwap((s) => toggleSwap(s, p))}
              className={`rounded-full border px-2.5 py-1 font-semibold ${i >= 0 ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-[#e2e6ea] hover:bg-[#f2f4f6]'}`}>
              {i >= 0 ? `${i + 1}. ` : ''}{p}
            </button>
          )
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px]">
        {Object.entries(SEQUENCE_LABEL).map(([k, label]) => (
          <label key={k} className="flex items-center gap-1"><input type="radio" name={`seq-${panelId}`} checked={sequence === k} onChange={() => setSequence(k)} />{label}</label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="text-[12.5px] text-[#5c6b7a]" data-testid="staged">
          {stagedCount ? `${stagedCount} staged edit${stagedCount > 1 ? 's' : ''}: ${Object.entries(staged).map(([n, f]) => Object.entries(f).map(([k, v]) => `${n}.${LABEL[k] || k} → ${v}`).join(', ')).join('; ')}` : 'No edits staged yet.'}
        </div>
        <button onClick={run} disabled={busy || (!stagedCount && !swap.length)}
          className="ml-auto flex items-center gap-2 rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white hover:bg-navy-800 disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />} Run change
        </button>
        <button onClick={reset} className="flex items-center gap-1.5 rounded-lg border border-[#e2e6ea] px-3 py-2 text-[12.5px] font-semibold hover:bg-[#f2f4f6]"><RotateCcw size={13} /> Reset</button>
      </div>
      {err && <div className="mt-2 text-[12.5px] text-status-blocked">{err}</div>}
      {res && (
        <div className="mt-3 space-y-2" data-testid="change-result">
          <div className={`rounded-lg px-3 py-2 text-[13px] font-semibold ${res.sequences_agree || res.runs.length === 1 ? 'bg-status-passBg text-status-pass' : 'bg-amber-50 text-amber-800'}`}>{res.summary}</div>
          <div className="grid gap-2 md:grid-cols-2">
            {res.runs.map((r) => (
              <div key={r.sequence} className="rounded-lg border border-[#e2e6ea] p-3 text-[12.5px]">
                <div className="font-semibold">{SEQUENCE_LABEL[r.sequence]}</div>
                {r.steps.map((s, i) => <div key={i} className="text-[#5c6b7a]">{s.kind === 'swap' ? `apply ${s.nodes.join(' → ')}` : `edit ${s.nodes.join(', ')} (cascade over ${s.recomputed.length} nodes)`} → total {formatPrecise(s.net_after)}</div>)}
                <div className="mt-1 text-[13px]">final total <b>{formatPrecise(r.final_net)}</b> · loss <b>{formatPrecise(r.final_loss)}</b> {r.matches_compliant_total ? '· equals the compliant total' : `· compliant is ${formatPrecise(res.compliant_total)}`}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
