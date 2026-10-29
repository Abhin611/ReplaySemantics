import { Gauge } from 'lucide-react'
import { SPEEDS } from '../lib/useReplaySpeed'

// Segmented speed picker shared by every animated replay. `dark` is for use on the navy bars.
export default function SpeedControl({ value, onChange, className = '' }) {
  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`} role="radiogroup" aria-label="Replay speed">
      <Gauge size={13} className="text-[#8a97a3]" aria-hidden="true" />
      <div className="inline-flex rounded-lg border border-[#e2e6ea] bg-[#f7f8fa] p-0.5">
        {SPEEDS.map((s) => {
          const on = s.key === value
          return (
            <button
              key={s.key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(s.key)}
              title={s.ms ? `${s.ms / 1000}s between stages` : 'Show every stage at once'}
              className={`rounded-md px-2 py-0.5 text-[11px] font-semibold transition-all duration-200 ${
                on ? 'bg-navy-900 text-white shadow-sm' : 'text-[#5c6b7a] hover:bg-white hover:text-[#101828]'
              }`}
            >
              {s.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
