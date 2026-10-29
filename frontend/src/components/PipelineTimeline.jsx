import { Check, Loader2, Minus } from 'lucide-react'
import StatusBadge from './StatusBadge'

// The six pipeline stages as a vertical timeline. While a replay is animating, `shown` is how many stages
// have landed: finished ones are filled in, the next one shimmers as "working", later ones are not drawn yet.
// When nothing is animating, pass shown = items.length and everything is simply there.
//   items: [{ key, label, body, warning, status: 'complete' | 'not_applicable' | ..., badge }]
export default function PipelineTimeline({ items, shown, animating }) {
  return (
    <ol className="relative flex flex-col">
      {items.map((it, i) => {
        const done = i < shown
        const active = animating && i === shown
        if (!done && !active) return null
        const na = it.status === 'not_applicable'
        const isLast = i === items.length - 1
        return (
          <li key={it.key} className={`relative flex gap-3 pb-4 ${isLast ? 'pb-0' : ''} ${animating ? 'rs-stage-in' : ''}`}>
            {/* rail */}
            {!isLast && (done || active) && (
              <span
                aria-hidden="true"
                className={`absolute left-[11px] top-6 w-0.5 rounded bg-gradient-to-b from-teal-400 to-teal-200 ${
                  done && animating ? 'rs-grow-y' : ''
                }`}
                style={{ bottom: 0, opacity: done ? 1 : 0.25 }}
              />
            )}
            <span
              className={`relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white ${
                active ? 'rs-ring bg-teal-500' : na ? 'bg-[#c2cad2]' : 'rs-pop bg-teal-500'
              }`}
            >
              {active ? <Loader2 size={13} className="animate-spin" /> : na ? <Minus size={13} /> : <Check size={13} strokeWidth={3} />}
            </span>
            <div className={`min-w-0 flex-1 rounded-lg px-1 ${active ? 'rs-shimmer' : ''}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-[13px] font-semibold ${done ? 'text-[#101828]' : 'text-[#5c6b7a]'}`}>{it.label}</span>
                {done && it.badge && <StatusBadge status={it.badge} className="rs-pop !px-2 !py-0.5 !text-[10.5px]" />}
              </div>
              <div className={`text-[12px] leading-relaxed ${done && !na ? 'text-[#5c6b7a]' : 'text-[#8a97a3]'}`}>
                {active ? 'Working…' : na ? 'Not applicable to real SAP data (no pricing fields to replay).' : it.body}
              </div>
              {done && it.warning && (
                <div className="mt-1 rounded-md bg-status-orderedBg px-2 py-1 text-[11.5px] text-status-ordered">{it.warning}</div>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
