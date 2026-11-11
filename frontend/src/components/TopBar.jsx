// Page heading under the navigation: what this page is and what it is for. On a narrow screen the description drops
// under the title instead of being squeezed beside it.
export default function TopBar({ title, subtitle, compact = false }) {
  return (
    <div className={`flex flex-wrap items-baseline gap-x-4 gap-y-1 ${compact ? 'mb-2 pb-1' : 'mb-5 pb-1'}`}>
      <h1 className="rs-title text-[23px] font-extrabold leading-tight tracking-[-0.03em] text-[#101828]">{title}</h1>
      {subtitle && <p className={`min-w-[min(100%,300px)] flex-1 text-[12.5px] leading-snug text-[#5c6b7a] ${compact ? 'truncate' : ''}`}>{subtitle}</p>}
    </div>
  )
}
