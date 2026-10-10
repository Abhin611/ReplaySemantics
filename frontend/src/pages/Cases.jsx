import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi } from '../lib/useApi'
import { getCases, getBenchmarkVerdicts } from '../lib/api'
import Card from '../components/Card'
import StatusBadge from '../components/StatusBadge'
import { LoadingState, ErrorState, EmptyState } from '../components/StatusStates'
import { formatEur, formatDateTime, formatAmount } from '../lib/format'
import { badgeStatus } from '../lib/verdict'
import { useSelectedCase } from '../lib/SelectedCaseContext'

const TABS = ['All', 'PASS', 'POLICY-ORDERED', 'BLOCKED', 'Real SAP data']
const PAGE_SIZE = 10
const SYNTHETIC = 'benchmark (synthetic)'

// Page numbers with gaps: 1 … 4 5 [6] 7 8 … 17
function pageWindow(page, total) {
  const keep = new Set([1, total, page - 1, page, page + 1])
  const out = []
  let prev = 0
  ;[...keep].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b).forEach((n) => {
    if (n - prev > 1) out.push('…')
    out.push(n)
    prev = n
  })
  return out
}

export default function Cases() {
  const navigate = useNavigate()
  const { setSelectedCaseId } = useSelectedCase()
  const casesApi = useApi(useCallback(() => getCases(), []))
  const [tab, setTab] = useState('All')
  const [page, setPage] = useState(1)

  // Real verdicts come from the confluence checker (runs + caches per case on the backend). Fetched
  // separately so the case list never waits on it; absent when no benchmark has been generated.
  const verdictsApi = useApi(useCallback(() => getBenchmarkVerdicts(), []))
  const verdicts = verdictsApi.data?.verdicts

  const enriched = useMemo(() => {
    const raw = casesApi.data?.cases || []
    return raw.map((c) => {
      const synthetic = c.source === SYNTHETIC
      const v = synthetic ? verdicts?.[c.case_id] : null
      return {
        ...c,
        synthetic,
        status: v ? badgeStatus(v.classification) : null, // null for real VBFA cases: no verdict exists
        candidates: synthetic ? v?.num_candidates ?? null : c.max_candidates_at_default_hops,
      }
    })
  }, [casesApi.data, verdicts])

  const counts = useMemo(() => {
    const c = { All: enriched.length, PASS: 0, 'POLICY-ORDERED': 0, BLOCKED: 0, 'Real SAP data': 0 }
    enriched.forEach((r) => {
      if (!r.synthetic) c['Real SAP data']++
      else if (r.status) c[r.status]++
    })
    return c
  }, [enriched])

  const verdictTab = ['PASS', 'POLICY-ORDERED', 'BLOCKED'].includes(tab)
  const filtered =
    tab === 'All'
      ? enriched
      : tab === 'Real SAP data'
      ? enriched.filter((r) => !r.synthetic)
      : enriched.filter((r) => r.status === tab)
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const openInConsole = (caseId) => {
    setSelectedCaseId(caseId)
    navigate('/replay-console')
  }

  if (casesApi.loading) return <LoadingState label="Loading cases…" />
  if (casesApi.error) return <ErrorState error={casesApi.error} onRetry={casesApi.refetch} />

  return (
    <div className="flex flex-col gap-4">
      <Card className="!p-0 overflow-hidden">
        <div className="flex items-center gap-1 border-b border-[#e2e6ea] px-4 py-3">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t)
                setPage(1)
              }}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                tab === t ? 'bg-navy-900 text-white' : 'text-[#5c6b7a] hover:bg-[#f2f4f6]'
              }`}
            >
              {t}
              <span
                className={`rounded-full px-1.5 text-[11px] ${
                  tab === t ? 'bg-white/20' : 'bg-[#eef1f4]'
                }`}
              >
                {verdictsApi.loading && ['PASS', 'POLICY-ORDERED', 'BLOCKED'].includes(t) ? '…' : counts[t] ?? 0}
              </span>
            </button>
          ))}
          <div className="ml-auto text-[11.5px] text-[#8a97a3]">
            {verdictsApi.loading
              ? 'Checking verdicts…'
              : verdicts
              ? 'Verdicts are real (confluence checker) · synthetic cases only'
              : 'No benchmark generated — real SAP cases only'}
          </div>
        </div>

        {pageRows.length === 0 && verdictTab && verdictsApi.loading ? (
          <EmptyState label="Checking verdicts with the confluence checker…" />
        ) : pageRows.length === 0 ? (
          <EmptyState label={verdictTab && !verdicts ? 'No benchmark generated, so there are no verdicts to filter.' : 'No cases match this filter.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-[#e2e6ea] text-[11px] uppercase tracking-wide text-[#8a97a3]">
                  <th className="px-5 py-3 font-semibold">Case ID</th>
                  <th className="px-5 py-3 font-semibold">Source</th>
                  <th className="px-5 py-3 font-semibold">Value / Loss</th>
                  <th className="px-5 py-3 font-semibold">Candidate Events</th>
                  <th className="px-5 py-3 font-semibold">Verdict</th>
                  <th className="px-5 py-3 font-semibold">Policy Version</th>
                  <th className="px-5 py-3 font-semibold">Updated</th>
                  <th className="px-5 py-3 font-semibold">Curation Note</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((c) => (
                  <tr
                    key={c.case_id}
                    className="cursor-pointer border-b border-[#eef1f4] last:border-0 hover:bg-[#f7f9fa]"
                    onClick={() => openInConsole(c.case_id)}
                  >
                    <td className="px-5 py-3 font-semibold text-[#101828]">{c.case_id}</td>
                    <td className="px-5 py-3 text-[11.5px] text-[#5c6b7a]">
                      {c.synthetic ? 'synthetic benchmark' : 'real SAP (VBFA)'}
                    </td>
                    <td className="px-5 py-3">
                      {c.synthetic ? formatAmount(c.realized_loss) : formatEur(c.value_eur)}
                    </td>
                    <td className="px-5 py-3">{c.candidates ?? '…'}</td>
                    <td className="px-5 py-3">
                      {c.status ? (
                        <StatusBadge status={c.status} />
                      ) : c.synthetic ? (
                        <span className="text-[11.5px] text-[#8a97a3]">{verdictsApi.loading ? '…' : '—'}</span>
                      ) : (
                        <span
                          className="rounded-md bg-status-idleBg px-2.5 py-1 text-[11px] font-semibold text-status-idle"
                          title="Real SAP events carry no pricing fields, so replay and verdicts do not apply"
                        >
                          stages 1–2b only
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-[#5c6b7a]">{c.synthetic ? c.policy_version : '—'}</td>
                    <td className="px-5 py-3 text-[#5c6b7a]">{formatDateTime(c.timestamp)}</td>
                    <td className="px-5 py-3 text-[#8a97a3]">{c.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-[#e2e6ea] px-5 py-3 text-[13px] text-[#5c6b7a]">
          <span>
            Showing {filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}
            {'–'}
            {Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length} cases
          </span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-md px-2 py-1 hover:bg-[#f2f4f6] disabled:opacity-30"
            >
              ‹
            </button>
            {pageWindow(page, totalPages).map((n, i) =>
              n === '…' ? (
                <span key={`gap-${i}`} className="px-1 text-[#8a97a3]">
                  …
                </span>
              ) : (
                <button
                  key={n}
                  onClick={() => setPage(n)}
                  className={`h-7 min-w-[28px] rounded-md px-1 text-[12px] font-semibold ${
                    n === page ? 'bg-navy-900 text-white' : 'hover:bg-[#f2f4f6]'
                  }`}
                >
                  {n}
                </button>
              )
            )}
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-md px-2 py-1 hover:bg-[#f2f4f6] disabled:opacity-30"
            >
              ›
            </button>
          </div>
        </div>
      </Card>
    </div>
  )
}
