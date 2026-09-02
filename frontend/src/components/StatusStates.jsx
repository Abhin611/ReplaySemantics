import { AlertTriangle, Loader2, Inbox } from 'lucide-react'

export function LoadingState({ label = 'Loading…' }) {
  return (
    <div className="flex items-center gap-2 py-16 justify-center text-[#5c6b7a] text-sm">
      <Loader2 size={16} className="animate-spin" />
      {label}
    </div>
  )
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center px-6">
      <AlertTriangle size={22} className="text-status-blocked" />
      <div className="text-sm font-semibold text-[#101828]">Couldn't load this data</div>
      <div className="text-[13px] text-[#5c6b7a] max-w-md">{error?.message || String(error)}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white hover:bg-navy-800"
        >
          Retry
        </button>
      )}
    </div>
  )
}

export function EmptyState({ label = 'Nothing here yet.' }) {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center text-[#8a97a3]">
      <Inbox size={20} />
      <div className="text-sm">{label}</div>
    </div>
  )
}
