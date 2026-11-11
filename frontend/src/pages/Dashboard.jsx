import { useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Database } from 'lucide-react'
import AnimatedNumber from '../components/AnimatedNumber'
import { HowItWorksStrip } from '../components/HowItWorks'
import { useApi } from '../lib/useApi'
import { getDashboard, getCases } from '../lib/api'
import StatCard from '../components/StatCard'
import Card from '../components/Card'
import PreviewTag from '../components/PreviewTag'
import { LoadingState, ErrorState } from '../components/StatusStates'
import LoadLog from '../components/LoadLog'
import { useSession } from '../lib/session'
import { formatAmount, formatEur, formatInrCr, formatDateTime } from '../lib/format'

// No log yet: this is where the user chooses one. After that: the dashboard of that log.
export default function Dashboard() {
  const { activeLog } = useSession()
  return activeLog ? <LogDashboard log={activeLog} /> : <LoadLog />
}

function LogDashboard({ log }) {
  const navigate = useNavigate()
  const dashboardApi = useApi(useCallback(() => getDashboard(), []))
  const casesApi = useApi(useCallback(() => getCases(), []))

  if (dashboardApi.loading || casesApi.loading) return <LoadingState label="Loading dashboard…" />
  if (dashboardApi.error)
    return <ErrorState error={dashboardApi.error} onRetry={dashboardApi.refetch} />
  if (casesApi.error) return <ErrorState error={casesApi.error} onRetry={casesApi.refetch} />

  const dash = dashboardApi.data
  const recentCases = (casesApi.data?.cases || []).slice(0, 5)

  return (
    <div className="rs-stagger flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#e3e7ec] bg-white px-4 py-3 shadow-card" data-testid="active-log">
        <span className="flex min-w-0 items-center gap-2.5 text-[13px] text-[#5c6b7a]">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-teal-500/10 text-teal-500"><Database size={14} /></span>
          <span className="truncate">Event log: <b className="text-[#101828]">{log.label}</b></span>
        </span>
        <Link to="/profile" className="rounded-lg px-2.5 py-1 text-[12.5px] font-semibold text-teal-600 transition-colors hover:bg-teal-500/10">Change log</Link>
      </div>
      <div className="flex flex-wrap gap-4">
        <StatCard
          label="Total Cases"
          value={<AnimatedNumber value={dash.available_cases ?? 0} format={(n) => formatNum(Math.round(Number(n)))} from={0} ms={1100} />}
          sublabel={`From ${log.label}`}
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

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[15px] font-bold text-[#101828]">How ReplaySemantics works</div>
            <div className="mt-0.5 text-[12px] text-[#5c6b7a]">
              It replays corrections on a realised ERP loss and refuses to give a number when the order of events makes it ambiguous.
            </div>
          </div>
          <Link
            to="/replay-console"
            className="rs-press group inline-flex items-center gap-2 rounded-xl bg-navy-900 px-4 py-2.5 text-[12.5px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_10px_20px_-10px_rgba(13,27,41,0.7)] hover:bg-navy-800"
          >
            Open Replay Console <ArrowRight size={14} className="transition-transform duration-300 ease-out group-hover:translate-x-1" />
          </Link>
        </div>
        <HowItWorksStrip />
      </Card>

      <Card className="!p-0 overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#e2e6ea] px-5 py-4">
          <div className="text-[15px] font-bold text-[#101828]">Recent Cases</div>
          <button
            onClick={() => navigate('/cases')}
            className="group inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[13px] font-semibold text-teal-600 hover:bg-teal-500/10"
          >
            View all <ArrowRight size={14} className="transition-transform duration-300 ease-out group-hover:translate-x-0.5" />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-[#e2e6ea] text-[11px] uppercase tracking-wide text-[#667585]">
                <th className="px-5 py-3 font-semibold">Case ID</th>
                <th className="px-5 py-3 font-semibold">Realized Loss</th>
                <th className="px-5 py-3 font-semibold">Candidate Events</th>
                <th className="px-5 py-3 font-semibold">Pipeline</th>
                <th className="px-5 py-3 font-semibold">Updated</th>
              </tr>
            </thead>
            <tbody className="rs-rows">
              {recentCases.map((c) => (
                <tr
                  key={c.case_id}
                  className="cursor-pointer border-b border-[#eef1f4] last:border-0 hover:bg-[#edf1f5]"
                  onClick={() => navigate('/replay-console', { state: { caseId: c.case_id } })}
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate('/replay-console', { state: { caseId: c.case_id } }) }}
                >
                  <td className="whitespace-nowrap px-5 py-3 font-semibold text-[#101828]">{c.case_id}</td>
                  <td className="px-5 py-3">{c.realized_loss != null ? formatAmount(c.realized_loss) : formatEur(c.value_eur)}</td>
                  <td className="px-5 py-3">{c.max_candidates_at_default_hops ?? '—'}</td>
                  <td className="px-5 py-3">
                    <span
                      className="rounded-md bg-status-idleBg px-2.5 py-1 text-[11px] font-semibold text-status-idle"
                      title={c.realized_loss != null ? 'Every stage runs on this case' : 'These events carry no pricing fields, so replay and verdicts do not apply'}
                    >
                      {c.realized_loss != null ? 'all stages (synthetic)' : 'stages 1–2b'}
                    </span>
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
