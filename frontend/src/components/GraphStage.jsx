import { useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, { Background, Controls } from 'reactflow'
import 'reactflow/dist/style.css'
import { Check, Pencil } from 'lucide-react'
import EventNode from './graph/EventNode'
import NodePopover from './NodePopover'
import { layoutGraph } from '../lib/graphLayout'
import { buildNodeStatus, NODE_KIND_STYLE } from '../lib/verdict'
import { attrText, briefFor, ocelRows } from '../lib/flow'
import { formatDateTime } from '../lib/format'

const NODE_TYPES = { event: EventNode }
const LEGEND = ['independent', 'ordered', 'blocked', 'exempt', 'context'].map((k) => ({ label: NODE_KIND_STYLE[k].label, color: NODE_KIND_STYLE[k].border }))
const FIT = { padding: 0.2 }
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// The graph. When `building` is true the case first sits as an OCEL 2.0 log in a panel beside the graph (one row per
// event). The rows are read one at a time: a scan line lights the row, a packet carrying its id flies from the row to
// the node's place in the graph, and the node is born there; an edge draws in once both of its ends exist. Then the log
// panel folds away and the finished graph glides to fill the box.
//
// Never animate `transform` on a React Flow node wrapper: React Flow positions nodes with that same property, so an
// animation on it stacks every node in the top-left corner. Node motion goes on the wrapper's child instead.
export default function GraphStage({ result, highlight, building, delay, skipKey, onBuilt, onEdit, title, hopRange, height = 'clamp(460px, calc(100vh - 250px), 780px)' }) {
  const rows = useMemo(() => ocelRows(result), [result])
  const order = useMemo(() => rows.map((r) => r.id), [rows])
  const [shown, setShown] = useState(building ? 0 : rows.length) // nodes born so far
  const [reading, setReading] = useState(-1) // the row being read now
  const [panelOpen, setPanelOpen] = useState(!!building)
  const [sel, setSel] = useState(null)
  const box = useRef(null)
  const flowWrap = useRef(null)
  const packets = useRef(null)
  const rowRefs = useRef([])
  const rf = useRef(null)
  const builtRef = useRef(onBuilt)
  builtRef.current = onBuilt

  const fit = (duration = 0) => rf.current?.fitView({ ...FIT, duration })

  // A glowing packet with the event id flies from its log row to where its node is about to appear.
  const launch = (i, ms) => {
    const layer = packets.current
    const rowEl = rowRefs.current[i]
    const id = order[i]
    const nodeEl = flowWrap.current?.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`)
    if (!layer || !rowEl || !nodeEl || reducedMotion()) return
    const b = layer.getBoundingClientRect()
    const r = rowEl.getBoundingClientRect()
    const n = nodeEl.getBoundingClientRect()
    const x0 = r.left - b.left + 14
    const y0 = r.top - b.top + r.height / 2 - 13
    // the circle sits at the top centre of the node box (its labels hang below it)
    const zoom = n.width / 130
    const x1 = n.left - b.left + n.width / 2 - 22
    const y1 = n.top - b.top + 28 * zoom - 13
    const mx = (x0 + x1) / 2
    const my = Math.min(y0, y1) - 46
    const el = document.createElement('div')
    el.className = 'rs-packet'
    el.textContent = id
    layer.appendChild(el)
    const anim = el.animate([
      { transform: `translate(${x0}px, ${y0}px) scale(0.8)`, opacity: 0 },
      { transform: `translate(${x0 + 8}px, ${y0}px) scale(1)`, opacity: 1, offset: 0.12 },
      { transform: `translate(${mx}px, ${my}px) scale(1.12)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${x1}px, ${y1}px) scale(0.55)`, opacity: 0.2 },
    ], { duration: ms, easing: 'cubic-bezier(0.55, 0, 0.25, 1)' })
    anim.onfinish = () => el.remove()
    anim.oncancel = () => el.remove()
  }

  // ---- the build animation ----
  useEffect(() => {
    if (!building) { setShown(rows.length); setReading(-1); setPanelOpen(false); return undefined }
    setShown(0); setReading(-1); setPanelOpen(true)
    const step = Math.max(420, Math.round((delay || 2000) / 3.6)) // 1×: about half a second per event
    const fly = Math.round(step * 0.75)
    const timers = []
    const at = (ms, fn) => timers.push(setTimeout(fn, ms))
    const start = 950 // the panel and its rows arrive first
    rows.forEach((_, i) => {
      at(start + i * step, () => { setReading(i); launch(i, fly) })
      at(start + i * step + fly - 60, () => setShown(i + 1))
    })
    const end = start + rows.length * step + 450
    at(end, () => { setReading(-1); setPanelOpen(false) })
    at(end + 620, () => fit(800)) // after the panel has folded away
    at(end + 1500, () => builtRef.current?.())
    return () => { timers.forEach(clearTimeout); packets.current?.replaceChildren() }
  }, [building, rows, delay]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { // Skip: everything appears at once
    if (!skipKey || !building) return
    packets.current?.replaceChildren()
    setShown(rows.length); setReading(-1); setPanelOpen(false)
    setTimeout(() => fit(500), 420)
    builtRef.current?.()
  }, [skipKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Whatever happened before, the graph is refitted once it is complete, so it can never be left off-screen.
  useEffect(() => { if (!building) { const t = setTimeout(() => fit(0), 60); return () => clearTimeout(t) } return undefined }, [building, result]) // eslint-disable-line react-hooks/exhaustive-deps

  const nodeStatus = useMemo(() => buildNodeStatus(result), [result])
  const descById = useMemo(() => Object.fromEntries((result?.event_descriptions ?? []).map((d) => [d.node_id, d])), [result])
  const graphView = useMemo(() => {
    const g = result?.replay_graph
    if (!g) return null
    return { ...g, nodes: g.nodes.map((n) => ({ ...n, brief: briefFor(descById[n.id], result.event_facts?.[n.id]) })) }
  }, [result, descById])
  const laid = useMemo(() => layoutGraph(graphView, highlight, nodeStatus), [graphView, highlight, nodeStatus])

  const idx = useMemo(() => Object.fromEntries(order.map((id, i) => [id, i])), [order])
  const animating = building && shown < rows.length
  const isShown = (id) => (idx[id] ?? -1) < shown

  // An edge draws itself in once both of its ends exist. This is done from script on the live path, measured to its real
  // length, because React Flow may re-mount edge elements as nodes appear: a CSS keyframe would restart on every
  // re-mount and never finish, leaving the edge invisible. If a path is re-mounted mid-draw it simply shows in full.
  const drawn = useRef(new Set())
  useEffect(() => { if (building) drawn.current = new Set() }, [building, rows])
  useEffect(() => {
    if (!building || reducedMotion()) return undefined
    const fresh = laid.edges.filter((e) => isShown(e.source) && isShown(e.target) && !drawn.current.has(e.id))
    if (!fresh.length) return undefined
    fresh.forEach((e) => drawn.current.add(e.id))
    const raf = requestAnimationFrame(() => {
      fresh.forEach((e) => {
        const p = flowWrap.current?.querySelector(`.react-flow__edge[data-testid="rf__edge-${CSS.escape(e.id)}"] path.react-flow__edge-path`)
        if (!p) return
        if (e.style?.strokeDasharray) { // already dashed (the reference line): fade it in instead
          p.animate([{ opacity: 0 }, { opacity: e.style?.opacity ?? 1 }], { duration: 700, easing: 'ease-out' })
          return
        }
        const len = Math.ceil(p.getTotalLength())
        p.animate([
          { strokeDasharray: `${len} ${len}`, strokeDashoffset: `${len}` },
          { strokeDasharray: `${len} ${len}`, strokeDashoffset: '0' },
        ], { duration: 750, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' })
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [shown, building, laid]) // eslint-disable-line react-hooks/exhaustive-deps
  const nodes = laid.nodes.map((n) => {
    if (!building) return n
    const on = isShown(n.id)
    return { ...n, className: on ? 'rs-node-enter' : 'rs-node-wait', style: { ...n.style, pointerEvents: on ? 'auto' : 'none' } }
  })
  const edges = laid.edges.map((e) => {
    if (!building) return e
    const on = isShown(e.source) && isShown(e.target)
    return { ...e, animated: false, className: on ? 'rs-edge-live' : undefined, style: { ...e.style, opacity: on ? (e.style?.opacity ?? 1) : 0 } }
  })

  const onNodeClick = (evt, node) => {
    const r = box.current.getBoundingClientRect()
    setSel({ node: node.data.node, x: evt.clientX - r.left, y: evt.clientY - r.top, w: r.width, h: r.height })
  }
  const legend = nodeStatus ? LEGEND : []

  if (!result) return null
  const progress = rows.length ? Math.min(shown, rows.length) / rows.length : 1
  return (
    <div ref={box} className={`rs-stage relative flex border border-[#d9dfe6] shadow-card ${building ? 'is-building' : ''}`} style={{ height }} data-testid="graph-stage">
      {/* ---- the OCEL log, docked beside the graph while it is read ---- */}
      <aside aria-label="OCEL 2.0 log" aria-hidden={!panelOpen}
        className={`rs-log-panel relative z-10 shrink-0 overflow-hidden ${panelOpen ? 'is-open' : ''}`}>
        <div className="flex h-full w-[min(360px,42vw)] flex-col p-3">
          <div className="rs-log-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
            <div className="border-b border-white/10 px-4 pb-3 pt-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12.5px] font-bold text-white">OCEL 2.0 log</span>
                <span className="font-mono text-[11px] text-teal-300">{Math.min(shown, rows.length)}/{rows.length} nodes</span>
              </div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-[#8fa3b5]">{title}</div>
              <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-gradient-to-r from-teal-400 to-teal-300 transition-[width] duration-500 ease-out" style={{ width: `${progress * 100}%` }} />
              </div>
            </div>
            <ol className="min-h-0 flex-1 overflow-hidden px-2 py-2">
              {rows.map((r, i) => {
                const state = i < shown ? 'done' : i === reading ? 'reading' : 'waiting'
                return (
                  <li key={r.id} ref={(el) => { rowRefs.current[i] = el }} className={`rs-log-row is-${state}`} style={{ animationDelay: `${0.25 + i * 0.045}s` }}
                    title={`${r.activity}${r.timestamp ? ` · ${formatDateTime(r.timestamp)}` : ''} · ${attrText(r.attributes, 200)}`}>
                    <span className="rs-log-id">{r.id}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11.5px] font-semibold">{r.activity}</span>
                      <span className="block truncate font-mono text-[10px] opacity-70">{r.timestamp ? formatDateTime(r.timestamp) : 'fixed values'} · {attrText(r.attributes, 40)}</span>
                    </span>
                    <span className="rs-log-tick" aria-hidden="true"><Check size={11} strokeWidth={3} /></span>
                  </li>
                )
              })}
            </ol>
          </div>
        </div>
      </aside>

      {/* ---- the graph ---- */}
      <div ref={flowWrap} className="relative min-w-0 flex-1">
        <div className="pointer-events-none absolute left-4 top-3 z-10 flex flex-wrap items-center gap-x-4 gap-y-1 pr-24">
          <div className="text-[14px] font-bold text-[#101828]">
            {title}
            {hopRange && <span className="ml-2 rounded bg-white/80 px-1.5 py-0.5 text-[11px] font-semibold text-[#5c6b7a]">hops {hopRange.min}–{hopRange.max}</span>}
          </div>
          {!building && legend.map((l, i) => (
            <div key={l.label} className="rs-legend-in flex items-center gap-1.5 text-[11.5px] text-[#5c6b7a]" style={{ animationDelay: `${i * 0.06}s` }}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />{l.label}
            </div>
          ))}
          {animating && <div className="rs-legend-in flex items-center gap-1.5 font-mono text-[11.5px] font-semibold text-teal-700"><span className="rs-live-dot h-1.5 w-1.5 rounded-full bg-teal-500" />reading event {reading >= 0 ? order[reading] : '…'}</div>}
        </div>

        <ReactFlow
          key={`${title}-${laid.nodes.length}-${result.limits?.limits?.max_hops}`}
          nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} onNodeClick={onNodeClick} onPaneClick={() => setSel(null)}
          onInit={(inst) => { rf.current = inst; inst.fitView(FIT) }}
          fitView fitViewOptions={FIT} minZoom={0.02} maxZoom={1.4}
          zoomOnScroll={false} panOnScroll={false} preventScrolling={false} proOptions={{ hideAttribution: true }}
        >
          <Background color="#cfd8e0" gap={22} />
          <Controls showInteractive={false} />
        </ReactFlow>

        {building && <div aria-hidden="true" className="rs-scan pointer-events-none absolute inset-0 z-[5]" />}
      </div>

      {/* packets fly across both halves, so their layer covers the whole stage */}
      <div ref={packets} aria-hidden="true" className="pointer-events-none absolute inset-0 z-20 overflow-hidden" />

      {sel && (
        <NodePopover node={sel.node} desc={descById[sel.node.id]} facts={result.event_facts?.[sel.node.id]}
          anchor={{ x: sel.x, y: sel.y }} size={{ w: sel.w, h: sel.h }} onClose={() => setSel(null)} />
      )}

      <button type="button" onClick={onEdit} title="Edit values"
        className="absolute bottom-3 right-3 z-10 inline-flex items-center gap-1.5 rounded-xl border border-[#d5dce3] bg-white/90 px-3 py-1.5 text-[12.5px] font-semibold text-[#101828] shadow backdrop-blur hover:bg-white">
        <Pencil size={13} /> Edit
      </button>
    </div>
  )
}
