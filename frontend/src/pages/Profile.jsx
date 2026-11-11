import { useCallback, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Database, Pencil, Plus } from 'lucide-react'
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
    <div className="rs-stagger flex w-full max-w-5xl flex-col gap-4">
      <Card className="!p-6">
        <div className="flex flex-wrap items-center gap-5">
          {profile.photo_url
            ? <img src={profile.photo_url} alt="" referrerPolicy="no-referrer" className="h-16 w-16 rounded-full ring-4 ring-teal-500/15" />
            : <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 to-teal-500 text-[19px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] ring-4 ring-teal-500/15">{initials}</div>}
          <div className="min-w-[min(100%,220px)] flex-1">
            {editing ? (
              <form onSubmit={saveName} className="rs-fade flex flex-wrap items-center gap-2">
                <input autoFocus required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} aria-label="Your name" className="rs-input !text-[14px]" />
                <button className="rs-btn rs-btn-sm rs-btn-primary">Save</button>
                <button type="button" onClick={() => { setEditing(false); setName(profile.name ?? '') }} className="rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-[#5c6b7a] hover:bg-[#eef1f4]">Cancel</button>
              </form>
            ) : (
              <div className="flex items-center gap-1.5 text-[21px] font-extrabold tracking-[-0.02em] text-[#101828]">
                <span className="truncate">{profile.name}</span>
                <button onClick={() => setEditing(true)} aria-label="Change your name" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#667585] hover:bg-[#eef1f4] hover:text-[#101828]"><Pencil size={13} /></button>
              </div>
            )}
            <div className="truncate text-[13px] text-[#5c6b7a]">{profile.email}</div>
            <div className="mt-1 text-[11.5px] text-[#667585]">
              Signs in with {PROVIDER[profile.provider] ?? profile.provider} · Member since {formatDateTime(profile.created_at)}
            </div>
          </div>
          <Link to="/history" className="rs-lift group flex w-full items-center justify-between gap-4 rounded-2xl border border-[#e3e7ec] bg-[#eef2f5] px-5 py-3.5 sm:w-auto">
            <div>
              <div className="text-[26px] font-extrabold leading-none tracking-[-0.03em] text-[#101828]">{historyApi.data?.actions.length ?? '—'}</div>
              <div className="mt-1.5 text-[11.5px] text-[#667585]">actions in history</div>
            </div>
            <ArrowRight size={16} className="text-teal-600 transition-transform duration-300 ease-out group-hover:translate-x-1" />
          </Link>
        </div>
      </Card>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-bold text-[#101828]">Your event logs</h2>
            <div className="mt-0.5 text-[12px] text-[#5c6b7a]">Click one to carry on working on it. You never need to enter it again.</div>
          </div>
          <Link to="/load-log" className="rs-btn rs-btn-primary rs-press"><Plus size={14} /> Load another log</Link>
        </div>
        {error && <p className="rs-fade mb-3 rounded-xl bg-status-blockedBg px-3.5 py-2.5 text-[12.5px] text-status-blocked" role="alert">{error}</p>}
        {logs.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[#d5dbe1] px-4 py-8 text-center text-[13px] text-[#5c6b7a]">You have not loaded a log yet.</p>
        ) : (
          <ul className="rs-cascade flex flex-col gap-2.5" data-testid="profile-logs">
            {logs.map((l) => {
              const on = l.id === activeLog?.id
              return (
                <li key={l.id}>
                  <button onClick={() => open(l.id)} className={`rs-lift group flex w-full flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3.5 text-left ${
                    on ? 'border-teal-500/70 bg-teal-50/50' : 'border-[#e3e7ec] bg-white hover:border-teal-400'}`}>
                    <span className="flex min-w-0 items-center gap-3.5">
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-transform duration-500 ease-spring group-hover:scale-110 ${on ? 'bg-teal-500 text-white' : 'bg-teal-500/10 text-teal-600'}`}><Database size={17} /></span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] font-bold text-[#101828]">{l.label}</span>
                        <span className="mt-0.5 block text-[11.5px] text-[#667585]">{logSummary(l)} · first loaded {formatDateTime(l.created_at)} · last opened {formatDateTime(l.last_opened_at)}</span>
                      </span>
                    </span>
                    {on
                      ? <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-500/10 px-2.5 py-1 text-[12px] font-bold text-teal-700"><CheckCircle2 size={14} /> Working on this</span>
                      : <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-teal-600 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">Open <ArrowRight size={13} /></span>}
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
