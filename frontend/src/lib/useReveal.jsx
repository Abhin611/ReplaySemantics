import { useEffect, useRef, useState } from 'react'

// True once the element has scrolled into view (and it stays true). Without IntersectionObserver it is true at once.
export function useReveal({ threshold = 0.2 } = {}) {
  const ref = useRef(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    if (!('IntersectionObserver' in window)) { setShown(true); return undefined }
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setShown(true); io.disconnect() }
    }, { threshold, rootMargin: '0px 0px -6% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [threshold])
  return [ref, shown]
}

// A block that rises into place the first time it is scrolled to. `delay` (ms) staggers neighbours.
export function Reveal({ as: Tag = 'div', delay = 0, className = '', children, ...rest }) {
  const [ref, shown] = useReveal()
  return (
    <Tag ref={ref} className={`rs-reveal ${shown ? 'is-in' : ''} ${className}`} style={delay ? { transitionDelay: `${delay}ms` } : undefined} {...rest}>
      {children}
    </Tag>
  )
}
