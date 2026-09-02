import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi } from '../lib/useApi'
import { getCases } from '../lib/api'
import Card from '../components/Card'
import StatusBadge from '../components/StatusBadge'
import PreviewTag from '../components/PreviewTag'
import { LoadingState, ErrorState, EmptyState } from '../components/StatusStates'
import { formatEur, formatDateTime } from '../lib/format'
import { previewStatusFor, previewPolicyVersionFor } from '../data/mockData'
import { useSelectedCase } from '../lib/SelectedCaseContext'

const TABS = ['All', 'PASS', 'POLICY-ORDERED', 'BLOCKED']
const PAGE_SIZE = 6

export default function Cases() {
  const navigate = useNavigate()
  const { setSelectedCaseId } = useSelectedCase()
  const casesApi = useApi(useCallback(() => getCases(), []))
  const [tab, setTab] = useState('All')
  const [page, setPage] = useState(1)

  const enriched = useMemo(() => {
    const raw = casesApi.data?.cases || []
    return raw.map((c) => ({
      ...c,
      previewStatus: previewStatusFor(c.case_id),
      previewPolicy: previewPolicyVersionFor(c.case_id),
    }))
  }, [casesApi.data])

  const counts = useMemo(() => {
    const c = { All: enriched.length, PASS: 0, 'POLICY-ORDERED': 0, BLOCKED: 0 }
    enriched.forEach((r) => c[r.previewStatus]++)
    return c
  }, [enriched])

  const filtered = tab === 'All' ? enriched : enriched.filter((r) => r.previewStatus === tab)
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
                {counts[t] ?? 0}
              </span>
            </button>
          ))}
          <div className="ml-auto">
            <PreviewTag label="Status is preview" />
          </div>
        </div>

        {pageRows.length === 0 ? (
          <EmptyState label="No cases match this filter." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-[#e2e6ea] text-[11px] uppercase tracking-wide text-[#8a97a3]">
                  <th className="px-5 py-3 font-semibold">Case ID</th>
                  <th className="px-5 py-3 font-semibold">Realized Loss</th>
                  <th className="px-5 py-3 font-semibold">Candidate Events</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
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
                    <td className="px-5 py-3">{formatEur(c.value_eur)}</td>
                    <td className="px-5 py-3">{c.max_candidates_at_default_hops}</td>
                    <td className="px-5 py-3">
                      <StatusBadge status={c.previewStatus} />
                    </td>
                    <td className="px-5 py-3 text-[#5c6b7a]">{c.previewPolicy}</td>
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
            Showing {(page - 1) * PAGE_SIZE + 1}
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
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                onClick={() => setPage(n)}
                className={`h-7 w-7 rounded-md text-[12px] font-semibold ${
                  n === page ? 'bg-navy-900 text-white' : 'hover:bg-[#f2f4f6]'
                }`}
              >
                {n}
              </button>
            ))}
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
