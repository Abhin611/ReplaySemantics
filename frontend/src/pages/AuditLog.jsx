import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import Card from '../components/Card'
import PreviewTag from '../components/PreviewTag'
import { mockAuditLog } from '../data/mockData'

const ACTION_TONE = {
  REPLAY_RUN: 'bg-teal-500/10 text-teal-700',
  CASE_OPEN: 'bg-[#eef1f4] text-[#5c6b7a]',
  POLICY_PUBLISH: 'bg-status-orderedBg text-status-ordered',
}

export default function AuditLog() {
  return (
    <div className="rs-stagger flex w-full max-w-5xl flex-col gap-4">
      <div className="rs-notice">
        <span>
          Sample rows only, showing the shape of an organisation-wide log. Your own actions are saved on the{' '}
          <Link to="/history" className="inline-flex items-center gap-1 font-bold underline decoration-amber-700/40 underline-offset-2 hover:decoration-amber-700">History page <ArrowRight size={12} /></Link>
        </span>
        <PreviewTag label="Full page preview" />
      </div>

      <Card className="!p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-[#e2e6ea] text-[11px] uppercase tracking-wide text-[#667585]">
                <th className="px-5 py-3 font-semibold">Timestamp</th>
                <th className="px-5 py-3 font-semibold">Actor</th>
                <th className="px-5 py-3 font-semibold">Role</th>
                <th className="px-5 py-3 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="rs-rows">
              {mockAuditLog.map((row, i) => (
                <tr key={i} className="border-b border-[#eef1f4] last:border-0 hover:bg-[#edf1f5]">
                  <td className="whitespace-nowrap px-5 py-3 text-[#5c6b7a]">{row.timestamp}</td>
                  <td className="px-5 py-3 font-semibold text-[#101828]">{row.actor}</td>
                  <td className="px-5 py-3 text-[#5c6b7a]">{row.role}</td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ${ACTION_TONE[row.action] ?? ACTION_TONE.CASE_OPEN}`}>
                      {row.action}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
