// src/lib/graphLayout.js
//
// Shared by ReplayConsole and ReplayGraph (they used to carry two copies that had to be kept
// in sync by hand). Pure: returns React Flow nodes/edges, no React imports.
import { MarkerType } from 'reactflow'

export function pairKey(a, b) {
  return [a, b].sort().join('::')
}

// highlight specs:
//   {type:'constraint', before, after}   a structural order-lock (ConstraintExplanationList)
//   {type:'route', eventIds}             a leaf-to-target payment chain (PaymentRoutesCard)
//   {type:'pair', a, b}                  an order-sensitive pair (OrderSensitivityCard)
//   {type:'nodes', ids}                  one or more events (ReplayTraceCard step)
export function buildHighlight(h) {
  if (!h) return null
  if (h.type === 'route') {
    const edgeKeys = new Set()
    for (let i = 0; i < h.eventIds.length - 1; i++) edgeKeys.add(pairKey(h.eventIds[i], h.eventIds[i + 1]))
    return { ids: new Set(h.eventIds), edgeKeys }
  }
  if (h.type === 'pair') {
    return { ids: new Set([h.a, h.b]), edgeKeys: new Set([pairKey(h.a, h.b)]) }
  }
  if (h.type === 'nodes') {
    return { ids: new Set(h.ids), edgeKeys: new Set() }
  }
  return {
    ids: new Set([h.before, h.after]),
    edgeKeys: new Set([pairKey(h.before, h.after)]),
  }
}

// Lay nodes out left-to-right by hop distance (target = rightmost column).
// `nodeStatus` (optional, from buildNodeStatus) adds the verdict colouring.
export function layoutGraph(graphView, highlightSpec, nodeStatus) {
  if (!graphView) return { nodes: [], edges: [] }
  const highlight = buildHighlight(highlightSpec)
  const byHop = {}
  graphView.nodes.forEach((n) => {
    const hop = n.is_target ? -1 : n.hop ?? 99
    byHop[hop] = byHop[hop] || []
    byHop[hop].push(n)
  })
  const hops = Object.keys(byHop)
    .map(Number)
    .sort((a, b) => b - a) // furthest hop first (left), target (-1) last (right)

  const COL_GAP = 260
  const ROW_GAP = 92
  const nodes = []
  hops.forEach((hop, colIdx) => {
    const rows = byHop[hop]
    const colHeight = (rows.length - 1) * ROW_GAP
    rows.forEach((n, rowIdx) => {
      const st = nodeStatus?.[n.id]
      const data = { ...n }
      if (highlight) data.highlighted = highlight.ids.has(n.id)
      if (st) {
        data.verdictKind = st.kind  // not `status`: the API's graph nodes already carry a placeholder `status`
        data.partners = st.partners
      }
      nodes.push({
        id: n.id,
        position: { x: colIdx * COL_GAP, y: rowIdx * ROW_GAP - colHeight / 2 },
        data: { node: data },
        type: 'event',
        draggable: true,
      })
    })
  })

  // The API's edge direction is discovery order (near-target -> upstream); we draw upstream ->
  // target, left to right, so source/target are flipped for display only.
  const edges = graphView.edges.map((e, i) => {
    const isHighlighted = highlight && highlight.edgeKeys.has(pairKey(e.source, e.target))
    return {
      id: `${e.source}-${e.target}-${i}`,
      source: e.target,
      target: e.source,
      label: e.shared_objects?.length > 1 ? `${e.shared_objects.length} shared objects` : undefined,
      labelStyle: { fontSize: 9, fill: '#5c6b7a', fontWeight: 600 },
      labelBgStyle: { fill: '#f4f6f8' },
      labelBgPadding: [3, 2],
      animated: false,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: isHighlighted ? '#b5850f' : '#64748b',
        width: isHighlighted ? 24 : 20,
        height: isHighlighted ? 24 : 20,
      },
      style: { stroke: isHighlighted ? '#b5850f' : '#64748b', strokeWidth: isHighlighted ? 3.5 : 2 },
      zIndex: isHighlighted ? 10 : 0,
    }
  })

  return { nodes, edges }
}
