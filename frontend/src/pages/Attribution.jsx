import { useCallback, useEffect, useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useApi } from '../lib/useApi'
import { getCases } from '../lib/api'
import { useSelectedCase } from '../lib/SelectedCaseContext'
import Card from '../components/Card'
import PreviewTag from '../components/PreviewTag'
import { LoadingState, ErrorState } from '../components/StatusStates'
import { formatEur } from '../lib/format'
import { mockAttributionFor, previewPolicyVersionFor } from '../data/mockData'

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
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
        <span className="text-[13px] text-amber-800">
          The Shapley attribution engine is Month 5 / Member 3 work and hasn't been built yet.
          Everything on this page is illustrative sample data, wired the way the real endpoint
          will need to shape its response.
        </span>
        <PreviewTag label="Full page preview" />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <div className="text-[12px] text-[#8a97a3]">Case</div>
          <select
            value={selectedCaseId || ''}
            onChange={(e) => setSelectedCaseId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[#e2e6ea] px-2 py-1.5 text-[14px] font-bold"
          >
            {cases.map((c) => (
              <option key={c.case_id} value={c.case_id}>
                {c.case_id}
              </option>
            ))}
          </select>
        </Card>
        <Card>
          <div className="text-[12px] text-[#8a97a3]">Total Attributed Loss</div>
          <div className="mt-1 text-[20px] font-bold text-[#101828]">{formatEur(totalLoss)}</div>
        </Card>
        <Card>
          <div className="text-[12px] text-[#8a97a3]">Policy</div>
          <div className="mt-1 text-[16px] font-bold text-[#101828]">
            {selectedCaseId && previewPolicyVersionFor(selectedCaseId)}
          </div>
        </Card>
      </div>

      <Card>
        <div className="mb-1 flex items-center gap-2">
          <div className="text-[14px] font-bold text-[#101828]">
            Shapley Value Attribution — φ (Loss Share) per Event
          </div>
          <PreviewTag />
        </div>
        <div style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={rows} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#eef1f4" />
              <XAxis dataKey="event" tick={{ fontSize: 11, fontFamily: 'JetBrains Mono' }} />
              <YAxis tick={{ fontSize: 11, fontFamily: 'JetBrains Mono' }} />
              <Tooltip
                formatter={(value, name) => (name === 'phi' ? value.toFixed(2) : formatEur(value))}
                contentStyle={{ fontSize: 12, fontFamily: 'JetBrains Mono' }}
              />
              <Bar dataKey="phi" radius={[4, 4, 0, 0]}>
                {rows.map((r, i) => (
                  <Cell key={i} fill={r.inCoalition ? '#c7d6e0' : '#f5b8b3'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="!p-0 overflow-hidden">
        <div className="border-b border-[#e2e6ea] px-5 py-4 text-[14px] font-bold text-[#101828]">
          Event Attribution Detail
        </div>
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-[#e2e6ea] text-[11px] uppercase tracking-wide text-[#8a97a3]">
              <th className="px-5 py-3 font-semibold">Event</th>
              <th className="px-5 py-3 font-semibold">φ (Share)</th>
              <th className="px-5 py-3 font-semibold">Attributed Loss</th>
              <th className="px-5 py-3 font-semibold">Coalition Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.event} className="border-b border-[#eef1f4] last:border-0">
                <td className="px-5 py-3 font-semibold text-[#101828]">
                  {r.event} <span className="text-[#8a97a3]">{r.activity}</span>
                </td>
                <td className="px-5 py-3">{r.phi.toFixed(2)}</td>
                <td className="px-5 py-3">{formatEur(r.loss)}</td>
                <td className="px-5 py-3">
                  <span
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                      r.inCoalition
                        ? 'bg-status-passBg text-status-pass'
                        : 'bg-status-blockedBg text-status-blocked'
                    }`}
                  >
                    {r.inCoalition ? 'In Coalition' : 'Excluded'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
