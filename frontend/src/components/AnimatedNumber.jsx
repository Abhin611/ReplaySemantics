import { useEffect, useRef, useState } from 'react'

// Counts from the previous value to `value` over `ms`, then settles on the exact formatted text.
// `format` turns a number into the string shown (the app's formatAmount). With ms = 0 it just shows the value.
export default function AnimatedNumber({ value, format, ms = 900, from = null, className = '' }) {
  const target = Number(value)
  const [shown, setShown] = useState(from != null ? Number(from) : target)
  const raf = useRef(0)

  useEffect(() => {
    if (!ms || Number.isNaN(target)) {
      setShown(target)
      return undefined
    }
    const start = from != null ? Number(from) : shown
    const t0 = performance.now()
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / ms)
      const eased = 1 - Math.pow(1 - p, 3)
      setShown(start + (target - start) * eased)
      if (p < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [target, ms]) // eslint-disable-line react-hooks/exhaustive-deps

  const done = Math.abs(shown - target) < 1e-9
  return <span className={className}>{format(done ? value : shown)}</span>
}
