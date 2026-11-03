import { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Database, FileUp, Link2, Loader2 } from 'lucide-react'
import Card from './Card'
import { ErrorState, LoadingState } from './StatusStates'
import { useApi } from '../lib/useApi'
import { getLogs, loadLogFromUrl, loadSampleLog, openLog, uploadLog } from '../lib/api'
import { useSession } from '../lib/session'

export const logSummary = (log) => [
  log.source === 'url' ? 'from a link' : log.source === 'upload' ? 'uploaded file' : 'sample',
  log.events != null ? `${log.events.toLocaleString('en-US')} events` : null,
].filter(Boolean).join(' · ')

// Choose the platform, give the link (or a file), press Enter. Anything already loaded is one click away.
export default function LoadLog() {
  const navigate = useNavigate()
  const { profile, activateLog } = useSession()
  const logsApi = useApi(useCallback(() => getLogs(), []))
  const [platform, setPlatform] = useState('ocel2')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(null) // what is loading right now
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  const run = async (label, fn) => {
    setBusy(label)
    setError(null)
    try {
      const { log } = await fn()
      activateLog(log)
      navigate('/dashboard')
    } catch (err) { setError(err.message) } finally { setBusy(null) }
  }
  if (logsApi.loading) return <LoadingState label="Loading…" />
  if (logsApi.error) return <ErrorState error={logsApi.error} onRetry={logsApi.refetch} />
  const { platforms, samples, logs } = logsApi.data
  const formats = platforms.find((p) => p.id === platform)?.formats ?? []
  const benchmark = samples.find((s) => s.id === 'benchmark')
  const otherSamples = samples.filter((s) => s.id !== 'benchmark')

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4" data-testid="load-log">
      <div>
        <h2 className="text-[22px] font-bold tracking-tight text-[#101828]">Welcome{profile?.name ? `, ${profile.name}` : ''}. Which event log do you want to load?</h2>
        <p className="mt-1 text-[13px] text-[#5c6b7a]">Everything in the app works on the log you load here. It stays in your profile, so you only enter it once.</p>
      </div>

      <Card>
        <form onSubmit={(e) => { e.preventDefault(); run('url', () => loadLogFromUrl(url, platform)) }} className="flex flex-col gap-4">
          <label className="text-[12px] font-semibold text-[#344054]">Platform
            <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="mt-1 w-full rounded-lg border border-[#d5dbe1] bg-white px-3 py-2.5 text-[13.5px] text-[#101828]">
              {platforms.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              <option disabled>Other platforms (coming later)</option>
            </select>
          </label>
          <label className="text-[12px] font-semibold text-[#344054]">Link to the event log
            <div className="relative mt-1">
              <Link2 size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8a97a3]" />
              <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/orders.jsonocel" data-testid="log-url"
                className="w-full rounded-lg border border-[#d5dbe1] bg-white py-2.5 pl-9 pr-3 text-[13.5px] text-[#101828] outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20" />
            </div>
            <span className="mt-1 block font-normal text-[#8a97a3]">A direct link to the file, not to a web page. Only this log's cases will be shown. Accepted: {formats.join(', ')}</span>
          </label>
          {error && <p className="rounded-lg bg-status-blockedBg px-3 py-2 text-[12.5px] text-status-blocked" role="alert">{error}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={!url.trim() || !!busy} className="inline-flex items-center gap-2 rounded-lg bg-navy-900 px-5 py-2.5 text-[13px] font-semibold text-white hover:bg-navy-800 disabled:opacity-50">
              {busy === 'url' ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />} {busy === 'url' ? 'Reading the log…' : 'Enter'}
            </button>
            <span className="text-[12px] text-[#8a97a3]">or</span>
            <button type="button" disabled={!!busy} onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-2 rounded-lg border border-[#d5dbe1] bg-white px-4 py-2.5 text-[13px] font-semibold text-[#101828] hover:bg-[#f2f4f6] disabled:opacity-50">
              {busy === 'file' ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />} {busy === 'file' ? 'Reading the file…' : 'Upload a file'}
            </button>
            <input ref={fileRef} type="file" accept={formats.join(',')} className="hidden" data-testid="log-file" onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) run('file', () => uploadLog(f, platform))
            }} />
          </div>
        </form>
      </Card>

      {benchmark && (
        <button disabled={!!busy} onClick={() => run(benchmark.id, () => loadSampleLog(benchmark.id))} data-testid="sample-benchmark"
          className="flex items-center gap-3.5 rounded-xl border-2 border-teal-500/40 bg-white p-4 text-left shadow-card transition-colors hover:border-teal-500 hover:bg-teal-50 disabled:opacity-50">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
            {busy === benchmark.id ? <Loader2 size={18} className="animate-spin" /> : <Database size={18} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-bold text-[#101828]">Or use the {benchmark.cases} benchmark cases</span>
            <span className="mt-0.5 block text-[12px] leading-snug text-[#5c6b7a]">{benchmark.description}</span>
          </span>
          <ArrowRight size={17} className="shrink-0 text-teal-600" />
        </button>
      )}

      {logs.length > 0 && (
        <Card>
          <div className="mb-2 text-[13px] font-bold text-[#101828]">Your event logs</div>
          <ul className="flex flex-col divide-y divide-[#eef1f4]">
            {logs.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold text-[#101828]">{l.label}</div>
                  <div className="text-[11.5px] text-[#8a97a3]">{logSummary(l)}</div>
                </div>
                <button disabled={!!busy} onClick={() => run(`log-${l.id}`, () => openLog(l.id))} className="rounded-lg border border-[#d5dbe1] px-3 py-1.5 text-[12px] font-semibold hover:bg-[#f2f4f6] disabled:opacity-50">Open</button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <div className="mb-3 text-[13px] font-bold text-[#101828]">Also available</div>
        <div className="grid gap-3 sm:grid-cols-2">
          {otherSamples.map((s) => (
            <button key={s.id} disabled={!!busy} onClick={() => run(s.id, () => loadSampleLog(s.id))} data-testid={`sample-${s.id}`}
              className="rounded-xl border border-[#e2e6ea] p-3.5 text-left transition-colors hover:border-teal-300 hover:bg-teal-50 disabled:opacity-50">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-[#101828]">
                {busy === s.id ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} className="text-teal-600" />} {s.label}
              </div>
              <p className="mt-1.5 text-[12px] leading-snug text-[#5c6b7a]">{s.description}</p>
            </button>
          ))}
        </div>
      </Card>
    </div>
  )
}
