// Compact segmented tab bar. Used by the Replay Console to keep the right-hand panel to one screen
// instead of a long stack of cards.
export default function TabBar({ tabs, active, onChange }) {
  return (
    <div role="tablist" className="flex gap-1 rounded-xl border border-[#e2e6ea] bg-white p-1 shadow-card">
      {tabs.map((t) => {
        const on = t.key === active
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-semibold transition-colors ${
              on ? 'bg-navy-900 text-white' : 'text-[#5c6b7a] hover:bg-[#f2f4f6]'
            }`}
          >
            {t.label}
            {t.badge !== undefined && t.badge !== null && (
              <span
                className={`rounded-full px-1.5 text-[10px] font-bold ${
                  on ? 'bg-white/20 text-white' : 'bg-[#eef1f4] text-[#5c6b7a]'
                }`}
              >
                {t.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
