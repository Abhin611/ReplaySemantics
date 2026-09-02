export default function StatCard({ label, value, sublabel, preview = false, tone = 'default' }) {
  const toneClass =
    tone === 'danger'
      ? 'text-status-blocked'
      : tone === 'warn'
      ? 'text-status-ordered'
      : 'text-[#101828]'

  return (
    <div className="flex-1 min-w-[180px] rounded-xl border border-[#e2e6ea] bg-white p-5 shadow-card">
      <div className="text-[13px] text-[#5c6b7a]">{label}</div>
      <div className={`mt-2 text-3xl font-bold tracking-tight ${toneClass}`}>{value}</div>
      {sublabel && <div className="mt-1 text-[12px] text-[#8a97a3]">{sublabel}</div>}
    </div>
  )
}
