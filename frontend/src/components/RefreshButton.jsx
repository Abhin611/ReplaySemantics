import { RotateCw } from 'lucide-react'

// "Refresh" for a page: clears that page's remembered output so a new case can be run without the old
// one lingering. Pass `disabled` (with a `title` explaining why) to show it inactive.
export default function RefreshButton({ onClick, disabled = false, busy = false, title, className = '' }) {
  const inactive = disabled || busy
  return (
    <button
      type="button"
      onClick={inactive ? undefined : onClick}
      disabled={inactive}
      aria-label="Refresh page"
      title={title || (disabled ? 'Refresh is not available on this page yet' : 'Clear this page so a new case can be run')}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-[#e2e6ea] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[#101828] transition-colors hover:bg-[#f2f4f6] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white ${className}`}
    >
      <RotateCw size={13} className={busy ? 'animate-spin' : ''} />
      Refresh
    </button>
  )
}
