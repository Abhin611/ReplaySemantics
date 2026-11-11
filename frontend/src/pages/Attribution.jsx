import { useCallback, useEffect, useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useApi } from '../lib/useApi'
import { getCases } from '../lib/api'
import { useSelectedCase } from '../lib/SelectedCaseContext'
import Card from '../components/Card'
import AnimatedNumber from '../components/AnimatedNumber'
import PreviewTag from '../components/PreviewTag'
import RefreshButton from '../components/RefreshButton'
import { LoadingState, ErrorState } from '../components/StatusStates'
import { formatEur } from '../lib/format'
import { mockAttributionFor, previewPolicyVersionFor } from '../data/mockData'

const IN = '#5f86a6' // in the coalition
const OUT = '#e0897f' // excluded

function ShareTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  return (
    <div className="rounded-xl border border-[#e3e7ec] bg-white px-3 py-2 text-[12px] shadow-float">
      <div className="font-bold text-[#101828]">{r.event} <span className="font-normal text-[#5c6b7a]">{r.activity}</span></div>
      <div className="mt-1 text-[#5c6b7a]">φ <b className="text-[#101828]">{r.phi.toFixed(2)}</b> · {formatEur(r.loss)}</div>
      <div className={`mt-0.5 font-semibold ${r.inCoalition ? 'text-status-pass' : 'text-status-blocked'}`}>{r.inCoalition ? 'In coalition' : 'Excluded'}</div>
    </div>
  )
}

export default function Attribution() {
  const { selectedCaseId, setSelectedCaseId } = useSelectedCase()
  const casesApi = useApi(useCallback(() => getCases(), []))
  const cases = casesApi.data?.cases || []

  useEffect(() => {
    if (!selectedCaseId && cases.length) setSelectedCaseId(cases[0].case_id)
  }, [cases, selectedCaseId, setSelectedCaseId])

  const activeCase = cases.find((c) => c.case_id === selectedCaseId)
  const rows = useMemo(
    () => mockAttributionFor(activeCase?.value_eur || 284730),
    [activeCase]
  )
  const totalLoss = rows.reduce((sum, r) => sum + r.loss, 0)

  if (casesApi.loading) return <LoadingState label="Loading cases…" />
  if (casesApi.error) return <ErrorState error={casesApi.error} onRetry={casesApi.refetch} />

  return (
    <div className="rs-stagger flex flex-col gap-4">
      <div className="rs-notice">
        <span className="min-w-[240px] flex-1">
          The Shapley attribution layer (Member 3) isn't wired in yet. Everything on this page is illustrative
          sample data, shaped the way the real endpoint will need to respond.
        </span>
        <div className="flex shrink-0 items-center gap-3">
          <PreviewTag label="Full page preview" />
          {/* inactive on purpose: nothing real to refresh until the attribution engine is wired in */}
          <RefreshButton disabled title="Refresh is inactive: Attribution is still preview data" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <label htmlFor="attribution-case" className="text-[12px] font-medium text-[#5c6b7a]">Case</label>
          <select
            id="attribution-case"
            value={selectedCaseId || ''}
            onChange={(e) => setSelectedCaseId(e.target.value)}
            className="rs-input mt-1.5 w-full !text-[14px] font-bold"
          >
            {cases.map((c) => (
              <option key={c.case_id} value={c.case_id}>
                {c.case_id}
              </option>
            ))}
          </select>
        </Card>
        <Card>
          <div className="text-[12px] font-medium text-[#5c6b7a]">Total Attributed Loss</div>
          <div className="mt-1.5 text-[24px] font-extrabold leading-tight tracking-[-0.03em] text-[#101828]">
            <AnimatedNumber value={totalLoss} format={(n) => formatEur(Math.round(Number(n)))} ms={700} />
          </div>
        </Card>
        <Card>
          <div className="text-[12px] font-medium text-[#5c6b7a]">Policy</div>
          <div className="mt-1.5 font-mono text-[18px] font-bold leading-tight text-[#101828]">
            {selectedCaseId && previewPolicyVersionFor(selectedCaseId)}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h2 className="text-[14px] font-bold text-[#101828]">
              Shapley Value Attribution: φ (Loss Share) per Event
            </h2>
            <PreviewTag />
          </div>
          <p className="mb-3 max-w-[78ch] text-[11.5px] leading-snug text-[#5c6b7a]">
            φ is an event's fair share of the loss: its average contribution across every order the corrections could be applied in.
            The shares add up to the total loss.
          </p>
          <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-[#5c6b7a]">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: IN }} /> in the coalition</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: OUT }} /> excluded</span>
          </div>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={rows} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#eef1f4" />
                <XAxis dataKey="event" tickLine={false} axisLine={{ stroke: '#dfe4e9' }} tick={{ fontSize: 11, fontFamily: 'JetBrains Mono', fill: '#5c6b7a' }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fontFamily: 'JetBrains Mono', fill: '#5c6b7a' }} />
                <Tooltip content={<ShareTooltip />} cursor={{ fill: 'rgba(42, 157, 143, 0.07)' }} />
                <Bar dataKey="phi" radius={[6, 6, 0, 0]} maxBarSize={64} animationDuration={900} animationEasing="ease-out">
                  {rows.map((r, i) => (
                    <Cell key={i} fill={r.inCoalition ? IN : OUT} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="!p-0 overflow-hidden">
          <h2 className="border-b border-[#e2e6ea] px-5 py-4 text-[14px] font-bold text-[#101828]">
            Event Attribution Detail
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-[#e2e6ea] text-[11px] uppercase tracking-wide text-[#667585]">
                  <th className="px-5 py-3 font-semibold">Event</th>
                  <th className="px-5 py-3 font-semibold">φ (Share)</th>
                  <th className="px-5 py-3 font-semibold">Attributed Loss</th>
                  <th className="px-5 py-3 font-semibold">Coalition Status</th>
                </tr>
              </thead>
              <tbody className="rs-rows" key={selectedCaseId}>
                {rows.map((r) => (
                  <tr key={r.event} className="border-b border-[#eef1f4] last:border-0 hover:bg-[#edf1f5]">
                    <td className="px-5 py-3 font-semibold text-[#101828]">
                      {r.event} <span className="font-normal text-[#5c6b7a]">{r.activity}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-2.5">
                        <span className="w-9">{r.phi.toFixed(2)}</span>
                        <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-[#eef1f4] sm:block" aria-hidden="true">
                          <span className="rs-grow-x block h-full rounded-full" style={{ width: `${Math.max((r.phi / rows[0].phi) * 100, 4)}%`, background: r.inCoalition ? IN : OUT }} />
                        </span>
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3">{formatEur(r.loss)}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full py-1 pl-2 pr-2.5 text-[11px] font-bold ${
                          r.inCoalition
                            ? 'bg-status-passBg text-status-pass'
                            : 'bg-status-blockedBg text-status-blocked'
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${r.inCoalition ? 'bg-status-pass' : 'bg-status-blocked'}`} aria-hidden="true" />
                        {r.inCoalition ? 'In Coalition' : 'Excluded'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}
