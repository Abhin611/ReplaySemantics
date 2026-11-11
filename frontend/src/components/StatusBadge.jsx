const STYLES = {
  PASS: ['bg-status-passBg text-status-pass', 'bg-status-pass'],
  'POLICY-ORDERED': ['bg-status-orderedBg text-status-ordered', 'bg-status-ordered'],
  BLOCKED: ['bg-status-blockedBg text-status-blocked', 'bg-status-blocked'],
  IDLE: ['bg-status-idleBg text-status-idle', 'bg-status-idle'],
  CANDIDATE: ['bg-blue-50 text-blue-700', 'bg-blue-600'],
  CONFLICT: ['bg-status-orderedBg text-status-ordered', 'bg-status-ordered'],
  RESOLVED: ['bg-status-passBg text-status-pass', 'bg-status-pass'],
}

export default function StatusBadge({ status, className = '' }) {
  const key = (status || 'IDLE').toUpperCase()
  const [style, dot] = STYLES[key] || STYLES.IDLE
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full py-1 pl-2 pr-2.5 text-[11px] font-bold tracking-wide ${style} ${className}`}
    >
      <span className={`rs-badge-dot h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
      {key}
    </span>
  )
}
