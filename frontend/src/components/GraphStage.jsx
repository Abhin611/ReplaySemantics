import { useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, { Background, Controls } from 'reactflow'
import 'reactflow/dist/style.css'
import { Pencil } from 'lucide-react'
import EventNode from './graph/EventNode'
import NodePopover from './NodePopover'
import { layoutGraph } from '../lib/graphLayout'
import { buildNodeStatus, NODE_KIND_STYLE } from '../lib/verdict'
import { attrText, briefFor, ocelRows } from '../lib/flow'
import { formatDateTime } from '../lib/format'

const NODE_TYPES = { event: EventNode }
const LEGEND = ['independent', 'ordered', 'blocked', 'exempt', 'context'].map((k) => ({ label: NODE_KIND_STYLE[k].label, color: NODE_KIND_STYLE[k].border }))

// The graph. When `building` is true it first shows the case as it sits in the OCEL 2.0 log (a table, one row per event) and
// turns the rows into nodes one by one: the row glows, shrinks away, and its node blooms into place; edges draw in once both
// ends exist. The whole graph is always fitted into the box: nothing needs scrolling to be seen.
export default function GraphStage({ result, highlight, building, delay, skipKey, onBuilt, onEdit, title, hopRange, height = 'clamp(460px, calc(100vh - 250px), 780px)' }) {
  const rows = useMemo(() => ocelRows(result), [result])
  const order = useMemo(() => rows.map((r) => r.id), [rows])
  const [shown, setShown] = useState(building ? 0 : rows.length)
  const [leaving, setLeaving] = useState(-1)
  const [tableGone, setTableGone] = useState(!building)
  const [sel, setSel] = useState(null)
  const box = useRef(null)
  const builtRef = useRef(onBuilt)
  builtRef.current = onBuilt

  // ---- the build animation ----
  useEffect(() => {
    if (!building) { setShown(rows.length); setLeaving(-1); setTableGone(true); return undefined }
    setShown(0); setLeaving(-1); setTableGone(false)
    const step = Math.max(240, Math.round((delay || 2000) / 5))
    const timers = []
    const at = (ms, fn) => timers.push(setTimeout(fn, ms))
    rows.forEach((_, i) => {
      at(900 + i * step, () => setLeaving(i))
      at(900 + i * step + step * 0.45, () => setShown(i + 1))
    })
    const end = 900 + rows.length * step + 500
    at(end, () => setTableGone(true))
    at(end + 900, () => builtRef.current?.())
    return () => timers.forEach(clearTimeout)
  }, [building, rows, delay]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { // Skip: everything appears at once
    if (!skipKey || !building) return
    setShown(rows.length); setLeaving(rows.length); setTableGone(true)
    builtRef.current?.()
  }, [skipKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const nodeStatus = useMemo(() => buildNodeStatus(result), [result])
  const descById = useMemo(() => Object.fromEntries((result?.event_descriptions ?? []).map((d) => [d.node_id, d])), [result])
  const graphView = useMemo(() => {
    const g = result?.replay_graph
    if (!g) return null
    return { ...g, nodes: g.nodes.map((n) => ({ ...n, brief: briefFor(descById[n.id], result.event_facts?.[n.id]) })) }
  }, [result, descById])
  const laid = useMemo(() => layoutGraph(graphView, highlight, nodeStatus), [graphView, highlight, nodeStatus])

  const idx = useMemo(() => Object.fromEntries(order.map((id, i) => [id, i])), [order])
  const isShown = (id) => (idx[id] ?? -1) < shown
  const nodes = laid.nodes.map((n) => ({
    ...n,
    className: building && isShown(n.id) ? 'rs-node-pop' : undefined,
    style: building ? { opacity: isShown(n.id) ? 1 : 0, pointerEvents: isShown(n.id) ? 'auto' : 'none' } : undefined,
  }))
  const edges = laid.edges.map((e) => {
    const on = isShown(e.source) && isShown(e.target)
    return { ...e, className: building && on ? 'rs-edge-draw' : undefined, style: { ...e.style, opacity: !building || on ? (e.style?.opacity ?? 1) : 0 } }
  })

  const onNodeClick = (evt, node) => {
    const r = box.current.getBoundingClientRect()
    setSel({ node: node.data.node, x: evt.clientX - r.left, y: evt.clientY - r.top, w: r.width, h: r.height })
  }
  const legend = nodeStatus ? LEGEND : []

  if (!result) return null
  return (
    <div ref={box} className="rs-stage relative border border-[#e2e6ea] shadow-card" style={{ height }} data-testid="graph-stage">
      <div className="pointer-events-none absolute left-4 top-3 z-10 flex flex-wrap items-center gap-x-4 gap-y-1">
        <div className="text-[14px] font-bold text-[#101828]">
          {title}
          {hopRange && <span className="ml-2 rounded bg-white/80 px-1.5 py-0.5 text-[11px] font-semibold text-[#5c6b7a]">hops {hopRange.min}–{hopRange.max}</span>}
        </div>
        {!building && legend.map((l) => (
          <div key={l.label} className="flex items-center gap-1.5 text-[11.5px] text-[#5c6b7a]">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />{l.label}
          </div>
        ))}
      </div>

      <ReactFlow
        key={`${title}-${laid.nodes.length}-${result.limits?.limits?.max_hops}`}
        nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} onNodeClick={onNodeClick} onPaneClick={() => setSel(null)}
        fitView fitViewOptions={{ padding: 0.2 }} minZoom={0.02} maxZoom={1.4}
        zoomOnScroll={false} panOnScroll={false} preventScrolling={false} proOptions={{ hideAttribution: true }}
      >
        <Background color="#e5eaef" gap={22} />
        <Controls showInteractive={false} />
      </ReactFlow>

      {!tableGone && (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-8">
          <div className={`rs-table max-h-full w-full max-w-[1100px] overflow-hidden rounded-2xl border border-white/70 bg-white/80 shadow-2xl backdrop-blur-md ${leaving >= rows.length - 1 && shown >= rows.length ? 'rs-table-gone' : ''}`}>
            <div className="flex items-center justify-between border-b border-[#e2e6ea] px-5 py-3">
              <div className="text-[13px] font-bold text-[#101828]">OCEL 2.0 log · {title}</div>
              <div className="font-mono text-[11px] text-[#8a97a3]">{Math.min(shown, rows.length)} / {rows.length} events turned into nodes</div>
            </div>
            <div className="grid grid-cols-[70px_190px_150px_1.2fr_1.5fr] gap-3 border-b border-[#eef1f4] px-5 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#8a97a3]">
              <span>Event</span><span>Activity</span><span>Time</span><span>Related objects</span><span>Attributes</span>
            </div>
            <div className="max-h-[60vh] overflow-hidden px-2 pb-2">
              {rows.map((r, i) => (
                <div key={r.id} className={`rs-row ${i < leaving ? 'rs-row-out' : ''} ${i === leaving ? 'rs-row-glow' : ''}`}>
                  <div className="grid grid-cols-[70px_190px_150px_1.2fr_1.5fr] items-center gap-3 rounded-lg px-3 py-2 text-[11.5px]">
                    <span className="font-mono font-bold text-[#101828]">{r.id}</span>
                    <span className="truncate text-[#344054]" title={r.activity}>{r.activity}</span>
                    <span className="truncate font-mono text-[#5c6b7a]">{r.timestamp ? formatDateTime(r.timestamp) : 'fixed'}</span>
                    <span className="truncate text-[#5c6b7a]" title={r.objects.join(', ')}>{r.objects.join(', ') || '—'}</span>
                    <span className="truncate font-mono text-[#5c6b7a]" title={attrText(r.attributes, 400)}>{attrText(r.attributes)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {sel && (
        <NodePopover node={sel.node} desc={descById[sel.node.id]} facts={result.event_facts?.[sel.node.id]}
          anchor={{ x: sel.x, y: sel.y }} size={{ w: sel.w, h: sel.h }} onClose={() => setSel(null)} />
      )}

      <button type="button" onClick={onEdit} title="Edit values"
        className="absolute bottom-3 right-3 z-10 inline-flex items-center gap-1.5 rounded-lg border border-[#d5dbe1] bg-white/90 px-3 py-1.5 text-[12.5px] font-semibold text-[#101828] shadow hover:bg-white">
        <Pencil size={13} /> Edit
      </button>
    </div>
  )
}
