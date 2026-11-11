import { useState } from 'react'
import { Check, Minus } from 'lucide-react'
import Card from '../components/Card'
import PreviewTag from '../components/PreviewTag'
import { mockPermissions } from '../data/mockData'
import { useSession } from '../lib/session'
import { formatDateTime } from '../lib/format'

export default function Settings() {
  const { profile } = useSession()
  const [notifyOnBlocked, setNotifyOnBlocked] = useState(true)
  const initials = (profile.name || profile.email || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()

  return (
    <div className="rs-stagger flex w-full max-w-5xl flex-col gap-4">
      <div className="rs-notice">
        <span>No auth/user-management backend exists yet. This screen is static sample data.</span>
        <PreviewTag label="Full page preview" />
      </div>

      <Card>
        <div className="flex items-center gap-4">
          {profile.photo_url
            ? <img src={profile.photo_url} alt="" referrerPolicy="no-referrer" className="h-12 w-12 rounded-full ring-4 ring-teal-500/15" />
            : <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 to-teal-500 text-[14px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] ring-4 ring-teal-500/15">{initials}</div>}
          <div className="min-w-0">
            <div className="truncate text-[15px] font-bold text-[#101828]">{profile.name}</div>
            <div className="truncate text-[13px] text-[#5c6b7a]">{profile.email}</div>
            <div className="mt-0.5 text-[12px] text-[#667585]">
              Last login: {formatDateTime(profile.last_login_at)}
            </div>
          </div>
        </div>
      </Card>

      <Card className="!p-0 overflow-hidden">
        <div className="border-b border-[#e2e6ea] px-5 py-4">
          <h2 className="text-[14px] font-bold text-[#101828]">Roles &amp; Permissions</h2>
          <div className="mt-0.5 text-[12.5px] text-[#5c6b7a]">
            Read-only. Contact your administrator to modify role assignments.
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-[#e2e6ea] text-[11px] uppercase tracking-wide text-[#667585]">
                <th className="px-5 py-3 font-semibold">Permission</th>
                <th className="px-5 py-3 text-center font-semibold">Analyst</th>
                <th className="bg-teal-500/[0.07] px-5 py-3 text-center font-bold text-teal-700">Auditor (you)</th>
                <th className="px-5 py-3 text-center font-semibold">Admin</th>
              </tr>
            </thead>
            <tbody className="rs-rows">
              {mockPermissions.map((row) => (
                <tr key={row.permission} className="border-b border-[#eef1f4] last:border-0 hover:bg-[#edf1f5]">
                  <td className="px-5 py-3 text-[#101828]">{row.permission}</td>
                  <PermCell allowed={row.analyst} />
                  <PermCell allowed={row.auditor} highlight />
                  <PermCell allowed={row.admin} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h2 className="text-[14px] font-bold text-[#101828]">Notifications</h2>
        <div className="mt-3 flex items-center justify-between gap-6">
          <div>
            <div id="notify-blocked" className="text-[13px] font-semibold text-[#101828]">
              Notify me when a case is BLOCKED
            </div>
            <div className="mt-0.5 max-w-[68ch] text-[12.5px] leading-relaxed text-[#5c6b7a]">
              Receive an in-app alert when a replay verdict results in BLOCKED for any case you
              have access to.
            </div>
          </div>
          <button
            role="switch"
            aria-checked={notifyOnBlocked}
            aria-labelledby="notify-blocked"
            onClick={() => setNotifyOnBlocked((v) => !v)}
            className={`relative h-7 w-12 shrink-0 rounded-full shadow-[inset_0_1px_2px_rgba(16,24,40,0.18)] transition-colors duration-300 active:!scale-100 ${
              notifyOnBlocked ? 'bg-teal-500' : 'bg-[#c2cad2]'
            }`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow-[0_2px_5px_rgba(16,24,40,0.3)] transition-transform duration-500 ease-spring ${
                notifyOnBlocked ? 'translate-x-5' : 'translate-x-0'
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
    <td className={`px-5 py-3 text-center ${highlight ? 'bg-teal-500/[0.07]' : ''}`}>
      {allowed ? (
        <span className="mx-auto flex h-5 w-5 items-center justify-center rounded-full bg-status-passBg text-status-pass" title="Allowed"><Check size={13} strokeWidth={3} /><span className="sr-only">Allowed</span></span>
      ) : (
        <span className="mx-auto flex h-5 w-5 items-center justify-center text-[#b9c2cb]" title="Not allowed"><Minus size={14} /><span className="sr-only">Not allowed</span></span>
      )}
    </td>
  )
}
