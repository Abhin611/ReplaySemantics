const STYLES = {
  PASS: 'bg-status-passBg text-status-pass',
  'POLICY-ORDERED': 'bg-status-orderedBg text-status-ordered',
  BLOCKED: 'bg-status-blockedBg text-status-blocked',
  IDLE: 'bg-status-idleBg text-status-idle',
  CANDIDATE: 'bg-blue-50 text-blue-700',
  CONFLICT: 'bg-status-orderedBg text-status-ordered',
  RESOLVED: 'bg-status-passBg text-status-pass',
}

export default function StatusBadge({ status, className = '' }) {
  const key = (status || 'IDLE').toUpperCase()
  const style = STYLES[key] || STYLES.IDLE
  return (
    <span
      className={`inline-block rounded-md px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${style} ${className}`}
    >
      {key}
    </span>
  )
}
