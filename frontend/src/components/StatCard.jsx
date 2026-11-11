// One figure about the active log. `icon` is optional; `value` may be text or an <AnimatedNumber />.
export default function StatCard({ label, value, sublabel, tone = 'default', icon: Icon }) {
  const toneClass =
    tone === 'danger'
      ? 'text-status-blocked'
      : tone === 'warn'
      ? 'text-status-ordered'
      : 'text-[#101828]'
  const iconTone = tone === 'danger' ? 'bg-status-blockedBg text-status-blocked' : tone === 'warn' ? 'bg-status-orderedBg text-status-ordered' : 'bg-teal-500/10 text-teal-500'

  return (
    <div className="rs-card rs-lift min-w-[190px] flex-1 rounded-2xl border border-[#e3e7ec] bg-white p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="text-[12.5px] font-medium text-[#5c6b7a]">{label}</div>
        {Icon && <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${iconTone}`}><Icon size={16} /></span>}
      </div>
      <div className={`mt-2 text-[32px] font-extrabold leading-none tracking-[-0.035em] ${toneClass}`}>{value}</div>
      {sublabel && <div className="mt-2 text-[12px] leading-snug text-[#667585]">{sublabel}</div>}
    </div>
  )
}
