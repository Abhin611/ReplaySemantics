import { useCallback, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CheckCircle2, Pencil, Plus } from 'lucide-react'
import Card from '../components/Card'
import { logSummary } from '../components/LoadLog'
import { ErrorState, LoadingState } from '../components/StatusStates'
import { useApi } from '../lib/useApi'
import { getHistory, getLogs, openLog, updateName } from '../lib/api'
import { useSession } from '../lib/session'
import { formatDateTime } from '../lib/format'

const PROVIDER = { 'google.com': 'Google', password: 'Email and password' }

export default function Profile() {
  const navigate = useNavigate()
  const { profile, activeLog, activateLog, setProfile } = useSession()
  const logsApi = useApi(useCallback(() => getLogs(), []))
  const historyApi = useApi(useCallback(() => getHistory(), []))
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(profile.name ?? '')
  const [error, setError] = useState(null)

  const saveName = async (e) => {
    e.preventDefault()
    try {
      setProfile((await updateName(name.trim())).user)
      setEditing(false)
    } catch (err) { setError(err.message) }
  }
  const open = async (id) => {
    setError(null)
    try {
      activateLog((await openLog(id)).log)
      navigate('/dashboard')
    } catch (err) { setError(err.message) }
  }

  if (logsApi.loading) return <LoadingState label="Loading your profile…" />
  if (logsApi.error) return <ErrorState error={logsApi.error} onRetry={logsApi.refetch} />
  const logs = logsApi.data.logs
  const initials = (profile.name || profile.email || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center gap-4">
          {profile.photo_url
            ? <img src={profile.photo_url} alt="" referrerPolicy="no-referrer" className="h-14 w-14 rounded-full" />
            : <div className="flex h-14 w-14 items-center justify-center rounded-full bg-teal-500 text-[17px] font-bold text-white">{initials}</div>}
          <div className="min-w-0 flex-1">
            {editing ? (
              <form onSubmit={saveName} className="flex flex-wrap items-center gap-2">
                <input autoFocus required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} aria-label="Your name" className="rounded-lg border border-[#d5dbe1] px-2.5 py-1.5 text-[14px]" />
                <button className="rounded-lg bg-navy-900 px-3 py-1.5 text-[12.5px] font-semibold text-white">Save</button>
                <button type="button" onClick={() => setEditing(false)} className="text-[12.5px] font-semibold text-[#5c6b7a]">Cancel</button>
              </form>
            ) : (
              <div className="flex items-center gap-2 text-[18px] font-bold text-[#101828]">
                {profile.name}
                <button onClick={() => setEditing(true)} aria-label="Change your name" className="rounded p-1 text-[#8a97a3] hover:bg-[#f2f4f6]"><Pencil size={13} /></button>
              </div>
            )}
            <div className="text-[13px] text-[#5c6b7a]">{profile.email}</div>
            <div className="mt-0.5 text-[11.5px] text-[#8a97a3]">
              Signs in with {PROVIDER[profile.provider] ?? profile.provider} · Member since {formatDateTime(profile.created_at)}
            </div>
          </div>
          <Link to="/history" className="rounded-xl border border-[#e2e6ea] px-4 py-2.5 text-center hover:bg-[#f7f9fa]">
            <div className="text-[20px] font-bold text-[#101828]">{historyApi.data?.actions.length ?? '—'}</div>
            <div className="text-[11px] text-[#8a97a3]">actions in history</div>
          </Link>
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[15px] font-bold text-[#101828]">Your event logs</div>
            <div className="text-[12px] text-[#8a97a3]">Click one to carry on working on it. You never need to enter it again.</div>
          </div>
          <Link to="/load-log" className="inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-navy-800"><Plus size={14} /> Load another log</Link>
        </div>
        {error && <p className="mb-2 rounded-lg bg-status-blockedBg px-3 py-2 text-[12.5px] text-status-blocked" role="alert">{error}</p>}
        {logs.length === 0 ? (
          <p className="text-[13px] text-[#5c6b7a]">You have not loaded a log yet.</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="profile-logs">
            {logs.map((l) => {
              const on = l.id === activeLog?.id
              return (
                <li key={l.id}>
                  <button onClick={() => open(l.id)} className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3 text-left transition-colors hover:border-teal-300 hover:bg-teal-50 ${on ? 'border-teal-400 bg-teal-50/60' : 'border-[#e2e6ea]'}`}>
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-semibold text-[#101828]">{l.label}</span>
                      <span className="block text-[11.5px] text-[#8a97a3]">{logSummary(l)} · first loaded {formatDateTime(l.created_at)} · last opened {formatDateTime(l.last_opened_at)}</span>
                    </span>
                    {on && <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-teal-700"><CheckCircle2 size={14} /> Working on this</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
