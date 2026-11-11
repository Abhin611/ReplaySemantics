import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

const FIT = { padding: 0.25 }
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Builds a React Flow graph in front of the viewer, the way the Replay Console does: nodes are born one at a time,
// sweeping left to right (column by column, which is hop by hop), each edge draws itself in once both of its ends
// exist, and the finished graph is fitted into the box.
//
// `runKey` starts a build whenever it changes (a new case, a new order). Changing anything else (a highlight, a step
// of the trace) re-colours the graph without building it again.
//
// Never animate `transform` on the React Flow node wrapper: React Flow positions nodes with it. The node classes used
// here (rs-node-wait, rs-node-enter, index.css) animate the wrapper's child instead.
export function useGraphBuild({ nodes, edges, runKey, stepMs = 300 }) {
  const order = useMemo(
    () => [...nodes].sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y).map((n) => n.id),
    [nodes]
  )
  const rank = useMemo(() => Object.fromEntries(order.map((id, i) => [id, i])), [order])
  const [shown, setShown] = useState(Infinity)
  const [building, setBuilding] = useState(false)
  const wrapRef = useRef(null)
  const rf = useRef(null)
  const drawn = useRef(new Set())
  const fit = (duration = 0) => rf.current?.fitView({ ...FIT, duration })

  // a layout effect, so the hidden state is in place before the first paint: the finished graph never flashes up first
  useLayoutEffect(() => {
    if (!runKey || !order.length) return undefined
    if (reducedMotion()) { setShown(Infinity); setBuilding(false); return undefined }
    drawn.current = new Set()
    setShown(0); setBuilding(true)
    const timers = []
    const start = 350
    order.forEach((_, i) => timers.push(setTimeout(() => setShown(i + 1), start + i * stepMs)))
    const end = start + order.length * stepMs + 700
    timers.push(setTimeout(() => { setBuilding(false); setShown(Infinity); fit(600) }, end))
    return () => timers.forEach(clearTimeout)
  }, [runKey, order.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const isShown = (id) => (rank[id] ?? 0) < shown

  // edges draw in from script, on the live path, at their real length (a CSS keyframe would restart whenever React
  // Flow re-mounts an edge, and never finish)
  useEffect(() => {
    if (!building) return undefined
    const fresh = edges.filter((e) => isShown(e.source) && isShown(e.target) && !drawn.current.has(e.id))
    if (!fresh.length) return undefined
    fresh.forEach((e) => drawn.current.add(e.id))
    const raf = requestAnimationFrame(() => {
      fresh.forEach((e) => {
        const p = wrapRef.current?.querySelector(`.react-flow__edge[data-testid="rf__edge-${CSS.escape(e.id)}"] path.react-flow__edge-path`)
        if (!p) return
        if (e.style?.strokeDasharray) { p.animate([{ opacity: 0 }, { opacity: e.style?.opacity ?? 1 }], { duration: 600, easing: 'ease-out' }); return }
        const len = Math.ceil(p.getTotalLength())
        p.animate([
          { strokeDasharray: `${len} ${len}`, strokeDashoffset: `${len}` },
          { strokeDasharray: `${len} ${len}`, strokeDashoffset: '0' },
        ], { duration: 700, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' })
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [shown, building, edges]) // eslint-disable-line react-hooks/exhaustive-deps

  const outNodes = building
    ? nodes.map((n) => {
        const on = isShown(n.id)
        return { ...n, className: [n.className, on ? 'rs-node-enter' : 'rs-node-wait'].filter(Boolean).join(' '), style: { ...n.style, pointerEvents: on ? 'auto' : 'none' } }
      })
    : nodes
  const outEdges = building
    ? edges.map((e) => {
        const on = isShown(e.source) && isShown(e.target)
        return { ...e, animated: false, className: [e.className, on ? 'rs-edge-live' : null].filter(Boolean).join(' ') || undefined, style: { ...e.style, opacity: on ? (e.style?.opacity ?? 1) : 0 } }
      })
    : edges

  return {
    nodes: outNodes,
    edges: outEdges,
    building,
    progress: building ? Math.min(shown, order.length) / order.length : 1,
    wrapRef,
    onInit: (inst) => { rf.current = inst; inst.fitView(FIT) },
    fitViewOptions: FIT,
  }
}
