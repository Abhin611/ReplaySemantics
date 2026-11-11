import { useLayoutEffect, useRef, useState } from 'react'

// Compact segmented tab bar. One dark pill slides to the tab that is open. Used by the Replay Console to keep the
// right-hand panel to one screen instead of a long stack of cards.
export default function TabBar({ tabs, active, onChange }) {
  const refs = useRef({})
  const [pill, setPill] = useState(null)
  const signature = tabs.map((t) => `${t.key}:${t.badge ?? ''}`).join('|')

  useLayoutEffect(() => {
    const measure = () => {
      const el = refs.current[active]
      if (!el) return setPill(null)
      setPill((p) => (p && p.left === el.offsetLeft && p.width === el.offsetWidth ? p : { left: el.offsetLeft, width: el.offsetWidth }))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [active, signature])

  return (
    <div role="tablist" className="relative flex gap-1 overflow-x-auto rounded-2xl border border-[#e3e7ec] bg-white p-1 shadow-card">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-1 top-1 overflow-hidden rounded-xl bg-navy-900 shadow-[0_6px_14px_-6px_rgba(13,27,41,0.6),0_0_0_1px_rgba(45,212,191,0.22)] transition-[left,width,opacity] duration-500 ease-spring after:absolute after:inset-x-4 after:bottom-[3px] after:h-[2px] after:rounded-full after:bg-teal-400 after:shadow-[0_0_8px_rgba(45,212,191,0.9)] after:content-['']"
        style={pill ? { left: pill.left, width: pill.width, opacity: 1 } : { left: 0, width: 0, opacity: 0 }}
      />
      {tabs.map((t) => {
        const on = t.key === active
        return (
          <button
            key={t.key}
            ref={(el) => { refs.current[t.key] = el }}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className={`relative z-10 flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-xl px-1 py-1.5 text-[11.5px] font-semibold transition-colors duration-200 ${
              on ? 'text-white' : 'text-[#5c6b7a] hover:text-[#101828]'
            }`}
          >
            {t.label}
            {t.badge !== undefined && t.badge !== null && (
              <span
                className={`rounded-full px-1.5 text-[10px] font-bold transition-colors duration-200 ${
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
