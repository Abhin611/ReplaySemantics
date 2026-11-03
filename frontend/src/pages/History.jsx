import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, Download, ExternalLink, GitCompareArrows, Loader2 } from 'lucide-react'
import Card from '../components/Card'
import StatusBadge from '../components/StatusBadge'
import { EmptyState, ErrorState, LoadingState } from '../components/StatusStates'
import { useApi } from '../lib/useApi'
import { compareActions, getHistory, openLog } from '../lib/api'
import { useSession } from '../lib/session'
import { badgeStatus } from '../lib/verdict'
import { formatDateTime } from '../lib/format'
import { formatPrecise, formatSigned, scenarioPath } from '../lib/scenario'
import { compareReportText, toggleId } from '../lib/history'

const money = (x) => (x === null || x === undefined ? '—' : formatPrecise(x))
const signed = (x) => (x === null || x === undefined ? '—' : formatSigned(x))

function ActionRow({ action: a, kinds, checked, onToggle, onOpen }) {
  const [open, setOpen] = useState(false)
  const s = a.snapshot
  return (
    <li className={`rounded-xl border transition-colors ${checked ? 'border-teal-400 bg-teal-50/50' : 'border-[#e2e6ea] bg-white'}`} data-testid="action-row">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-3">
        <input type="checkbox" checked={checked} onChange={() => onToggle(a.id)} aria-label={`Select action ${a.seq}`} className="h-4 w-4 accent-teal-600" />
        <span className="w-[74px] shrink-0 text-[12.5px] font-bold text-[#101828]">Action {a.seq}</span>
        <div className="min-w-[180px] flex-1">
          <div className="text-[13px] font-semibold text-[#101828]">{s.title}</div>
          <div className="text-[11.5px] text-[#8a97a3]">{kinds[a.kind] ?? a.kind} · {a.log_label} · {formatDateTime(a.created_at)}</div>
        </div>
        {s.verdict && <StatusBadge status={badgeStatus(s.verdict)} className="!px-1.5 !py-0.5 !text-[10px]" />}
        <span className="text-right text-[12.5px] font-semibold text-[#101828]">{s.total != null ? money(s.total) : <span className="font-normal text-[#8a97a3]">no total</span>}</span>
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Show details" className="rounded-md p-1 text-[#5c6b7a] hover:bg-[#f2f4f6]">
          <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {open && (
        <div className="border-t border-[#eef1f4] px-3.5 py-3 text-[12px] text-[#344054]">
          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            <div className="flex justify-between gap-3"><dt className="text-[#8a97a3]">Started at</dt><dd>{money(s.start_total)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-[#8a97a3]">Total</dt><dd>{money(s.total)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-[#8a97a3]">Loss</dt><dd>{money(s.loss)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-[#8a97a3]">Compliant total</dt><dd>{money(s.compliant_total)}</dd></div>
            {s.order?.length > 0 && <div className="flex justify-between gap-3"><dt className="text-[#8a97a3]">Order</dt><dd>{s.order.join(' → ')}</dd></div>}
            {s.candidates != null && <div className="flex justify-between gap-3"><dt className="text-[#8a97a3]">Candidate events</dt><dd>{s.candidates}</dd></div>}
          </dl>
          {s.changes?.length > 0 && (
            <ul className="mt-2 border-t border-[#eef1f4] pt-2">
              {s.changes.map((c) => <li key={`${c.node}-${c.field}`}>{c.node} {c.field}: {c.before != null ? `${money(c.before)} → ` : 'set to '}<b>{c.before != null ? money(c.after) : c.after}</b></li>)}
            </ul>
          )}
          {s.outcomes?.map((o) => <div key={o.label} className="mt-1">{o.label}: total <b>{money(o.total)}</b>, loss <b>{money(o.loss)}</b></div>)}
          {s.note && <p className="mt-2 text-[#5c6b7a]">{s.note}</p>}
          <button onClick={() => onOpen(a)} className="mt-2.5 inline-flex items-center gap-1.5 font-semibold text-teal-600 hover:underline"><ExternalLink size={13} /> Open this again</button>
        </div>
      )}
    </li>
  )
}

function CompareReport({ report }) {
  const cols = report.columns
  const first = cols[0].seq
  const rows = [
    ['Case', (c) => c.case_id ?? '—'],
    ['Event log', (c) => c.log_label ?? '—'],
    ['Verdict', (c) => (c.verdict ? <StatusBadge status={badgeStatus(c.verdict)} className="!px-1.5 !py-0.5 !text-[10px]" /> : '—')],
    ['Order', (c) => (c.order.length ? c.order.join(' → ') : '—')],
    ['Total', (c) => <b>{money(c.total)}</b>],
    ['Moved from its start', (c) => signed(c.moved)],
    [`Total vs Action ${first}`, (c) => (c.seq === first ? '—' : signed(c.total_vs_first))],
    ['Loss', (c) => money(c.loss)],
    [`Loss vs Action ${first}`, (c) => (c.seq === first ? '—' : signed(c.loss_vs_first))],
    ['Compliant total', (c) => money(c.compliant_total)],
  ]
  const download = () => {
    const url = URL.createObjectURL(new Blob([compareReportText(report)], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `comparison-actions-${cols.map((c) => c.seq).join('_')}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <Card id="compare-report">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[15px] font-bold text-[#101828]">Comparison of actions {cols.map((c) => c.seq).join(', ')}</div>
        <button onClick={download} className="inline-flex items-center gap-1.5 rounded-lg border border-[#e2e6ea] px-3 py-1.5 text-[12px] font-semibold hover:bg-[#f2f4f6]"><Download size={13} /> Download report</button>
      </div>
      <div className="text-[12.5px] font-bold text-[#101828]">What the comparison shows</div>
      <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5 text-[12.5px] leading-snug text-[#344054]" data-testid="findings">
        {report.findings.map((f) => <li key={f}>{f}</li>)}
      </ul>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-[12px]">
          <thead>
            <tr className="border-b border-[#e2e6ea]">
              <th className="py-2 pr-3" />
              {cols.map((c) => <th key={c.id} className="py-2 pr-3 align-bottom font-semibold text-[#101828]"><div>Action {c.seq}</div><div className="font-normal text-[#8a97a3]">{c.title}</div></th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, cell]) => (
              <tr key={label} className="border-b border-[#eef1f4]">
                <td className="whitespace-nowrap py-1.5 pr-3 text-[#8a97a3]">{label}</td>
                {cols.map((c) => <td key={c.id} className="py-1.5 pr-3">{cell(c)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {report.node_rows.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <div className="mb-1 text-[12.5px] font-bold text-[#101828]">Node values that changed</div>
          <table className="w-full min-w-[520px] text-left text-[12px]">
            <thead><tr className="border-b border-[#e2e6ea] text-[#8a97a3]"><th className="py-1.5 pr-3 font-semibold">Node</th>{cols.map((c) => <th key={c.id} className="py-1.5 pr-3 font-semibold">Action {c.seq}</th>)}</tr></thead>
            <tbody>
              {report.node_rows.map((r) => (
                <tr key={`${r.node}-${r.field}`} className="border-b border-[#eef1f4]">
                  <td className="py-1.5 pr-3 font-semibold">{r.node} {r.field}</td>
                  {cols.map((c) => {
                    const v = r.values[String(c.seq)]
                    return <td key={c.id} className="py-1.5 pr-3">{!v ? <span className="text-[#8a97a3]">unchanged</span> : v.before != null ? `${money(v.before)} → ${money(v.after)}` : `set to ${v.after}`}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

export default function History() {
  const navigate = useNavigate()
  const { activeLog, activateLog } = useSession()
  const historyApi = useApi(useCallback(() => getHistory(), []))
  const [picked, setPicked] = useState([])
  const [report, setReport] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const compare = async () => {
    setBusy(true)
    setError(null)
    try {
      setReport(await compareActions(picked))
      setTimeout(() => document.getElementById('compare-report')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const reopen = async (a) => {
    if (a.log_id && a.log_id !== activeLog?.id) activateLog((await openLog(a.log_id)).log)
    const lim = a.params.limits
    navigate(a.kind === 'swap'
      ? scenarioPath(a.case_id, a.params.subset, a.params.order, { maxHops: lim.max_hops, minEvents: lim.min_events, maxEvents: lim.max_events })
      : a.kind === 'run_case' ? '/replay-console' : '/ledger')
  }

  if (historyApi.loading) return <LoadingState label="Loading your history…" />
  if (historyApi.error) return <ErrorState error={historyApi.error} onRetry={historyApi.refetch} />
  const { actions, kinds } = historyApi.data
  if (!actions.length) return <EmptyState label="Nothing here yet. Run a case in the Replay Console and it will appear as Action 1." />

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e2e6ea] bg-white/95 px-4 py-2.5 shadow-card backdrop-blur">
        <span className="text-[12.5px] text-[#5c6b7a]">{picked.length ? `${picked.length} selected` : 'Tick two or more actions to compare them.'}</span>
        <div className="flex items-center gap-2">
          {picked.length > 0 && <button onClick={() => { setPicked([]); setReport(null) }} className="rounded-lg px-3 py-2 text-[12.5px] font-semibold text-[#5c6b7a] hover:bg-[#f2f4f6]">Clear</button>}
          <button onClick={compare} disabled={picked.length < 2 || busy} data-testid="compare" className="inline-flex items-center gap-2 rounded-lg bg-navy-900 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-navy-800 disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <GitCompareArrows size={14} />} Compare
          </button>
        </div>
      </div>
      {error && <p className="rounded-lg bg-status-blockedBg px-3 py-2 text-[12.5px] text-status-blocked" role="alert">{error}</p>}
      {report && <CompareReport report={report} />}
      <ul className="flex flex-col gap-2">
        {actions.map((a) => <ActionRow key={a.id} action={a} kinds={kinds} checked={picked.includes(a.id)} onToggle={(id) => setPicked((p) => toggleId(p, id))} onOpen={reopen} />)}
      </ul>
    </div>
  )
}
