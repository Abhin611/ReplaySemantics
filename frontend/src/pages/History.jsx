import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Check, CheckSquare, ChevronDown, Download, ExternalLink, GitCompareArrows, Loader2, MinusSquare, Trash2 } from 'lucide-react'
import Card from '../components/Card'
import StatusBadge from '../components/StatusBadge'
import { EmptyState, ErrorState, LoadingState } from '../components/StatusStates'
import { useApi } from '../lib/useApi'
import { compareActions, deleteActions, deleteAllActions, getHistory, openLog } from '../lib/api'
import { useSession } from '../lib/session'
import { badgeStatus } from '../lib/verdict'
import { formatDateTime } from '../lib/format'
import { formatPrecise, formatSigned, scenarioPath } from '../lib/scenario'
import { compareReportText, toggleId } from '../lib/history'

const money = (x) => (x === null || x === undefined ? '—' : formatPrecise(x))
const signed = (x) => (x === null || x === undefined ? '—' : formatSigned(x))
// a figure that moved is tinted; one that did not stays quiet
const moved = (x) => (x === null || x === undefined || Number(x) === 0 ? 'text-[#667585]' : 'font-semibold text-status-ordered')

function Detail({ label, children }) {
  return <div className="flex justify-between gap-3 border-b border-[#eef1f4] py-1.5"><dt className="text-[#667585]">{label}</dt><dd className="text-right font-semibold text-[#101828]">{children}</dd></div>
}

function ActionRow({ action: a, kinds, checked, leaving, onToggle, onOpen }) {
  const [open, setOpen] = useState(false)
  const s = a.snapshot
  return (
    <li className={`${leaving ? 'rs-action-leave ' : ''}rounded-2xl border bg-white shadow-card transition-[border-color,box-shadow,background-color] duration-300 ${
      checked ? 'border-teal-500/70 bg-teal-50/40 shadow-[0_0_0_3px_rgba(42,157,143,0.10)]' : 'border-[#e3e7ec] hover:border-[#cbd3da]'}`} data-testid="action-row">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
        <label className="flex cursor-pointer items-center gap-3">
          <input type="checkbox" checked={checked} onChange={() => onToggle(a.id)} aria-label={`Select action ${a.seq}`} className="peer sr-only" />
          <span className={`flex h-5 w-5 items-center justify-center rounded-md border transition-[background-color,border-color] duration-200 peer-focus-visible:ring-4 peer-focus-visible:ring-teal-500/25 ${
            checked ? 'border-teal-500 bg-teal-500 text-white' : 'border-[#b9c2cb] bg-white text-transparent hover:border-teal-500'}`} aria-hidden="true">
            <Check size={13} strokeWidth={3} className={checked ? 'rs-pop' : ''} />
          </span>
          <span className="w-[70px] shrink-0 text-[12.5px] font-bold text-[#101828]">Action {a.seq}</span>
        </label>
        <div className="min-w-[180px] flex-1">
          <div className="text-[13px] font-semibold text-[#101828]">{s.title}</div>
          <div className="mt-0.5 text-[11.5px] text-[#667585]">{kinds[a.kind] ?? a.kind} · {a.log_label} · {formatDateTime(a.created_at)}</div>
        </div>
        {s.verdict && <StatusBadge status={badgeStatus(s.verdict)} className="!py-0.5 !text-[10px]" />}
        <span className="min-w-[96px] text-right text-[13px] font-bold text-[#101828]">{s.total != null ? money(s.total) : <span className="font-normal text-[#667585]">no total</span>}</span>
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Show details" className="flex h-8 w-8 items-center justify-center rounded-lg text-[#5c6b7a] hover:bg-[#eef1f4]">
          <ChevronDown size={16} className={`transition-transform duration-300 ease-out ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      <div className={`rs-collapse ${open ? 'is-open' : ''}`}>
        <div inert={open ? undefined : ''}>
          <div className="border-t border-[#eef1f4] px-4 pb-3.5 pt-2 text-[12px] text-[#344054]">
            <dl className="grid gap-x-8 sm:grid-cols-2">
              <Detail label="Started at">{money(s.start_total)}</Detail>
              <Detail label="Total">{money(s.total)}</Detail>
              <Detail label="Loss">{money(s.loss)}</Detail>
              <Detail label="Compliant total">{money(s.compliant_total)}</Detail>
              {s.order?.length > 0 && <Detail label="Order">{s.order.join(' → ')}</Detail>}
              {s.candidates != null && <Detail label="Candidate events">{s.candidates}</Detail>}
            </dl>
            {s.changes?.length > 0 && (
              <ul className="mt-2.5 flex flex-col gap-1">
                {s.changes.map((c) => <li key={`${c.node}-${c.field}`}>{c.node} {c.field}: {c.before != null ? `${money(c.before)} → ` : 'set to '}<b className="text-status-ordered">{c.before != null ? money(c.after) : c.after}</b></li>)}
              </ul>
            )}
            {s.outcomes?.map((o) => <div key={o.label} className="mt-1">{o.label}: total <b>{money(o.total)}</b>, loss <b>{money(o.loss)}</b></div>)}
            {s.note && <p className="mt-2 text-[#5c6b7a]">{s.note}</p>}
            <button onClick={() => onOpen(a)} className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 font-semibold text-teal-600 hover:bg-teal-500/10"><ExternalLink size={13} /> Open this again</button>
          </div>
        </div>
      </div>
    </li>
  )
}

function CompareReport({ report }) {
  const cols = report.columns
  const first = cols[0].seq
  const rows = [
    ['Case', (c) => c.case_id ?? '—'],
    ['Event log', (c) => c.log_label ?? '—'],
    ['Verdict', (c) => (c.verdict ? <StatusBadge status={badgeStatus(c.verdict)} className="!py-0.5 !text-[10px]" /> : '—')],
    ['Order', (c) => (c.order.length ? c.order.join(' → ') : '—')],
    ['Total', (c) => <b className="text-[13px]">{money(c.total)}</b>],
    ['Moved from its start', (c) => <span className={moved(c.moved)}>{signed(c.moved)}</span>],
    [`Total vs Action ${first}`, (c) => (c.seq === first ? '—' : <span className={moved(c.total_vs_first)}>{signed(c.total_vs_first)}</span>)],
    ['Loss', (c) => money(c.loss)],
    [`Loss vs Action ${first}`, (c) => (c.seq === first ? '—' : <span className={moved(c.loss_vs_first)}>{signed(c.loss_vs_first)}</span>)],
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
    <Card id="compare-report" className="rs-fade scroll-mt-[72px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[16px] font-bold text-[#101828]">Comparison of actions {cols.map((c) => c.seq).join(', ')}</h2>
        <button onClick={download} className="rs-btn rs-btn-sm rs-btn-quiet"><Download size={13} /> Download report</button>
      </div>
      <div className="rounded-2xl bg-[#edf1f5] px-4 py-3.5">
        <div className="text-[12.5px] font-bold text-[#101828]">What the comparison shows</div>
        <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-[12.5px] leading-snug text-[#344054] marker:text-teal-500" data-testid="findings">
          {report.findings.map((f) => <li key={f}>{f}</li>)}
        </ul>
      </div>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-[12px]">
          <thead>
            <tr className="border-b border-[#e2e6ea]">
              <th className="py-2 pr-3" />
              {cols.map((c) => <th key={c.id} className="py-2 pr-3 align-bottom font-bold text-[#101828]"><div>Action {c.seq}</div><div className="font-normal text-[#667585]">{c.title}</div></th>)}
            </tr>
          </thead>
          <tbody className="rs-rows">
            {rows.map(([label, cell]) => (
              <tr key={label} className="border-b border-[#eef1f4] last:border-0 hover:bg-[#edf1f5]">
                <td className="whitespace-nowrap py-2 pl-2.5 pr-3 text-[#667585]">{label}</td>
                {cols.map((c) => <td key={c.id} className="py-2 pr-3">{cell(c)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {report.node_rows.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <div className="mb-1 text-[12.5px] font-bold text-[#101828]">Node values that changed</div>
          <table className="w-full min-w-[520px] text-left text-[12px]">
            <thead><tr className="border-b border-[#e2e6ea] text-[#667585]"><th className="py-1.5 pl-2.5 pr-3 font-semibold">Node</th>{cols.map((c) => <th key={c.id} className="py-1.5 pr-3 font-semibold">Action {c.seq}</th>)}</tr></thead>
            <tbody className="rs-rows">
              {report.node_rows.map((r) => (
                <tr key={`${r.node}-${r.field}`} className="border-b border-[#eef1f4] last:border-0 hover:bg-[#edf1f5]">
                  <td className="py-2 pl-2.5 pr-3 font-semibold">{r.node} {r.field}</td>
                  {cols.map((c) => {
                    const v = r.values[String(c.seq)]
                    return <td key={c.id} className="py-2 pr-3">{!v ? <span className="text-[#667585]">unchanged</span> : <span className="font-semibold text-status-ordered">{v.before != null ? `${money(v.before)} → ${money(v.after)}` : `set to ${v.after}`}</span>}</td>
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
  const [confirm, setConfirm] = useState(null) // null | 'selected' | 'all': the delete waiting for a second click
  const [deleting, setDeleting] = useState(false)
  const [leaving, setLeaving] = useState([]) // rows playing their exit
  const [removed, setRemoved] = useState([]) // deleted on the server; hidden here without reloading the page

  // Delete on the server first; only then do the rows leave, so nothing disappears that was not really deleted.
  const remove = async (which) => {
    const all = (historyApi.data?.actions ?? []).filter((a) => !removed.includes(a.id)).map((a) => a.id)
    const ids = which === 'all' ? all : picked
    if (!ids.length) return
    setDeleting(true)
    setError(null)
    try {
      if (which === 'all') await deleteAllActions()
      else await deleteActions(ids)
      setConfirm(null)
      setPicked([])
      setReport(null)
      setLeaving(ids)
      setTimeout(() => { setRemoved((r) => [...r, ...ids]); setLeaving([]) }, 380)
    } catch (err) { setError(err.message) } finally { setDeleting(false) }
  }

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
  const kinds = historyApi.data.kinds
  const actions = historyApi.data.actions.filter((a) => !removed.includes(a.id))
  if (!actions.length) return <EmptyState label="Nothing here yet. Run a case in the Replay Console and it will appear as Action 1." />
  const ready = picked.length >= 2
  const allPicked = picked.length === actions.length
  const toggleAll = () => { setPicked(allPicked ? [] : actions.map((a) => a.id)); setConfirm(null) }
  const n = confirm === 'all' ? actions.length : picked.length
  const quiet = 'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <div className="flex flex-col gap-4">
      <div className="rs-glass-light sticky top-[calc(var(--nav-h)+4px)] z-10 rounded-2xl px-4 py-2.5" data-testid="history-bar">
        {confirm ? (
          // the second click: say exactly what will go, and that it cannot be undone
          <div key={confirm} className="rs-fade flex flex-wrap items-center justify-between gap-3" role="alertdialog" aria-label="Confirm delete">
            <span className="flex items-center gap-2.5 text-[12.5px] text-[#7a1a14]">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-status-blockedBg text-status-blocked"><AlertTriangle size={14} /></span>
              <span>
                <b>{confirm === 'all' ? `Delete all ${n} actions?` : `Delete ${n} selected action${n === 1 ? '' : 's'}?`}</b>{' '}
                This removes {n === 1 ? 'it' : 'them'} from your history for good.
              </span>
            </span>
            <div className="flex items-center gap-2">
              <button onClick={() => setConfirm(null)} disabled={deleting} className={`${quiet} text-[#5c6b7a] hover:bg-[#e6ebf0]`}>Cancel</button>
              <button onClick={() => remove(confirm)} disabled={deleting} data-testid="confirm-delete"
                className="inline-flex items-center gap-2 rounded-xl bg-status-blocked px-4 py-2 text-[12.5px] font-bold text-white shadow-[0_10px_20px_-12px_rgba(179,38,30,0.8)] hover:bg-[#9a1f18] disabled:opacity-60">
                {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2.5 text-[12.5px] text-[#5c6b7a]">
              <button onClick={toggleAll} className={`${quiet} -ml-2 text-[#344054] hover:bg-[#e6ebf0]`} data-testid="select-all">
                {allPicked ? <MinusSquare size={15} /> : <CheckSquare size={15} />} {allPicked ? 'Select none' : 'Select all'}
              </button>
              {picked.length > 0 && <span key={picked.length} className="rs-pop flex h-6 min-w-[24px] items-center justify-center rounded-full bg-teal-500 px-1.5 text-[11.5px] font-bold text-white">{picked.length}</span>}
              {picked.length === 0 ? 'Tick two or more actions to compare them, or tick any to delete.' : picked.length === 1 ? 'selected. Tick one more to compare.' : 'selected'}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {picked.length > 0 && <button onClick={() => { setPicked([]); setReport(null) }} className={`${quiet} text-[#5c6b7a] hover:bg-[#e6ebf0]`}>Clear</button>}
              <button onClick={() => setConfirm('selected')} disabled={!picked.length} data-testid="delete-selected"
                className={`${quiet} text-status-blocked hover:bg-status-blockedBg`}>
                <Trash2 size={14} /> Delete selected
              </button>
              <button onClick={() => setConfirm('all')} data-testid="delete-all" className={`${quiet} text-status-blocked hover:bg-status-blockedBg`}>
                <Trash2 size={14} /> Delete all
              </button>
              <button onClick={compare} disabled={!ready || busy} data-testid="compare" className="rs-btn rs-btn-primary">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <GitCompareArrows size={14} />} Compare
              </button>
            </div>
          </div>
        )}
      </div>
      {error && <p className="rs-fade rounded-xl bg-status-blockedBg px-3.5 py-2.5 text-[12.5px] text-status-blocked" role="alert">{error}</p>}
      {report && <CompareReport report={report} />}
      <ul className="rs-cascade flex flex-col gap-2.5">
        {actions.map((a) => (
          <ActionRow key={a.id} action={a} kinds={kinds} leaving={leaving.includes(a.id)} checked={picked.includes(a.id)}
            onToggle={(id) => { setConfirm(null); setPicked((p) => toggleId(p, id)) }} onOpen={reopen} />
        ))}
      </ul>
    </div>
  )
}
