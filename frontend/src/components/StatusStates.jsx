import { AlertTriangle, Inbox } from 'lucide-react'

// Three events on a line, lit one after another: the app's own "working" mark.
export function Loader({ className = '' }) {
  return (
    <span className={`rs-loader inline-flex items-center gap-1 ${className}`} aria-hidden="true">
      <span className="h-2 w-2 rounded-full bg-[#cbd3da]" />
      <span className="h-px w-2.5 bg-[#cbd3da]" style={{ animation: 'none' }} />
      <span className="h-2 w-2 rounded-full bg-[#cbd3da]" />
      <span className="h-px w-2.5 bg-[#cbd3da]" style={{ animation: 'none' }} />
      <span className="h-2 w-2 rounded-full bg-[#cbd3da]" />
    </span>
  )
}

export function LoadingState({ label = 'Loading…' }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-[13px] text-[#5c6b7a]" role="status">
      <Loader />
      {label}
    </div>
  )
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-status-blockedBg text-status-blocked"><AlertTriangle size={20} /></span>
      <div className="text-sm font-bold text-[#101828]">Couldn't load this data</div>
      <div className="max-w-md text-[13px] leading-relaxed text-[#5c6b7a]">{error?.message || String(error)}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 rounded-xl bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white hover:bg-navy-800"
        >
          Retry
        </button>
      )}
    </div>
  )
}

export function EmptyState({ label = 'Nothing here yet.' }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center text-[#5c6b7a]">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#eef1f4] text-[#667585]"><Inbox size={20} /></span>
      <div className="text-[13px]">{label}</div>
    </div>
  )
}
