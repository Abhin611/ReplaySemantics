import { useState } from 'react'
import { Check, X } from 'lucide-react'
import Card from '../components/Card'
import PreviewTag from '../components/PreviewTag'
import { mockPermissions, mockUser } from '../data/mockData'

export default function Settings() {
  const [notifyOnBlocked, setNotifyOnBlocked] = useState(true)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
        <span className="text-[13px] text-amber-800">
          No auth/user-management backend exists yet. This screen is static sample data.
        </span>
        <PreviewTag label="Full page preview" />
      </div>

      <Card>
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-500 text-[14px] font-bold text-white">
            {mockUser.initials}
          </div>
          <div>
            <div className="text-[15px] font-bold text-[#101828]">{mockUser.name}</div>
            <div className="text-[13px] text-[#5c6b7a]">{mockUser.email}</div>
            <div className="text-[12px] text-[#8a97a3]">
              Role: {mockUser.role} · Last login: {mockUser.lastLogin}
            </div>
          </div>
        </div>
      </Card>

      <Card className="!p-0 overflow-hidden">
        <div className="border-b border-[#e2e6ea] px-5 py-4">
          <div className="text-[14px] font-bold text-[#101828]">Roles &amp; Permissions</div>
          <div className="text-[12.5px] text-[#8a97a3]">
            Read-only. Contact your administrator to modify role assignments.
          </div>
        </div>
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-[#e2e6ea] text-[11px] uppercase tracking-wide text-[#8a97a3]">
              <th className="px-5 py-3 font-semibold">Permission</th>
              <th className="px-5 py-3 font-semibold text-center">Analyst</th>
              <th className="px-5 py-3 font-semibold text-center">Auditor (you)</th>
              <th className="px-5 py-3 font-semibold text-center">Admin</th>
            </tr>
          </thead>
          <tbody>
            {mockPermissions.map((row) => (
              <tr key={row.permission} className="border-b border-[#eef1f4] last:border-0">
                <td className="px-5 py-3 text-[#101828]">{row.permission}</td>
                <PermCell allowed={row.analyst} />
                <PermCell allowed={row.auditor} highlight />
                <PermCell allowed={row.admin} />
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <div className="text-[14px] font-bold text-[#101828]">Notifications</div>
        <div className="mt-3 flex items-center justify-between">
          <div>
            <div className="text-[13px] font-semibold text-[#101828]">
              Notify me when a case is BLOCKED
            </div>
            <div className="text-[12.5px] text-[#8a97a3]">
              Receive an in-app alert when a replay verdict results in BLOCKED for any case you
              have access to.
            </div>
          </div>
          <button
            role="switch"
            aria-checked={notifyOnBlocked}
            onClick={() => setNotifyOnBlocked((v) => !v)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              notifyOnBlocked ? 'bg-teal-500' : 'bg-[#c2cad2]'
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                notifyOnBlocked ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </Card>
    </div>
  )
}

function PermCell({ allowed, highlight }) {
  return (
    <td className={`px-5 py-3 text-center ${highlight ? 'bg-[#f7f9fa]' : ''}`}>
      {allowed ? (
        <Check size={15} className="mx-auto text-status-pass" />
      ) : (
        <X size={15} className="mx-auto text-[#c2cad2]" />
      )}
    </td>
  )
}
