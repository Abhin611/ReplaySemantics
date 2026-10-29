// Page heading under the top navigation: what this page is and what it is for.
export default function TopBar({ title, subtitle, compact = false }) {
  return (
    <div className={`flex flex-wrap items-baseline gap-x-4 gap-y-0.5 border-b border-[#e2e6ea] ${compact ? 'mb-2 pb-1.5' : 'mb-4 pb-3'}`}>
      <h1 className="text-[19px] font-bold leading-tight tracking-tight text-[#101828]">{title}</h1>
      {subtitle && <p className={`min-w-0 flex-1 text-[12px] leading-snug text-[#8a97a3] ${compact ? 'truncate' : ''}`}>{subtitle}</p>}
    </div>
  )
}
