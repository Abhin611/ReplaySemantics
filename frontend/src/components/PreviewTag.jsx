import { FlaskConical } from 'lucide-react'

// Marks any UI driven by src/data/mockData.js rather than the real
// backend, so it's never mistaken for a live pipeline result.
export default function PreviewTag({ label = 'Preview data', className = '' }) {
  return (
    <span
      title="Not wired to the backend yet -- illustrative data only"
      className={`inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 ${className}`}
    >
      <FlaskConical size={11} strokeWidth={2.5} />
      {label}
    </span>
  )
}
