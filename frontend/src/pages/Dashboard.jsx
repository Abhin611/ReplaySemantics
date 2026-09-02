import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi } from '../lib/useApi'
import { getDashboard, getCases } from '../lib/api'
import StatCard from '../components/StatCard'
import Card from '../components/Card'
import StatusBadge from '../components/StatusBadge'
import PreviewTag from '../components/PreviewTag'
import { LoadingState, ErrorState } from '../components/StatusStates'
import { formatEur, formatInrCr, formatDateTime } from '../lib/format'
import { previewStatusFor, previewPolicyVersionFor } from '../data/mockData'

export default function Dashboard() {
  const navigate = useNavigate()
  const dashboardApi = useApi(useCallback(() => getDashboard(), []))
  const casesApi = useApi(useCallback(() => getCases(), []))

  if (dashboardApi.loading || casesApi.loading) return <LoadingState label="Loading dashboard…" />
  if (dashboardApi.error)
    return <ErrorState error={dashboardApi.error} onRetry={dashboardApi.refetch} />
  if (casesApi.error) return <ErrorState error={casesApi.error} onRetry={casesApi.refetch} />

  const dash = dashboardApi.data
  const recentCases = (casesApi.data?.cases || []).slice(0, 8)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-4">
        <StatCard
          label="Total Cases"
          value={formatNum(dash.available_cases)}
          sublabel="From ingested VBFA log"
        />
        <StatCard
          label={
            <span className="inline-flex items-center gap-1.5">
              Pending Review <PreviewTag />
            </span>
          }
          value="47"
          sublabel="Requires action"
        />
        <StatCard
          label={
            <span className="inline-flex items-center gap-1.5">
              Blocked Attributions <PreviewTag />
            </span>
          }
          value="12"
          sublabel="Manual override needed"
          tone="danger"
        />
        <StatCard
          label="Total Case Value"
          value={formatEur(dash.total_case_value_eur)}
          sublabel={formatInrCr(dash.total_case_value_inr_cr)}
        />
      </div>

      <Card className="!p-0 overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#e2e6ea] px-5 py-4">
          <div className="text-[15px] font-bold text-[#101828]">Recent Cases</div>
          <button
            onClick={() => navigate('/cases')}
            className="text-[13px] font-semibold text-teal-500 hover:underline"
          >
            View all →
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-[#e2e6ea] text-[11px] uppercase tracking-wide text-[#8a97a3]">
                <th className="px-5 py-3 font-semibold">Case ID</th>
                <th className="px-5 py-3 font-semibold">Realized Loss</th>
                <th className="px-5 py-3 font-semibold">Candidate Events</th>
                <th className="px-5 py-3 font-semibold">
                  Status <PreviewTag className="ml-1 normal-case" />
                </th>
                <th className="px-5 py-3 font-semibold">Updated</th>
              </tr>
            </thead>
            <tbody>
              {recentCases.map((c) => (
                <tr
                  key={c.case_id}
                  className="cursor-pointer border-b border-[#eef1f4] last:border-0 hover:bg-[#f7f9fa]"
                  onClick={() => navigate('/replay-console', { state: { caseId: c.case_id } })}
                >
                  <td className="px-5 py-3 font-semibold text-[#101828]">{c.case_id}</td>
                  <td className="px-5 py-3">{formatEur(c.value_eur)}</td>
                  <td className="px-5 py-3">{c.max_candidates_at_default_hops}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={previewStatusFor(c.case_id)} />
                  </td>
                  <td className="px-5 py-3 text-[#5c6b7a]">{formatDateTime(c.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <div className="text-[13px] text-[#5c6b7a]">
          Pipeline stages implemented:{' '}
          <span className="font-semibold text-status-pass">
            {dash.pipeline_stages_implemented?.join(', ')}
          </span>
          . Pending:{' '}
          <span className="font-semibold text-status-ordered">
            {dash.pipeline_stages_pending?.join(', ')}
          </span>
          .
        </div>
      </Card>
    </div>
  )
}

function formatNum(n) {
  if (n === null || n === undefined) return '—'
  return new Intl.NumberFormat('en-US').format(n)
}
