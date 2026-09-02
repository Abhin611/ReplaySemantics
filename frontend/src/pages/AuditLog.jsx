import Card from '../components/Card'
import PreviewTag from '../components/PreviewTag'
import { mockAuditLog } from '../data/mockData'

export default function AuditLog() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
        <span className="text-[13px] text-amber-800">
          There's no authentication or event-sourcing layer yet, so nothing is really being
          logged. Sample rows shown to lock in the screen's shape.
        </span>
        <PreviewTag label="Full page preview" />
      </div>

      <Card className="!p-0 overflow-hidden">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-[#e2e6ea] text-[11px] uppercase tracking-wide text-[#8a97a3]">
              <th className="px-5 py-3 font-semibold">Timestamp</th>
              <th className="px-5 py-3 font-semibold">Actor</th>
              <th className="px-5 py-3 font-semibold">Role</th>
              <th className="px-5 py-3 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {mockAuditLog.map((row, i) => (
              <tr key={i} className="border-b border-[#eef1f4] last:border-0">
                <td className="px-5 py-3 text-[#5c6b7a]">{row.timestamp}</td>
                <td className="px-5 py-3 font-semibold text-[#101828] underline decoration-dotted">
                  {row.actor}
                </td>
                <td className="px-5 py-3 text-[#5c6b7a]">{row.role}</td>
                <td className="px-5 py-3">
                  <span className="rounded-md bg-[#eef1f4] px-2 py-1 text-[11px] font-semibold text-[#5c6b7a]">
                    {row.action}
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
